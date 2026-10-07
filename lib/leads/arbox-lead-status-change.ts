/**
 * lead_status_changed: full leadsInProcessReport pull, diff against the snapshot.
 * fromDate/toDate are ignored by Arbox, so every scan reads all open leads.
 * Runs on the existing 09:00 and 20:30 arbox-daily-triggers workers. No new cron.
 * Missing tables or target_status column: log once, skip, never send.
 */
import { logMessage } from "@/lib/analytics";
import { ARBOX_NEW_LEAD_CONTACT_SOURCE, fetchArboxUserPhone } from "@/lib/leads/arbox-new-lead";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";
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
import {
  buildTemplateIncomingContactPatch,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { eventBeforeRuleActivation, ruleActivationMs, type ActivationRule } from "@/lib/rule-activation";
import { computeDueAt, enqueueScheduledTemplateSend } from "@/lib/scheduled-template-sends";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export const LEAD_STATUS_CHANGED_TYPE = "lead_status_changed";
export const LEAD_STATUS_STALE_MS = 36 * 60 * 60 * 1000;
export const LEAD_STATUS_MASS_COUNT = 20;
export const LEAD_STATUS_MASS_RATIO = 0.25;
const SYNC_TABLE = "arbox_lead_status_change_sync_log";
const SNAPSHOT_TABLE = "arbox_lead_status_snapshot";
const KNOWN_TABLE = "arbox_lead_known_statuses";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type LeadStatusRule = ActivationRule & {
  delay_days: number;
  delay_direction: string;
  template_name: string | null;
  target_status: string;
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
  skipped_mass: number;
  skipped_unknown_status: number;
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

/** Delay of a day or more is Stage C. Delay 0 sends in the run that saw the transition. */
export function leadStatusSendIsQueued(delayDays: number, now: Date): boolean {
  const dueAt = computeDueAt(
    { delay_days: Math.max(0, Math.trunc(delayDays) || 0), delay_direction: "after" },
    now
  );
  return dueAt.getTime() > now.getTime() + 15_000;
}

export function leadStatusMassChangeBlocked(transitions: number, openLeads: number): boolean {
  if (transitions > LEAD_STATUS_MASS_COUNT) return true;
  if (openLeads > 0 && transitions / openLeads > LEAD_STATUS_MASS_RATIO) return true;
  return false;
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
  | { ok: true; rows: Record<string, unknown>[]; pagesFetched: number }
  | { ok: false; error: string; pagesFetched: number }
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
  if (!report.ok) return { ok: false, error: report.error, pagesFetched: report.pagesFetched };
  return { ok: true, rows: report.rows, pagesFetched: report.pagesFetched };
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
    skipped_mass: 0,
    skipped_unknown_status: 0,
    skipped_cap: 0,
    skipped_opt_out: 0,
    gated: 0,
    no_phone: 0,
    errors: 0,
  };
}

async function loadRules(admin: Admin, businessId: number): Promise<
  | { ok: true; rules: LeadStatusRule[] }
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
  if (!enabled.length) return { ok: true, rules: [] };
  const ids = enabled.map((row) => String((row as { id?: unknown }).id ?? ""));
  const withStatus = await admin
    .from("template_triggers")
    .select("id, target_status")
    .in("id", ids)
    .limit(40);
  if (withStatus.error) {
    return {
      ok: false,
      missing: isMissingLeadStatusSchema(withStatus.error.message),
      error: withStatus.error.message,
    };
  }
  const targets = new Map(
    (withStatus.data ?? []).map((row) => [
      String((row as { id?: unknown }).id ?? ""),
      String((row as { target_status?: unknown }).target_status ?? "").trim(),
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
      };
    }),
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
}): Promise<{ ok: boolean }> {
  if (isArboxDailyDryRun()) return { ok: true };
  const row = {
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
  const { error } = await input.admin.from(SYNC_TABLE).upsert(row, {
    onConflict: "business_id,trigger_id,lead_id,lead_status,entered_at",
  });
  if (error) {
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
}): Promise<{ dispatch: "immediate" | "deferred" | "gated" | "skipped" | "send_failed" | "no_rule"; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };
  if (leadStatusSendIsQueued(input.rule.delay_days, input.now)) {
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
  if (!sendResult.ok) return { dispatch: "send_failed", ok: false };
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

export async function syncArboxLeadStatusForBusiness(input: {
  admin: Admin;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  now?: Date;
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

  const fetchLeads = input.fetchLeads ?? fetchLeadsInProcessReportRows;
  const report = await fetchLeads({
    apiKey: input.apiKey,
    locationId: input.boxId,
    now,
  });
  summary.pages_fetched = report.pagesFetched;
  if (!report.ok) {
    summary.errors += 1;
    summary.fetch_error = report.error;
    return summary;
  }

  const current = new Map<string, LeadStatusPerson>();
  for (const raw of report.rows) {
    const person = parseLeadStatusPerson(raw);
    if (person) current.set(person.leadId, person);
  }
  summary.open_leads = current.size;
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
  const mass = !reseed && leadStatusMassChangeBlocked(diff.transitions.length, current.size);
  const enteredAt = scanned.at ?? nowIso;
  const knownBefore = known.statuses;

  if (!reseed) {
    for (const change of diff.transitions) {
      if (!knownBefore.has(change.to)) {
        summary.skipped_unknown_status += 1;
        continue;
      }
      for (const rule of rulesResult.rules) {
        if (rule.target_status !== change.to) continue;
        if (!leadStatusRuleCanSend(rule, enteredAt, now)) continue;
        if (mass) {
          const marked = await upsertSync({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId: change.leadId,
            leadStatus: change.to,
            enteredAt,
            contactId: null,
            nowIso,
            status: "skipped",
            attempts: 0,
            reason: "mass_change",
          });
          if (!marked.ok) summary.errors += 1;
          else summary.skipped_mass += 1;
          continue;
        }
        await sendOne({
          admin: input.admin,
          businessId,
          businessSlug: input.businessSlug,
          apiKey: input.apiKey,
          person: current.get(change.leadId)!,
          rule,
          enteredAt,
          now,
          nowIso,
          summary,
          fetchProfile: input.fetchProfile ?? fetchArboxUserPhone,
          dispatchTemplate: input.dispatchTemplate,
        });
      }
    }
  } else {
    summary.seeded = true;
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
  if (existingStatus && existingStatus !== "pending") {
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
  });
  if (send.dispatch === "immediate" || send.dispatch === "deferred") {
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
