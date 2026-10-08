import { isSyncLogStatusCheck, syncLogStatusFallbacks } from "@/lib/leads/sync-log-reason";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
/**
 * lead_status_changed: full leadsInProcessReport pull, diff against the snapshot.
 * fromDate/toDate are ignored by Arbox, so every scan reads all open leads.
 * Runs on the existing morning (09:00) and evening (20:00) arbox-daily-triggers workers (lib/daily-run-slots.ts). No new cron.
 * Missing tables or target_status column: log once, skip, never send.
 */
import { logMessage } from "@/lib/analytics";
import { ARBOX_NEW_LEAD_CONTACT_SOURCE, fetchArboxUserPhone } from "@/lib/leads/arbox-new-lead";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";
import {
  countLeadStatusReportLeads,
  distinctNonEmptyLeadStatuses,
  leadStatusRefreshThrottleHit,
  type LeadStatusCatalogRow,
} from "@/lib/leads/lead-status-picker";
import { claimPendingSyncLog, logDedupBlockedSend } from "@/lib/leads/dedup-fail-closed";
import {
  nextCancellationSyncLogAfterDispatch,
  parseCancellationSyncAttempts,
  type CancellationSyncLogStatus,
} from "@/lib/leads/arbox-membership-cancelled";
import { formatDateYmdIsrael } from "@/lib/leads/arbox-trial-attended";
import {
  closeRetentionEvent,
  markRetentionSent,
  retentionAlreadySentToday,
} from "@/lib/leads/retention-daily-cap";
import { isRetentionStaff, retentionStaffIndex } from "@/lib/leads/arbox-staff";
import {
  buildTemplateIncomingContactPatch,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { addCalendarDaysYmd, eventBeforeRuleActivation, ruleActivationMs, type ActivationRule } from "@/lib/rule-activation";
import { type LeadStatusSendSlot } from "@/lib/trigger-catalog";
import {
  cancelPendingScheduledTemplateSendByDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export const LEAD_STATUS_CHANGED_TYPE = "lead_status_changed";
/** Longer than a once-a-day slot, so an evening-only rule scanned every 24h does not reseed. */
export const LEAD_STATUS_STALE_MS = 36 * 60 * 60 * 1000;
export const LEAD_STATUS_DROP_RATIO = 0.7;
const INTEGRITY_LEAD_ID = "__pull_integrity__";
const SYNC_TABLE = "arbox_lead_status_change_sync_log";
const SNAPSHOT_TABLE = "arbox_lead_status_snapshot";
const KNOWN_TABLE = "arbox_lead_known_statuses";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type LeadStatusRule = ActivationRule & {
  delay_days: number;
  delay_direction: string;
  template_name: string | null;
  target_status: string;
  send_slot: LeadStatusSendSlot;
};

export type LeadStatusPerson = {
  leadId: string;
  status: string;
  phone: string | null;
  fullName: string | null;
};

export type LeadStatusTransition = {
  leadId: string;
  from: string;
  to: string;
};

export type LeadStatusSyncSummary = {
  skipped?: boolean;
  skip_reason?: string;
  seeded: boolean;
  pages_fetched: number;
  open_leads: number;
  transitions: number;
  added: number;
  removed: number;
  notified: number;
  deferred: number;
  already: number;
  skipped_integrity: number;
  skipped_unknown_status: number;
  skipped_status: number;
  expired: number;
  pending_held: number;
  skipped_cap: number;
  skipped_opt_out: number;
  gated: number;
  no_phone: number;
  errors: number;
  fetch_error?: string;
};

let missingSchemaLogged = false;

export function isMissingLeadStatusSchema(message: string): boolean {
  return /does not exist|42P01|schema cache|PGRST204|could not find the/i.test(message);
}

function logMissingSchema(businessId: number, detail: string): void {
  if (missingSchemaLogged) return;
  missingSchemaLogged = true;
  console.error("[leads/arbox-lead-status] schema missing - skip, no send", {
    businessId,
    detail,
  });
}

/**
 * Legacy path only, when due_date is not migrated yet.
 * Delay of a day or more is Stage C. Delay 0 sends in the detecting run.
 */
export function leadStatusSendIsQueued(delayDays: number, now: Date): boolean {
  const dueAt = computeDueAt(
    { delay_days: Math.max(0, Math.trunc(delayDays) || 0), delay_direction: "after" },
    now
  );
  return dueAt.getTime() > now.getTime() + 15_000;
}

export function leadStatusNormalizeSlot(raw: unknown): LeadStatusSendSlot {
  return raw === "morning" || raw === "evening" ? raw : "next_run";
}

export function leadStatusSlotMatches(
  ruleSlot: string | null | undefined,
  runSlot: "morning" | "evening"
): boolean {
  const slot = leadStatusNormalizeSlot(ruleSlot);
  return slot === "next_run" || slot === runSlot;
}

/** Skip the scan only when every enabled rule is pinned to the other slot. */
export function leadStatusShouldSkipScan(
  slots: readonly string[],
  runSlot: "morning" | "evening"
): boolean {
  if (!slots.length) return false;
  const normalized = slots.map((slot) => leadStatusNormalizeSlot(slot));
  if (normalized.some((slot) => slot === "next_run")) return false;
  return normalized.every((slot) => slot !== runSlot);
}

export function leadStatusDueYmd(now: Date, delayDays: number): string {
  const today = formatDateYmdIsrael(now);
  return addCalendarDaysYmd(today, Math.max(0, Math.trunc(delayDays) || 0)) ?? today;
}

/** True once today is after due_date + 2 days. */
export function leadStatusPendingExpired(dueYmd: string, todayYmd: string): boolean {
  const limit = addCalendarDaysYmd(dueYmd, 2);
  if (!limit) return false;
  return todayYmd > limit;
}

/**
 * A failed page, a page cap, or an open-lead drop of more than 30% blocks the run.
 * Exactly 30% remaining (current == previous * 0.7) is still a usable pull.
 */
export function leadStatusPullIntegrityBlocked(input: {
  fetchOk: boolean;
  hitPageCap: boolean;
  previousOpenLeads: number;
  currentOpenLeads: number;
}): boolean {
  if (!input.fetchOk || input.hitPageCap) return true;
  if (input.previousOpenLeads <= 0) return false;
  return input.currentOpenLeads < input.previousOpenLeads * LEAD_STATUS_DROP_RATIO;
}

/** Reseed (no sends) when there is no baseline, the last scan is stale, or it predates every live rule. */
export function leadStatusShouldReseed(input: {
  snapshotCount: number;
  lastScannedAt: string | null;
  now: Date;
  ruleActivationMs: number[];
}): boolean {
  if (input.snapshotCount <= 0 || !input.lastScannedAt) return true;
  const scanned = Date.parse(input.lastScannedAt);
  if (!Number.isFinite(scanned)) return true;
  if (input.now.getTime() - scanned > LEAD_STATUS_STALE_MS) return true;
  const activations = input.ruleActivationMs.filter((ms) => Number.isFinite(ms) && ms > 0);
  if (activations.length && scanned < Math.min(...activations)) return true;
  return false;
}

export function leadStatusRuleCanSend(
  rule: ActivationRule,
  lastScannedAt: string,
  now: Date
): boolean {
  const scanned = Date.parse(lastScannedAt);
  if (!Number.isFinite(scanned) || scanned < ruleActivationMs(rule)) return false;
  return !eventBeforeRuleActivation(now, rule);
}

/**
 * A transition is a lead that stayed on the list and changed status.
 * A new lead and a lead that left the list are recorded, not sent.
 */
export function diffLeadStatuses(
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>
): { transitions: LeadStatusTransition[]; added: string[]; removed: string[] } {
  const transitions: LeadStatusTransition[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [leadId, status] of current) {
    const before = previous.get(leadId);
    if (before == null) added.push(leadId);
    else if (before !== status) transitions.push({ leadId, from: before, to: status });
  }
  for (const leadId of previous.keys()) {
    if (!current.has(leadId)) removed.push(leadId);
  }
  return { transitions, added, removed };
}

export function buildLeadsInProcessReportPath(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  page?: number;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    location_id: input.locationId,
  });
  if (input.page != null && input.page > 1) qs.set("page", String(input.page));
  return `/v3/reports/leadsInProcessReport?${qs.toString()}`;
}

export function parseLeadStatusPerson(row: Record<string, unknown>): LeadStatusPerson | null {
  const leadId = String(row.user_id ?? row.lead_id ?? "").trim();
  const status = String(row.lead_status ?? "").trim();
  if (!leadId || !status) return null;
  const fullName =
    String(row.full_name ?? "").trim() ||
    [String(row.first_name ?? "").trim(), String(row.last_name ?? "").trim()].filter(Boolean).join(" ") ||
    null;
  return {
    leadId,
    status,
    phone: normalizePhone(row.phone) ?? normalizePhone(row.additional_phone),
    fullName,
  };
}

export async function fetchLeadsInProcessReportRows(input: {
  apiKey: string;
  locationId: string;
  now?: Date;
}): Promise<
  | { ok: true; rows: Record<string, unknown>[]; pagesFetched: number; hitPageCap?: boolean }
  | { ok: false; error: string; pagesFetched: number; hitPageCap?: boolean }
> {
  const day = formatDateYmdIsrael(input.now ?? new Date());
  const report = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.locationId,
    logLabel: "leads/arbox-lead-status/leadsInProcessReport",
    buildPath: (page) =>
      buildLeadsInProcessReportPath({
        fromDate: day,
        toDate: day,
        locationId: input.locationId,
        page,
      }),
  });
  if (!report.ok) {
    return { ok: false, error: report.error, pagesFetched: report.pagesFetched, hitPageCap: report.hitPageCap };
  }
  return { ok: true, rows: report.rows, pagesFetched: report.pagesFetched, hitPageCap: report.hitPageCap };
}

/**
 * Dashboard picker pull. Writes distinct non-empty statuses only.
 * Does not touch the snapshot, last_scanned_at, sync log, or any send.
 * One Arbox pull per business per 60s; a newer known-status row is the clock.
 */
export async function refreshArboxLeadStatusCatalog(input: {
  admin: Admin;
  businessId: number;
  apiKey: string;
  boxId: string;
  now?: Date;
  fetchLeads?: typeof fetchLeadsInProcessReportRows;
}): Promise<
  | { ok: true; throttled: boolean; statuses: LeadStatusCatalogRow[] }
  | { ok: false; error: string; statuses: LeadStatusCatalogRow[] }
> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const businessId = Number(input.businessId);
  const known = await input.admin
    .from(KNOWN_TABLE)
    .select("status, last_seen_at")
    .eq("business_id", businessId)
    .limit(500);
  if (known.error) {
    console.error("[leads/arbox-lead-status] catalog read failed", known.error.message);
    return { ok: false, error: "catalog_read_failed", statuses: [] };
  }
  const cached: LeadStatusCatalogRow[] = (known.data ?? [])
    .map((row) => ({
      status: String((row as { status?: unknown }).status ?? "").trim(),
      last_seen_at: String((row as { last_seen_at?: unknown }).last_seen_at ?? ""),
    }))
    .filter((row) => row.status);
  if (leadStatusRefreshThrottleHit({ rows: cached, now })) {
    return { ok: true, throttled: true, statuses: cached };
  }

  const snapshot = await input.admin
    .from(SNAPSHOT_TABLE)
    .select("lead_id", { count: "exact", head: true })
    .eq("business_id", businessId);
  if (snapshot.error && !isMissingLeadStatusSchema(snapshot.error.message)) {
    console.error("[leads/arbox-lead-status] catalog snapshot count failed", snapshot.error.message);
    return { ok: false, error: "catalog_read_failed", statuses: cached };
  }
  const previousOpenLeads = snapshot.error ? 0 : Number(snapshot.count ?? 0);

  const fetchLeads = input.fetchLeads ?? fetchLeadsInProcessReportRows;
  const report = await fetchLeads({
    apiKey: input.apiKey,
    locationId: input.boxId,
    now,
  });
  const currentOpenLeads = report.ok ? countLeadStatusReportLeads(report.rows) : 0;
  if (
    leadStatusPullIntegrityBlocked({
      fetchOk: report.ok,
      hitPageCap: Boolean(report.hitPageCap),
      previousOpenLeads,
      currentOpenLeads,
    })
  ) {
    console.error("[leads/arbox-lead-status] catalog refresh blocked", {
      businessId,
      fetchOk: report.ok,
      hitPageCap: Boolean(report.hitPageCap),
      previousOpenLeads,
      currentOpenLeads,
      error: report.ok ? "pull_integrity" : report.error,
    });
    return { ok: false, error: report.ok ? "pull_integrity" : report.error, statuses: cached };
  }
  if (!report.ok) {
    return { ok: false, error: report.error, statuses: cached };
  }

  const statuses = distinctNonEmptyLeadStatuses(report.rows);
  const knownBefore = new Set(cached.map((row) => row.status));
  const writes = statuses.map((status) => ({
    business_id: businessId,
    status,
    ...(knownBefore.has(status) ? {} : { first_seen_at: nowIso }),
    last_seen_at: nowIso,
  }));
  if (writes.length) {
    const { error } = await input.admin.from(KNOWN_TABLE).upsert(writes, {
      onConflict: "business_id,status",
    });
    if (error) {
      console.error("[leads/arbox-lead-status] catalog upsert failed", error.message);
      return { ok: false, error: "catalog_write_failed", statuses: cached };
    }
  }
  const merged = new Map(cached.map((row) => [row.status, row.last_seen_at]));
  for (const status of statuses) merged.set(status, nowIso);
  return {
    ok: true,
    throttled: false,
    statuses: [...merged].map(([status, last_seen_at]) => ({ status, last_seen_at })),
  };
}

/** Blank lead_status never becomes a transition and never replaces the stored status. */
export function indexLeadStatusReport(input: {
  rows: Record<string, unknown>[];
  previous: ReadonlyMap<string, string>;
}): { people: Map<string, LeadStatusPerson>; openLeadCount: number } {
  const seen = new Set<string>();
  const people = new Map<string, LeadStatusPerson>();
  for (const raw of input.rows) {
    const leadId = String(raw.user_id ?? raw.lead_id ?? "").trim();
    if (!leadId || seen.has(leadId)) continue;
    seen.add(leadId);
    const status = String(raw.lead_status ?? "").trim();
    if (!status) {
      const kept = input.previous.get(leadId);
      if (!kept) continue;
      people.set(leadId, {
        leadId,
        status: kept,
        phone: normalizePhone(raw.phone) ?? normalizePhone(raw.additional_phone),
        fullName:
          String(raw.full_name ?? "").trim() ||
          [String(raw.first_name ?? "").trim(), String(raw.last_name ?? "").trim()].filter(Boolean).join(" ") ||
          null,
      });
      continue;
    }
    const person = parseLeadStatusPerson(raw);
    if (person) people.set(person.leadId, person);
  }
  return { people, openLeadCount: seen.size };
}

function emptySummary(): LeadStatusSyncSummary {
  return {
    seeded: false,
    pages_fetched: 0,
    open_leads: 0,
    transitions: 0,
    added: 0,
    removed: 0,
    notified: 0,
    deferred: 0,
    already: 0,
    skipped_integrity: 0,
    skipped_unknown_status: 0,
    skipped_status: 0,
    expired: 0,
    pending_held: 0,
    skipped_cap: 0,
    skipped_opt_out: 0,
    gated: 0,
    no_phone: 0,
    errors: 0,
  };
}

async function loadRules(admin: Admin, businessId: number): Promise<
  | { ok: true; rules: LeadStatusRule[]; sendSlotColumn: boolean }
  | { ok: false; missing: boolean; error: string }
> {
  const base = await admin
    .from("template_triggers")
    .select("id, delay_days, delay_direction, template_name, enabled, created_at, updated_at")
    .eq("business_id", businessId)
    .eq("trigger_type", LEAD_STATUS_CHANGED_TYPE)
    .eq("enabled", true)
    .limit(40);
  if (base.error) return { ok: false, missing: isMissingLeadStatusSchema(base.error.message), error: base.error.message };
  const enabled = (base.data ?? []).filter((row) =>
    String((row as { template_name?: unknown }).template_name ?? "").trim()
  );
  if (!enabled.length) return { ok: true, rules: [], sendSlotColumn: true };
  const ids = enabled.map((row) => String((row as { id?: unknown }).id ?? ""));
  const withStatus = await admin
    .from("template_triggers")
    .select("id, target_status, send_slot")
    .in("id", ids)
    .limit(40);
  type StatusSlotRow = { id?: unknown; target_status?: unknown; send_slot?: unknown };
  let statusRows = (withStatus.data ?? null) as StatusSlotRow[] | null;
  let sendSlotColumn = true;
  if (withStatus.error && /send_slot/i.test(withStatus.error.message)) {
    sendSlotColumn = false;
    const fallback = await admin.from("template_triggers").select("id, target_status").in("id", ids).limit(40);
    if (fallback.error) {
      return {
        ok: false,
        missing: isMissingLeadStatusSchema(fallback.error.message),
        error: fallback.error.message,
      };
    }
    statusRows = (fallback.data ?? null) as StatusSlotRow[] | null;
  } else if (withStatus.error) {
    return {
      ok: false,
      missing: isMissingLeadStatusSchema(withStatus.error.message),
      error: withStatus.error.message,
    };
  }
  const targets = new Map(
    (statusRows ?? []).map((row) => [
      String((row as { id?: unknown }).id ?? ""),
      String((row as { target_status?: unknown }).target_status ?? "").trim(),
    ])
  );
  const slots = new Map(
    (statusRows ?? []).map((row) => [
      String((row as { id?: unknown }).id ?? ""),
      leadStatusNormalizeSlot((row as { send_slot?: unknown }).send_slot),
    ])
  );
  return {
    ok: true,
    rules: enabled.map((row) => {
      const record = row as Record<string, unknown>;
      const id = String(record.id ?? "");
      return {
        id,
        delay_days: Number(record.delay_days ?? 0),
        delay_direction: String(record.delay_direction ?? "after"),
        template_name: String(record.template_name ?? "").trim() || null,
        created_at: String(record.created_at ?? ""),
        updated_at: record.updated_at != null ? String(record.updated_at) : null,
        target_status: targets.get(id) ?? "",
        send_slot: slots.get(id) ?? "next_run",
      };
    }),
    sendSlotColumn,
  };
}

async function readLastScanned(
  admin: Admin,
  businessId: number
): Promise<{ ok: true; at: string | null } | { ok: false; missing: boolean; error: string }> {
  const { data, error } = await admin
    .from("businesses")
    .select("arbox_lead_status_last_scanned_at")
    .eq("id", businessId)
    .maybeSingle();
  if (error) return { ok: false, missing: isMissingLeadStatusSchema(error.message), error: error.message };
  const at = (data as { arbox_lead_status_last_scanned_at?: unknown } | null)
    ?.arbox_lead_status_last_scanned_at;
  return { ok: true, at: at ? String(at) : null };
}

async function readSnapshot(
  admin: Admin,
  businessId: number
): Promise<{ ok: true; rows: Map<string, string> } | { ok: false; missing: boolean; error: string }> {
  const rows = new Map<string, string>();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(SNAPSHOT_TABLE)
      .select("lead_id, status")
      .eq("business_id", businessId)
      .range(from, from + 999);
    if (error) return { ok: false, missing: isMissingLeadStatusSchema(error.message), error: error.message };
    const page = data ?? [];
    for (const row of page) {
      const leadId = String((row as { lead_id?: unknown }).lead_id ?? "").trim();
      const status = String((row as { status?: unknown }).status ?? "").trim();
      if (leadId) rows.set(leadId, status);
    }
    if (page.length < 1000) break;
    from += 1000;
  }
  return { ok: true, rows };
}

async function readKnown(
  admin: Admin,
  businessId: number
): Promise<{ ok: true; statuses: Set<string> } | { ok: false; error: string }> {
  const statuses = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(KNOWN_TABLE)
      .select("status")
      .eq("business_id", businessId)
      .range(from, from + 999);
    if (error) return { ok: false, error: error.message };
    const page = data ?? [];
    for (const row of page) {
      const status = String((row as { status?: unknown }).status ?? "").trim();
      if (status) statuses.add(status);
    }
    if (page.length < 1000) break;
    from += 1000;
  }
  return { ok: true, statuses };
}

function omitBlankFirstSeen(row: Record<string, unknown>): Record<string, unknown> {
  if (row.first_seen_at != null) return row;
  const rest = { ...row };
  delete rest.first_seen_at;
  return rest;
}

async function writeRows(
  admin: Admin,
  table: string,
  rows: Record<string, unknown>[]
): Promise<{ ok: boolean; error?: string }> {
  if (isArboxDailyDryRun() || !rows.length) return { ok: true };
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await admin.from(table).upsert(rows.slice(index, index + 200));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function deleteLeads(admin: Admin, businessId: number, leadIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (isArboxDailyDryRun() || !leadIds.length) return { ok: true };
  for (let index = 0; index < leadIds.length; index += 100) {
    const { error } = await admin
      .from(SNAPSHOT_TABLE)
      .delete()
      .eq("business_id", businessId)
      .in("lead_id", leadIds.slice(index, index + 100));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function scheduledKey(businessId: number, triggerId: string, leadId: string, status: string, enteredAt: string): string {
  return `lead_status_changed:${businessId}:${triggerId}:${leadId}:${status}:${enteredAt}`;
}

async function upsertSync(input: {
  admin: Admin;
  businessId: number;
  triggerId: string;
  leadId: string;
  leadStatus: string;
  enteredAt: string;
  contactId: string | null;
  nowIso: string;
  status: CancellationSyncLogStatus;
  attempts: number;
  reason: string | null;
  dueDate?: string | null;
  sendSlot?: string | null;
}): Promise<{ ok: boolean; missingColumn?: boolean }> {
  if (isArboxDailyDryRun()) return { ok: true };
  const row: Record<string, unknown> = {
    business_id: input.businessId,
    trigger_id: input.triggerId,
    lead_id: input.leadId,
    lead_status: input.leadStatus,
    entered_at: input.enteredAt,
    contact_id: input.contactId,
    processed_at: input.nowIso,
    status: input.status,
    attempts: input.attempts,
    reason: input.reason,
  };
  if (input.dueDate) row.due_date = input.dueDate;
  if (input.sendSlot) row.send_slot = input.sendSlot;
  let error: { message: string; code?: string } | null = null;
  for (const attempt of syncLogStatusFallbacks(input.status, input.reason)) {
    ({ error } = await input.admin
      .from(SYNC_TABLE)
      .upsert(
        { ...row, status: attempt.status, reason: attempt.reason ?? null },
        { onConflict: "business_id,trigger_id,lead_id,lead_status,entered_at" }
      ));
    if (!error || !isSyncLogStatusCheck(error)) break;
  }
  if (error) {
    if (/due_date|send_slot|schema cache|PGRST204|could not find/i.test(error.message)) {
      return { ok: false, missingColumn: true };
    }
    console.error("[leads/arbox-lead-status] sync_log upsert failed", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchLeadStatusTemplate(input: {
  admin: Admin;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  contactFullName: string | null;
  rule: LeadStatusRule;
  now: Date;
  dedupKey: string;
  /** False once the pending log owns the delay. Stage C stays for every other trigger. */
  queueDelay?: boolean;
}): Promise<{
  dispatch: "immediate" | "deferred" | "gated" | "skipped" | "send_failed" | "send_unknown" | "no_rule";
  ok: boolean;
}> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };
  if (input.queueDelay !== false && leadStatusSendIsQueued(input.rule.delay_days, input.now)) {
    const dueAt = computeDueAt(
      { delay_days: Math.max(0, Math.trunc(input.rule.delay_days) || 0), delay_direction: "after" },
      input.now
    );
    const enqueued = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: input.dedupKey,
    });
    if (!enqueued.ok) return { dispatch: "send_failed", ok: false };
    return { dispatch: "deferred", ok: true };
  }

  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return { dispatch: "gated", ok: false };
  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id, name").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language, components")
      .eq("business_id", input.businessId)
      .eq("name", templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
  ]);
  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!wabaId || !approvedTpl?.id) return { dispatch: "gated", ok: false };
  const firstName = resolveTemplateFirstName(
    { full_name: input.contactFullName },
    input.fullName
  );
  if (
    !firstName &&
    templateBodyUsesFirstNameSlot(LEAD_STATUS_CHANGED_TYPE, (approvedTpl as { components?: unknown }).components)
  ) {
    return { dispatch: "skipped", ok: false };
  }
  const languageCode = String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: LEAD_STATUS_CHANGED_TYPE,
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });
  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    alertTriggerId: input.rule.id,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });
  if (!sendResult.ok) return { dispatch: templateFailureDispatch(sendResult.error), ok: false };
  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(templateName, {
      firstName,
      components: storedComponents,
      bodyParams,
    }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: buildWaSessionId(phoneNumberId, input.phone),
  });
  return { dispatch: "immediate", ok: true };
}

type ContactHit = { id: string; phone: string | null; full_name: string | null; opted_out: boolean };

async function findContact(
  admin: Admin,
  businessId: number,
  leadId: string,
  phone: string | null
): Promise<ContactHit | null> {
  const byUser = await admin
    .from("contacts")
    .select("id, phone, full_name, opted_out")
    .eq("business_id", businessId)
    .eq("arbox_user_id", leadId)
    .limit(1);
  const userRow = (byUser.data ?? [])[0] as ContactHit | undefined;
  if (userRow?.id) return userRow;
  const variants = phone ? contactPhoneLookupVariants(phone) : [];
  if (!variants.length) return null;
  const byPhone = await admin
    .from("contacts")
    .select("id, phone, full_name, opted_out")
    .eq("business_id", businessId)
    .in("phone", variants)
    .limit(1);
  return ((byPhone.data ?? [])[0] as ContactHit | undefined) ?? null;
}

async function rememberContact(input: {
  admin: Admin;
  businessId: number;
  leadId: string;
  phone: string;
  fullName: string | null;
  nowIso: string;
  existing: ContactHit | null;
}): Promise<ContactHit | null> {
  if (isArboxDailyDryRun()) return input.existing;
  const patch = buildTemplateIncomingContactPatch(input.nowIso, ARBOX_NEW_LEAD_CONTACT_SOURCE);
  if (input.existing?.id) {
    delete patch.source;
    const update: Record<string, unknown> = { ...patch, arbox_user_id: input.leadId };
    if (input.fullName) update.full_name = input.fullName;
    const { error } = await input.admin.from("contacts").update(update).eq("id", input.existing.id);
    if (error) {
      console.error("[leads/arbox-lead-status] contact update failed", error.message);
      return input.existing;
    }
    return {
      ...input.existing,
      full_name: input.fullName ?? input.existing.full_name,
      phone: input.existing.phone ?? input.phone,
    };
  }
  const { data, error } = await input.admin
    .from("contacts")
    .insert({
      business_id: input.businessId,
      phone: input.phone,
      full_name: input.fullName,
      arbox_user_id: input.leadId,
      ...patch,
    })
    .select("id, phone, full_name, opted_out")
    .limit(1);
  if (error) {
    console.error("[leads/arbox-lead-status] contact insert failed", error.message);
    return null;
  }
  return ((data ?? [])[0] as ContactHit | undefined) ?? null;
}

export function parseLeadStatusScheduledDedupKey(key: string): {
  triggerId: string;
  leadId: string;
  leadStatus: string;
  enteredAt: string;
} | null {
  const match = /^lead_status_changed:\d+:([^:]+):([^:]+):(.*):(\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/.exec(key);
  if (!match) return null;
  return { triggerId: match[1], leadId: match[2], leadStatus: match[3], enteredAt: match[4] };
}

async function probePendingColumns(admin: Admin): Promise<boolean> {
  const { error } = await admin.from(SYNC_TABLE).select("due_date").limit(1);
  if (!error) return true;
  if (/due_date|schema cache|PGRST204|could not find|does not exist/i.test(error.message)) return false;
  console.error("[leads/arbox-lead-status] pending column probe failed", error.message);
  return false;
}

async function insertPendingEpisode(input: {
  admin: Admin;
  businessId: number;
  triggerId: string;
  leadId: string;
  leadStatus: string;
  enteredAt: string;
  nowIso: string;
  dueDate: string;
  sendSlot: string;
}): Promise<"won" | "lost" | "legacy" | "error"> {
  if (isArboxDailyDryRun()) return "won";
  const { error } = await input.admin.from(SYNC_TABLE).insert({
    business_id: input.businessId,
    trigger_id: input.triggerId,
    lead_id: input.leadId,
    lead_status: input.leadStatus,
    entered_at: input.enteredAt,
    contact_id: null,
    processed_at: input.nowIso,
    status: "pending",
    attempts: 0,
    reason: null,
    created_at: input.nowIso,
    due_date: input.dueDate,
    send_slot: input.sendSlot,
  });
  if (!error) return "won";
  const message = String(error.message ?? "");
  if (String(error.code ?? "") === "23505" || /duplicate/i.test(message)) return "lost";
  if (/due_date|send_slot|schema cache|PGRST204|could not find/i.test(message)) return "legacy";
  console.error("[leads/arbox-lead-status] pending insert failed", message);
  return "error";
}

async function convertLeadStatusStageC(input: {
  admin: Admin;
  businessId: number;
  rules: LeadStatusRule[];
  now: Date;
  nowIso: string;
}): Promise<void> {
  const { data, error } = await input.admin
    .from("scheduled_template_sends")
    .select("dedup_key, due_at, status, trigger_id")
    .eq("business_id", input.businessId)
    .eq("status", "pending")
    .limit(200);
  if (error) {
    if (!/does not exist|42P01/i.test(error.message)) {
      console.error("[leads/arbox-lead-status] stage C read failed", error.message);
    }
    return;
  }
  for (const row of data ?? []) {
    const key = String((row as { dedup_key?: unknown }).dedup_key ?? "");
    const parsed = parseLeadStatusScheduledDedupKey(key);
    if (!parsed) continue;
    const rule = input.rules.find((item) => item.id === parsed.triggerId);
    const dueAt = new Date(String((row as { due_at?: unknown }).due_at ?? ""));
    const dueDate = Number.isNaN(dueAt.getTime())
      ? formatDateYmdIsrael(input.now)
      : formatDateYmdIsrael(dueAt);
    const claimed = await insertPendingEpisode({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: parsed.triggerId,
      leadId: parsed.leadId,
      leadStatus: parsed.leadStatus,
      enteredAt: parsed.enteredAt,
      nowIso: input.nowIso,
      dueDate,
      sendSlot: rule?.send_slot ?? "next_run",
    });
    if (claimed === "error" || claimed === "legacy") continue;
    await cancelPendingScheduledTemplateSendByDedupKey({
      admin: input.admin,
      dedupKey: key,
      reason: "moved_to_lead_status_pending",
    });
  }
}

async function drainLeadStatusPending(input: {
  admin: Admin;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  rules: LeadStatusRule[];
  current: Map<string, LeadStatusPerson>;
  runSlot: "morning" | "evening";
  todayYmd: string;
  now: Date;
  nowIso: string;
  summary: LeadStatusSyncSummary;
  fetchProfile: typeof fetchArboxUserPhone;
  dispatchTemplate?: typeof dispatchLeadStatusTemplate;
}): Promise<void> {
  const { data, error } = await input.admin
    .from(SYNC_TABLE)
    .select("trigger_id, lead_id, lead_status, entered_at, due_date, send_slot, attempts, contact_id, status")
    .eq("business_id", input.businessId)
    .eq("status", "pending")
    .limit(500);
  if (error) {
    if (!/due_date|send_slot|schema cache|PGRST204|could not find/i.test(error.message)) {
      console.error("[leads/arbox-lead-status] pending read failed", error.message);
      input.summary.errors += 1;
    }
    return;
  }
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const leadId = String(row.lead_id ?? "");
    const leadStatus = String(row.lead_status ?? "");
    const enteredAt = String(row.entered_at ?? "");
    const due = String(row.due_date ?? "").slice(0, 10);
    const triggerId = String(row.trigger_id ?? "");
    if (!leadId || leadId === INTEGRITY_LEAD_ID || !enteredAt) continue;
    const close = async (reason: string) => {
      const marked = await upsertSync({
        admin: input.admin,
        businessId: input.businessId,
        triggerId,
        leadId,
        leadStatus,
        enteredAt,
        contactId: row.contact_id != null ? String(row.contact_id) : null,
        nowIso: input.nowIso,
        status: "skipped",
        attempts: parseCancellationSyncAttempts(row.attempts),
        reason,
        dueDate: due || null,
        sendSlot: row.send_slot != null ? String(row.send_slot) : null,
      });
      if (!marked.ok) input.summary.errors += 1;
    };
    if (due && leadStatusPendingExpired(due, input.todayYmd)) {
      await close("expired");
      input.summary.expired += 1;
      continue;
    }
    if (!leadStatusSlotMatches(String(row.send_slot ?? ""), input.runSlot) || (due && due > input.todayYmd)) {
      input.summary.pending_held += 1;
      continue;
    }
    const person = input.current.get(leadId);
    if (!person || person.status !== leadStatus) {
      await close("status_changed_before_send");
      input.summary.skipped_status += 1;
      continue;
    }
    const rule = input.rules.find((item) => item.id === triggerId);
    if (!rule || !leadStatusRuleCanSend(rule, enteredAt, input.now)) {
      await close("activation_cutoff");
      continue;
    }
    await sendOne({
      admin: input.admin,
      businessId: input.businessId,
      businessSlug: input.businessSlug,
      apiKey: input.apiKey,
      person,
      rule,
      enteredAt,
      now: input.now,
      nowIso: input.nowIso,
      summary: input.summary,
      fetchProfile: input.fetchProfile,
      dispatchTemplate: input.dispatchTemplate,
      queueDelay: false,
    });
  }
}

export async function syncArboxLeadStatusForBusiness(input: {
  admin: Admin;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  now?: Date;
  /** Morning or evening slot (lib/daily-run-slots.ts). Defaults to morning for callers that omit it. */
  slot?: "morning" | "evening";
  /** Test hook. Production probes the due_date column. */
  pendingColumns?: boolean;
  fetchLeads?: typeof fetchLeadsInProcessReportRows;
  fetchProfile?: typeof fetchArboxUserPhone;
  /** Test hook. Production uses the APPROVED template gate and Stage C. */
  dispatchTemplate?: typeof dispatchLeadStatusTemplate;
}): Promise<LeadStatusSyncSummary> {
  const summary = emptySummary();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const businessId = Number(input.businessId);
  const rulesResult = await loadRules(input.admin, businessId);
  if (!rulesResult.ok) {
    if (rulesResult.missing) {
      logMissingSchema(businessId, rulesResult.error);
      summary.skipped = true;
      summary.skip_reason = "schema_missing";
      return summary;
    }
    summary.errors += 1;
    summary.fetch_error = rulesResult.error;
    return summary;
  }
  if (!rulesResult.rules.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  const runSlot = input.slot === "evening" ? "evening" : "morning";
  if (
    rulesResult.sendSlotColumn &&
    leadStatusShouldSkipScan(
      rulesResult.rules.map((rule) => rule.send_slot),
      runSlot
    )
  ) {
    summary.skipped = true;
    summary.skip_reason = "scan_slot";
    return summary;
  }

  const scanned = await readLastScanned(input.admin, businessId);
  if (!scanned.ok) {
    if (scanned.missing) {
      logMissingSchema(businessId, scanned.error);
      summary.skipped = true;
      summary.skip_reason = "schema_missing";
      return summary;
    }
    summary.errors += 1;
    summary.fetch_error = scanned.error;
    return summary;
  }
  const snapshot = await readSnapshot(input.admin, businessId);
  if (!snapshot.ok) {
    if (snapshot.missing) {
      logMissingSchema(businessId, snapshot.error);
      summary.skipped = true;
      summary.skip_reason = "schema_missing";
      return summary;
    }
    summary.errors += 1;
    summary.fetch_error = snapshot.error;
    return summary;
  }
  const known = await readKnown(input.admin, businessId);
  if (!known.ok) {
    if (isMissingLeadStatusSchema(known.error)) {
      logMissingSchema(businessId, known.error);
      summary.skipped = true;
      summary.skip_reason = "schema_missing";
      return summary;
    }
    summary.errors += 1;
    summary.fetch_error = known.error;
    return summary;
  }

  let pendingColumns =
    input.pendingColumns ??
    (await probePendingColumns(input.admin));

  const fetchLeads = input.fetchLeads ?? fetchLeadsInProcessReportRows;
  const report = await fetchLeads({
    apiKey: input.apiKey,
    locationId: input.boxId,
    now,
  });
  summary.pages_fetched = report.pagesFetched;
  const indexed = report.ok
    ? indexLeadStatusReport({ rows: report.rows, previous: snapshot.rows })
    : { people: new Map<string, LeadStatusPerson>(), openLeadCount: 0 };
  if (
    leadStatusPullIntegrityBlocked({
      fetchOk: report.ok,
      hitPageCap: Boolean(report.hitPageCap),
      previousOpenLeads: snapshot.rows.size,
      currentOpenLeads: indexed.openLeadCount,
    })
  ) {
    console.error("[leads/arbox-lead-status] pull integrity - no send, snapshot unchanged", {
      businessId,
      fetchOk: report.ok,
      hitPageCap: Boolean(report.hitPageCap),
      previousOpenLeads: snapshot.rows.size,
      currentOpenLeads: indexed.openLeadCount,
    });
    summary.skipped = true;
    summary.skip_reason = "pull_integrity";
    summary.skipped_integrity += 1;
    summary.fetch_error = report.ok ? "pull_integrity" : report.error;
    const rule = rulesResult.rules[0];
    if (rule) {
      const marked = await upsertSync({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        leadId: INTEGRITY_LEAD_ID,
        leadStatus: "pull_integrity",
        enteredAt: `${formatDateYmdIsrael(now)}T00:00:00.000Z`,
        contactId: null,
        nowIso,
        status: "skipped",
        attempts: 0,
        reason: "pull_integrity",
      });
      if (!marked.ok) summary.errors += 1;
    }
    return summary;
  }

  const current = indexed.people;
  summary.open_leads = indexed.openLeadCount;
  const currentStatus = new Map([...current].map(([id, person]) => [id, person.status]));
  const diff = diffLeadStatuses(snapshot.rows, currentStatus);
  summary.transitions = diff.transitions.length;
  summary.added = diff.added.length;
  summary.removed = diff.removed.length;

  const reseed = leadStatusShouldReseed({
    snapshotCount: snapshot.rows.size,
    lastScannedAt: scanned.at,
    now,
    ruleActivationMs: rulesResult.rules.map((rule) => ruleActivationMs(rule)),
  });
  const enteredAt = scanned.at ?? nowIso;
  const knownBefore = known.statuses;
  const todayYmd = formatDateYmdIsrael(now);

  if (!reseed) {
    for (const change of diff.transitions) {
      if (!knownBefore.has(change.to)) {
        summary.skipped_unknown_status += 1;
        continue;
      }
      for (const rule of rulesResult.rules) {
        if (rule.target_status !== change.to) continue;
        if (!leadStatusRuleCanSend(rule, enteredAt, now)) continue;
        const person = current.get(change.leadId);
        if (!person) continue;
        if (!pendingColumns) {
          await sendOne({
            admin: input.admin,
            businessId,
            businessSlug: input.businessSlug,
            apiKey: input.apiKey,
            person,
            rule,
            enteredAt,
            now,
            nowIso,
            summary,
            fetchProfile: input.fetchProfile ?? fetchArboxUserPhone,
            dispatchTemplate: input.dispatchTemplate,
            queueDelay: true,
          });
          continue;
        }
        const dueDate = leadStatusDueYmd(now, rule.delay_days);
        const claimed = await insertPendingEpisode({
          admin: input.admin,
          businessId,
          triggerId: rule.id,
          leadId: change.leadId,
          leadStatus: change.to,
          enteredAt,
          nowIso,
          dueDate,
          sendSlot: rule.send_slot,
        });
        if (claimed === "lost") {
          summary.already += 1;
        } else if (claimed === "legacy") {
          pendingColumns = false;
          await sendOne({
            admin: input.admin,
            businessId,
            businessSlug: input.businessSlug,
            apiKey: input.apiKey,
            person,
            rule,
            enteredAt,
            now,
            nowIso,
            summary,
            fetchProfile: input.fetchProfile ?? fetchArboxUserPhone,
            dispatchTemplate: input.dispatchTemplate,
            queueDelay: true,
          });
        } else if (claimed === "error") {
          summary.errors += 1;
        }
      }
    }
  } else {
    summary.seeded = true;
  }

  if (pendingColumns) {
    await convertLeadStatusStageC({
      admin: input.admin,
      businessId,
      rules: rulesResult.rules,
      now,
      nowIso,
    });
    await drainLeadStatusPending({
      admin: input.admin,
      businessId,
      businessSlug: input.businessSlug,
      apiKey: input.apiKey,
      rules: rulesResult.rules,
      current,
      runSlot,
      todayYmd,
      now,
      nowIso,
      summary,
      fetchProfile: input.fetchProfile ?? fetchArboxUserPhone,
      dispatchTemplate: input.dispatchTemplate,
    });
  }

  const seenAt = nowIso;
  const snapshotWrites: Record<string, unknown>[] = [];
  for (const person of current.values()) {
    const before = snapshot.rows.get(person.leadId);
    if (!reseed && before === person.status) continue;
    snapshotWrites.push({
      business_id: businessId,
      lead_id: person.leadId,
      status: person.status,
      first_seen_at: before == null ? seenAt : undefined,
      last_seen_at: seenAt,
    });
  }
  const snapshotWrite = await writeRows(
    input.admin,
    SNAPSHOT_TABLE,
    snapshotWrites.map((row) => omitBlankFirstSeen(row))
  );
  if (!snapshotWrite.ok) summary.errors += 1;
  const removed = await deleteLeads(input.admin, businessId, diff.removed);
  if (!removed.ok) summary.errors += 1;

  const knownWrites = [...new Set([...current.values()].map((person) => person.status))].map((status) => ({
    business_id: businessId,
    status,
    first_seen_at: knownBefore.has(status) ? undefined : seenAt,
    last_seen_at: seenAt,
  }));
  const knownWrite = await writeRows(
    input.admin,
    KNOWN_TABLE,
    knownWrites.map((row) => omitBlankFirstSeen(row))
  );
  if (!knownWrite.ok) summary.errors += 1;

  if (!isArboxDailyDryRun()) {
    const { error } = await input.admin
      .from("businesses")
      .update({ arbox_lead_status_last_scanned_at: nowIso })
      .eq("id", businessId);
    if (error) {
      console.error("[leads/arbox-lead-status] last_scanned_at update failed", error.message);
      summary.errors += 1;
    }
  }
  return summary;
}

async function sendOne(input: {
  admin: Admin;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  person: LeadStatusPerson;
  rule: LeadStatusRule;
  enteredAt: string;
  now: Date;
  nowIso: string;
  summary: LeadStatusSyncSummary;
  fetchProfile: typeof fetchArboxUserPhone;
  dispatchTemplate?: typeof dispatchLeadStatusTemplate;
  queueDelay: boolean;
}): Promise<void> {
  const { person, rule, summary } = input;
  const { data: existing, error: existingErr } = await input.admin
    .from(SYNC_TABLE)
    .select("status, attempts, contact_id")
    .eq("business_id", input.businessId)
    .eq("trigger_id", rule.id)
    .eq("lead_id", person.leadId)
    .eq("lead_status", person.status)
    .eq("entered_at", input.enteredAt)
    .maybeSingle();
  if (existingErr) {
    logDedupBlockedSend({
      log: "[leads/arbox-lead-status]",
      businessId: input.businessId,
      triggerId: rule.id,
      reason: existingErr.message,
    });
    summary.errors += 1;
    return;
  }
  const existingStatus = String((existing as { status?: unknown } | null)?.status ?? "").trim();
  const attempts = parseCancellationSyncAttempts((existing as { attempts?: unknown } | null)?.attempts);
  if (existingStatus && existingStatus !== "pending" && existingStatus !== "failed") {
    summary.already += 1;
    return;
  }

  let phone = person.phone;
  let fullName = person.fullName;
  let contact = await findContact(input.admin, input.businessId, person.leadId, phone);
  if (contact?.opted_out) {
    summary.skipped_opt_out += 1;
    await upsertSync({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: rule.id,
      leadId: person.leadId,
      leadStatus: person.status,
      enteredAt: input.enteredAt,
      contactId: contact.id,
      nowIso: input.nowIso,
      status: "skipped",
      attempts,
      reason: "opted_out",
    });
    return;
  }
  if (!phone && !isArboxDailyDryRun()) {
    const profile = await input.fetchProfile(input.apiKey, person.leadId);
    phone = profile.phone;
    if (!fullName && profile.fullName) fullName = profile.fullName;
  }
  phone = normalizePhone(contact?.phone) ?? phone;
  const staffUserId = Number(person.leadId);
  if (
    isRetentionStaff(await retentionStaffIndex(input.admin, input.businessId), {
      userId: Number.isFinite(staffUserId) && staffUserId > 0 ? Math.trunc(staffUserId) : null,
      phone,
    })
  ) {
    await upsertSync({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: rule.id,
      leadId: person.leadId,
      leadStatus: person.status,
      enteredAt: input.enteredAt,
      contactId: contact?.id ?? null,
      nowIso: input.nowIso,
      status: "seeded",
      attempts,
      reason: "staff",
    });
    console.info("[retention-staff] skip", {
      trigger: "lead_status_changed",
      businessId: input.businessId,
      user_id: Number.isFinite(staffUserId) ? Math.trunc(staffUserId) : null,
    });
    return;
  }
  if (!phone) {
    summary.no_phone += 1;
    await upsertSync({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: rule.id,
      leadId: person.leadId,
      leadStatus: person.status,
      enteredAt: input.enteredAt,
      contactId: contact?.id ?? null,
      nowIso: input.nowIso,
      status: "no_phone",
      attempts,
      reason: null,
    });
    return;
  }
  if (await retentionAlreadySentToday(input.admin, input.businessId, phone, input.now)) {
    summary.skipped_cap += 1;
    await upsertSync({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: rule.id,
      leadId: person.leadId,
      leadStatus: person.status,
      enteredAt: input.enteredAt,
      contactId: contact?.id ?? null,
      nowIso: input.nowIso,
      status: "skipped",
      attempts,
      reason: "retention_daily_cap",
    });
    await closeRetentionEvent({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: rule.id,
      phone,
      templateName: rule.template_name ?? "",
      dedupKey: scheduledKey(input.businessId, rule.id, person.leadId, person.status, input.enteredAt),
      now: input.now,
    });
    return;
  }

  contact = await rememberContact({
    admin: input.admin,
    businessId: input.businessId,
    leadId: person.leadId,
    phone,
    fullName,
    nowIso: input.nowIso,
    existing: contact,
  });

  if (!isArboxDailyDryRun()) {
    const claim = await claimPendingSyncLog({
      admin: input.admin,
      table: SYNC_TABLE,
      insertRow: {
        business_id: input.businessId,
        trigger_id: rule.id,
        lead_id: person.leadId,
        lead_status: person.status,
        entered_at: input.enteredAt,
        contact_id: contact?.id ?? null,
        processed_at: input.nowIso,
        status: "pending",
        attempts: existing ? attempts : 0,
        reason: null,
        created_at: input.nowIso,
      },
      filters: [
        ["business_id", input.businessId],
        ["trigger_id", rule.id],
        ["lead_id", person.leadId],
        ["lead_status", person.status],
        ["entered_at", input.enteredAt],
      ],
      existingAttempts: existing ? attempts : null,
      nowIso: input.nowIso,
    });
    if (claim !== "won") {
      if (claim === "error") {
        logDedupBlockedSend({
          log: "[leads/arbox-lead-status]",
          businessId: input.businessId,
          triggerId: rule.id,
          reason: "claim_failed",
        });
        summary.errors += 1;
      } else summary.already += 1;
      return;
    }
  }

  const send = await (input.dispatchTemplate ?? dispatchLeadStatusTemplate)({
    admin: input.admin,
    businessId: input.businessId,
    businessSlug: input.businessSlug,
    phone,
    fullName,
    contactFullName: contact?.full_name ?? null,
    rule,
    now: input.now,
    dedupKey: scheduledKey(input.businessId, rule.id, person.leadId, person.status, input.enteredAt),
    queueDelay: input.queueDelay,
  });
  if (send.dispatch === "immediate" || send.dispatch === "deferred" || send.dispatch === "send_unknown") {
    markRetentionSent(input.businessId, phone, input.now);
  }
  if (send.dispatch === "immediate") summary.notified += 1;
  else if (send.dispatch === "deferred") summary.deferred += 1;
  else if (send.dispatch === "gated") summary.gated += 1;
  const next = nextCancellationSyncLogAfterDispatch({
    dispatch: send.dispatch === "no_rule" ? "skipped" : send.dispatch,
    attemptsSoFar: attempts,
  });
  await upsertSync({
    admin: input.admin,
    businessId: input.businessId,
    triggerId: rule.id,
    leadId: person.leadId,
    leadStatus: person.status,
    enteredAt: input.enteredAt,
    contactId: contact?.id ?? null,
    nowIso: input.nowIso,
    status: next.status,
    attempts: next.attempts,
    reason: null,
  });
}
