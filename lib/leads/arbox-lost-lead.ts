/**
 * A7 lost_lead win-back: lostLeadsReport → MARKETING template.
 * delay_days = 0 runs on arbox-trial-sync (about 15 min, night-held 21:00-08:00).
 * Due when lost_date is today or yesterday (grace for a mark during the hold).
 * delay_days >= 1 stays on the 09:00 daily path: one lostLeadsReport per distinct
 * delay, fromDate = toDate = today minus N, so N > 30 still fires.
 * A check-in=Yes within LOST_LEAD_RECENT_CHECKIN_DAYS belongs to attendance_gap.
 * Delay 0 fetches that bookingsReport only when a due row is still open in the log.
 * Seed 30d without WhatsApp.
 */
import { MORNING_SLOT_IL } from "@/lib/daily-run-slots";
import { upsertOptionalReason } from "@/lib/leads/sync-log-reason";
import { logMessage } from "@/lib/analytics";
import { claimPendingSyncLog, logDedupBlockedSend } from "@/lib/leads/dedup-fail-closed";
import { closeRetentionEvent, markRetentionSent, retentionAlreadySentToday } from "@/lib/leads/retention-daily-cap";
import { isRetentionStaff, retentionStaffIndex } from "@/lib/leads/arbox-staff";
import { buildLostLeadScheduledDedupKey } from "@/lib/scheduled-template-sends";
import {
  addCalendarDaysYmd,
  decideActivationEventAction,
  eventBeforeRuleActivation,
  israelSlotInstant,
  parseReportEventInstant,
} from "@/lib/rule-activation";
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import {
  formatDateYmdIsrael,
  isExactDaysAfterEvent,
  nextCancellationSyncLogAfterDispatch,
  shouldRetryCancellationSyncLog,
  parseCancellationSyncAttempts,
  parseCancelledEventDate,
  reportTimestampToYmd,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import {
  fetchArboxActiveProductKeys,
  matchesActiveProduct,
  type ActiveProductKeys,
} from "@/lib/leads/arbox-active-product";
import { ymdDiffDays } from "@/lib/leads/arbox-attendance-gap";
import { bookingsReportSharedLookbackWindow } from "@/lib/leads/arbox-missed-class";
import { fetchLostLeadsReportRows } from "@/lib/leads/arbox-lost-leads-report";
import {
  fetchArboxBookingsReport,
  isBookingCheckedIn,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import {
  createCompanionSendGate,
  orderAllRulesWithCompanion,
} from "@/lib/same-trigger-template-order";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledLostLeadTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** First-run / soft-seed window — Arbox reports reject spans over 31 days. */
export const LOST_LEAD_SEED_SPAN_DAYS = 30;
/** After seed: fromDate = today − this many days (late rows still appear). */
export const LOST_LEAD_LOOKBACK_DAYS = 3;
/**
 * Check-in=Yes this many days back (inclusive of today) → attendance_gap owns the
 * contact and lost_lead skips. Same for every business; not a per-business setting.
 * Matched against the daily cron's existing bookingsReport rows (no extra Arbox call).
 */
export const LOST_LEAD_RECENT_CHECKIN_DAYS = 30;

export const LOST_LEAD_SOFT_SEED_SENTINEL_LEAD_ID = 0;
export const LOST_LEAD_SOFT_SEED_SENTINEL_LOST_DATE = "1970-01-01";

/**
 * Latest check-in=Yes inside the shared bookings window.
 * Join key: bookingsReport.user_id (same id as lostLeadsReport.lead_id / user_id).
 * Phone is only a fallback, via contactPhoneLookupVariants, when the user id misses.
 */
export type LostLeadRecentCheckInIndex = {
  byUserId: Map<number, string>;
  byPhone: Map<string, string>;
};

function rememberLatestYmd<K>(map: Map<K, string>, key: K, ymd: string): void {
  const prev = map.get(key);
  if (!prev || ymd > prev) map.set(key, ymd);
}

export function buildLostLeadRecentCheckInIndex(input: {
  rows: readonly Pick<ArboxBookingReportRow, "user_id" | "phone" | "date" | "check_in">[];
  todayYmd: string;
  withinDays?: number;
}): LostLeadRecentCheckInIndex {
  const within = input.withinDays ?? LOST_LEAD_RECENT_CHECKIN_DAYS;
  const byUserId = new Map<number, string>();
  const byPhone = new Map<string, string>();
  for (const row of input.rows) {
    if (!isBookingCheckedIn(row.check_in)) continue;
    const ymd = parseClassDateYmd(row.date);
    if (!ymd) continue;
    const diff = ymdDiffDays(input.todayYmd, ymd);
    if (diff == null || diff < 0 || diff > within) continue;
    const userId = parseLostLeadId({ user_id: row.user_id });
    if (userId != null) rememberLatestYmd(byUserId, userId, ymd);
    const phone = normalizePhone(row.phone);
    if (!phone) continue;
    for (const variant of contactPhoneLookupVariants(phone)) {
      rememberLatestYmd(byPhone, variant, ymd);
    }
  }
  return { byUserId, byPhone };
}

/** Latest check-in YMD within the index window, or null. User id wins over phone. */
export function lostLeadRecentCheckInYmd(input: {
  index: LostLeadRecentCheckInIndex | null | undefined;
  userId: number | null;
  phone: string | null;
}): string | null {
  const index = input.index;
  if (!index) return null;
  if (input.userId != null) {
    const byUser = index.byUserId.get(input.userId);
    if (byUser) return byUser;
  }
  const phone = normalizePhone(input.phone);
  if (!phone) return null;
  for (const variant of contactPhoneLookupVariants(phone)) {
    const byPhone = index.byPhone.get(variant);
    if (byPhone) return byPhone;
  }
  return null;
}

export type ArboxLostLeadRow = {
  lead_id?: unknown;
  user_id?: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  lost_date?: unknown;
  lost_reason_name?: unknown;
  created_at?: unknown;
  source_name?: unknown;
};

export type LostLeadDispatch =
  | "immediate"
  | "deferred"
  | "gated"
  | "skipped"
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "skipped_active"
  | "skipped_recent_checkin"
  | "send_failed"
  | "send_unknown";

export type LostLeadSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched: number;
  pages_fetched: number;
  seeded: number;
  soft_seeded: number;
  processed: number;
  already: number;
  skipped_active: number;
  skipped_recent_checkin: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  abandoned: number;
  errors: number;
  fetch_error?: string;
};

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

/** Trimmed report lost_date — PK grain. Empty → not a valid lost-lead event. */
export function normalizeLostDatePk(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

/** lead_id from the report (same as user_id). Prefer lead_id, then user_id. */
export function parseLostLeadId(row: Pick<ArboxLostLeadRow, "lead_id" | "user_id">): number | null {
  const fromLead = parsePositiveInt(row.lead_id);
  if (fromLead != null) return fromLead;
  return parsePositiveInt(row.user_id);
}

function parsePositiveInt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function parseLostEventDate(raw: unknown, now: Date = new Date()): Date {
  return parseCancelledEventDate(raw, now);
}

export function seedLostLeadReportDateRange(now: Date): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(now);
  const fromDate = formatDateYmdIsrael(
    new Date(now.getTime() - LOST_LEAD_SEED_SPAN_DAYS * MS_PER_DAY)
  );
  return { fromDate, toDate };
}

export function lostLeadReportDateRange(input: {
  seeded: boolean;
  now: Date;
  lookbackDays?: number;
}): { fromDate: string; toDate: string } {
  if (!input.seeded) return seedLostLeadReportDateRange(input.now);
  const toDate = formatDateYmdIsrael(input.now);
  const days = Math.max(
    LOST_LEAD_LOOKBACK_DAYS,
    Math.trunc(input.lookbackDays ?? LOST_LEAD_LOOKBACK_DAYS)
  );
  const fromDate = formatDateYmdIsrael(new Date(input.now.getTime() - days * MS_PER_DAY));
  return { fromDate, toDate };
}

export type LostLeadLane = "daily" | "immediate";

/** Calendar shift on a YYYY-MM-DD string. Noon UTC avoids a DST day slip. */
export function shiftLostLeadYmd(ymd: string, deltaDays: number): string {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  const shifted = new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + deltaDays, 12));
  return shifted.toISOString().slice(0, 10);
}

/** Delay 0 on the 15-min cron. Delay >= 1 stays on the 09:00 cron. */
export function lostLeadRulesForLane<T extends { delay_days: number }>(
  rules: readonly T[],
  lane: LostLeadLane
): T[] {
  return rules.filter((rule) => {
    const days = Math.trunc(Number(rule.delay_days) || 0);
    return lane === "immediate" ? days === 0 : days >= 1;
  });
}

/** Yesterday through today. A 22:00 mark (lost_date = that day) is still due at 08:00 next morning. */
export function lostLeadImmediateWindow(now: Date): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(now);
  return { fromDate: shiftLostLeadYmd(toDate, -1), toDate };
}

export function isLostLeadImmediateDue(eventYmd: string, todayYmd: string): boolean {
  return eventYmd === todayYmd || eventYmd === shiftLostLeadYmd(todayYmd, -1);
}

export function lostLeadNormalSendAt(
  lostDate: string,
  delayDays: number,
  todayYmd: string,
  now: Date
): Date | null {
  const eventYmd = reportTimestampToYmd(lostDate);
  if (!eventYmd) return null;
  const delay = Math.max(0, Math.trunc(Number(delayDays) || 0));
  if (delay === 0) {
    return isLostLeadImmediateDue(eventYmd, todayYmd) ? new Date(now.getTime() + 60_000) : null;
  }
  const due = addCalendarDaysYmd(eventYmd, delay);
  return due ? israelSlotInstant(due, MORNING_SLOT_IL) : null;
}

/** One lostLeadsReport day per distinct delay: fromDate = toDate = today - N. */
export function distinctLostLeadDailyDelays(delayDays: readonly number[]): number[] {
  const delays = new Set<number>();
  for (const raw of delayDays) {
    const days = Math.trunc(Number(raw) || 0);
    if (days >= 1) delays.add(days);
  }
  return [...delays].sort((a, b) => a - b);
}

export function lostLeadTargetYmd(todayYmd: string, delayDays: number): string {
  return shiftLostLeadYmd(todayYmd, -Math.max(1, Math.trunc(delayDays)));
}

/** Bookings for the 30-day check-in gate: only a delay-0 run with an open due row, and no rows already in hand. */
export function lostLeadShouldFetchRecentCheckIns(input: {
  lane: LostLeadLane;
  openDueCandidates: number;
  bookingsAlreadyProvided: boolean;
}): boolean {
  return input.lane === "immediate" && !input.bookingsAlreadyProvided && input.openDueCandidates > 0;
}

/** Flag already true + empty log → soft-seed (rule added later) instead of blasting. */
export function lostLeadNeedsSoftSeed(input: {
  lostLeadSeeded: boolean;
  logCount: number;
}): boolean {
  return input.lostLeadSeeded && input.logCount === 0;
}

function resolveReportFullName(row: ArboxLostLeadRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

type ContactRow = {
  id: string;
  phone?: string | null;
  full_name?: string | null;
  arbox_user_id?: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxLostLeadRow;
  leadId: number;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const arboxUserId = String(input.leadId);
  const contactSelect = "id, phone, full_name, arbox_user_id";
  let phoneNorm = normalizePhone(input.row.phone);
  const fullName = resolveReportFullName(input.row);

  let existing: ContactRow | undefined;
  const { data: byUser } = await input.admin
    .from("contacts")
    .select(contactSelect)
    .eq("business_id", input.businessId)
    .eq("arbox_user_id", arboxUserId)
    .order("updated_at", { ascending: false })
    .limit(1);
  existing = byUser?.[0] as ContactRow | undefined;

  if (!phoneNorm && existing) {
    phoneNorm = normalizePhone(existing.phone);
  }

  if (!existing && phoneNorm) {
    const variants = contactPhoneLookupVariants(phoneNorm);
    const { data } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", input.businessId)
      .in("phone", variants.length ? variants : [phoneNorm])
      .order("updated_at", { ascending: false })
      .limit(1);
    existing = data?.[0] as ContactRow | undefined;
  }

  if (existing?.id) {
    phoneNorm = normalizePhone(existing.phone) ?? phoneNorm;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (String(existing.arbox_user_id ?? "").trim() !== arboxUserId) {
      patch.arbox_user_id = arboxUserId;
    }
    if (fullName && !String(existing.full_name ?? "").trim()) patch.full_name = fullName;
    if (Object.keys(patch).length > 1) {
      await input.admin.from("contacts").update(patch).eq("id", existing.id);
    }
    return { contact: existing, phone: phoneNorm };
  }

  if (!phoneNorm) return { contact: null, phone: null };

  const nowIso = new Date().toISOString();
  const { data: inserted, error } = await input.admin
    .from("contacts")
    .insert({
      business_id: input.businessId,
      phone: phoneNorm,
      full_name: fullName,
      source: "arbox_lost_lead",
      arbox_user_id: arboxUserId,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error("[leads/arbox-lost-lead] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertLostLeadSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  leadId: number;
  lostDate: string;
  contactId: string | null;
  nowIso: string;
  status: CancellationSyncLogStatus;
  attempts: number;
  reason?: string | null;
}): Promise<{ ok: boolean }> {
  const row: Record<string, unknown> = {
    business_id: input.businessId,
    trigger_id: input.triggerId,
    lead_id: input.leadId,
    lost_date: input.lostDate,
    contact_id: input.contactId,
    processed_at: input.nowIso,
    status: input.status,
    attempts: input.attempts,
  };
  return upsertOptionalReason(
    input.admin,
    "arbox_lost_lead_sync_log",
    row,
    "business_id,trigger_id,lead_id,lost_date",
    input.reason || undefined
  );
}

async function dispatchLostLeadTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  contactFullName?: string | null;
  leadId: number;
  lostDate: string;
  rule: PurchaseTemplateTriggerRule;
}): Promise<{ dispatch: LostLeadDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

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
    { full_name: input.contactFullName ?? null },
    input.fullName
  );
  if (!firstName && templateBodyUsesFirstNameSlot("lost_lead", (approvedTpl as { components?: unknown }).components)) {
    console.info("[leads/arbox-lost-lead] skip", { reason: "no_valid_name" });
    return { dispatch: "skipped", ok: false };
  }
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "lost_lead",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    alertTriggerId: input.rule.id,
    eventDedupKey: buildLostLeadScheduledDedupKey(input.businessId, input.rule.id, input.leadId, input.lostDate),
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-lost-lead] template send failed:", sendResult.error);
    return { dispatch: templateFailureDispatch(sendResult.error), ok: false };
  }

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

/**
 * lost_lead step for one Arbox business.
 *
 * lane "daily" (09:00): delay >= 1. One lostLeadsReport per distinct delay, that
 * exact Israel day. Check-in rows come from the daily prefetch when it ran.
 * lane "immediate" (15 min): delay 0 only. Window is yesterday+today. Bookings
 * for the 30-day check-in gate are fetched only when a due row is still open.
 * A failed bookings fetch returns without claiming, so the next tick retries.
 *
 * Seed (arbox_lost_lead_seeded=false): mark the 30-day window seen, no WhatsApp.
 * Soft-seed: flag true + empty log for that trigger_id → mark the fetched rows, no WhatsApp.
 */
export async function syncArboxLostLeadForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  lostLeadSeeded: boolean;
  now?: Date;
  /** daily = delay >= 1 at 09:00. immediate = delay 0 on the 15-min cron. */
  lane?: LostLeadLane;
  /** Shared daily-cron read. When set, this step does not fetch again. */
  activeProductKeys?: ActiveProductKeys;
  /**
   * bookingsReport rows already pulled this run (past window, ≤31 days).
   * Absent on the daily lane → no check-in gate.
   * Absent on the immediate lane → fetched lazily when a due row is still open.
   */
  recentCheckInRows?: readonly Pick<ArboxBookingReportRow, "user_id" | "phone" | "date" | "check_in">[];
  /** Test hook. Production uses lostLeadsReport. */
  fetchLostLeads?: typeof fetchLostLeadsReportRows;
  /** Test hook. Production uses the shared 30-day bookings window. */
  fetchBookings?: typeof fetchArboxBookingsReport;
}): Promise<LostLeadSyncSummary> {
  const summary: LostLeadSyncSummary = {
    fetched: 0,
    pages_fetched: 0,
    seeded: 0,
    soft_seeded: 0,
    processed: 0,
    already: 0,
    skipped_active: 0,
    skipped_recent_checkin: 0,
    notified: 0,
    deferred: 0,
    gated: 0,
    no_phone: 0,
    abandoned: 0,
    errors: 0,
  };

  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const lane: LostLeadLane = input.lane === "immediate" ? "immediate" : "daily";
  const fetchLostLeads = input.fetchLostLeads ?? fetchLostLeadsReportRows;
  const fetchBookings = input.fetchBookings ?? fetchArboxBookingsReport;
  const allRules = orderAllRulesWithCompanion(
    await loadEnabledLostLeadTemplateTriggers(input.admin, businessId)
  );
  const rulesWithTemplate = lostLeadRulesForLane(allRules, lane);
  if (!rulesWithTemplate.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-lost-lead] skip — no enabled lost_lead rule", {
      businessId,
      businessSlug,
      lane,
    });
    return summary;
  }

  const needsFullSeed = !input.lostLeadSeeded;
  const todayYmd = formatDateYmdIsrael(now);

  const fetchedRows: Record<string, unknown>[] = [];
  if (needsFullSeed) {
    const range = seedLostLeadReportDateRange(now);
    const report = await fetchLostLeads({
      apiKey,
      fromDate: range.fromDate,
      toDate: range.toDate,
      locationId: boxId,
    });
    summary.pages_fetched += report.pagesFetched;
    if (!report.ok) {
      summary.fetch_error = report.error;
      summary.errors += 1;
      return summary;
    }
    fetchedRows.push(...report.rows);
  } else if (lane === "immediate") {
    const range = lostLeadImmediateWindow(now);
    const report = await fetchLostLeads({
      apiKey,
      fromDate: range.fromDate,
      toDate: range.toDate,
      locationId: boxId,
    });
    summary.pages_fetched += report.pagesFetched;
    if (!report.ok) {
      summary.fetch_error = report.error;
      summary.errors += 1;
      return summary;
    }
    fetchedRows.push(...report.rows);
  } else {
    const seen = new Set<string>();
    for (const delayDays of distinctLostLeadDailyDelays(rulesWithTemplate.map((rule) => rule.delay_days))) {
      const targetYmd = lostLeadTargetYmd(todayYmd, delayDays);
      const report = await fetchLostLeads({
        apiKey,
        fromDate: targetYmd,
        toDate: targetYmd,
        locationId: boxId,
      });
      summary.pages_fetched += report.pagesFetched;
      if (!report.ok) {
        summary.fetch_error = report.error;
        summary.errors += 1;
        return summary;
      }
      for (const raw of report.rows) {
        const row = raw as ArboxLostLeadRow;
        const leadId = parseLostLeadId(row);
        const lostDate = normalizeLostDatePk(row.lost_date);
        const key = leadId != null && lostDate ? `${leadId}|${lostDate}` : "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        fetchedRows.push(raw);
      }
    }
  }
  summary.fetched = fetchedRows.length;
  const reportRows = fetchedRows;

  type ActiveProductState = { kind: "ready"; keys: ActiveProductKeys } | { kind: "failed" };
  let activeProductState: ActiveProductState | undefined;

  async function ensureActiveProductKeys(): Promise<ActiveProductKeys | null> {
    if (input.activeProductKeys) return input.activeProductKeys;
    if (activeProductState?.kind === "ready") return activeProductState.keys;
    if (activeProductState?.kind === "failed") return null;
    const { data: bizRow } = await input.admin
      .from("businesses")
      .select("arbox_trial_membership_type_ids")
      .eq("id", businessId)
      .maybeSingle();
    const fetched = await fetchArboxActiveProductKeys({
      apiKey,
      boxId,
      now,
      trialMembershipTypeIds: (bizRow as { arbox_trial_membership_type_ids?: unknown } | null)
        ?.arbox_trial_membership_type_ids,
    });
    if (!fetched.ok) {
      activeProductState = { kind: "failed" };
      summary.errors += 1;
      summary.fetch_error = fetched.error;
      console.error("[leads/arbox-lost-lead] active product fetch failed", {
        businessId,
        businessSlug,
        error: fetched.error,
      });
      return null;
    }
    activeProductState = { kind: "ready", keys: fetched.keys };
    return fetched.keys;
  }

  async function seedRuleRows(
    rule: PurchaseTemplateTriggerRule,
    kind: "seeded" | "soft_seeded"
  ): Promise<number> {
    let wrote = 0;
    for (const raw of reportRows) {
      const row = raw as ArboxLostLeadRow;
      const leadId = parseLostLeadId(row);
      const lostDate = normalizeLostDatePk(row.lost_date);
      if (leadId == null || !lostDate) continue;
      const sendAt = lostLeadNormalSendAt(lostDate, rule.delay_days, todayYmd, now);
      if (decideActivationEventAction({ sendAt, now }) === "send") continue;
      const marked = await upsertLostLeadSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        leadId,
        lostDate,
        contactId: null,
        nowIso,
        status: "seeded",
        attempts: 0,
      });
      if (!marked.ok) {
        summary.errors += 1;
        continue;
      }
      wrote += 1;
      if (kind === "seeded") summary.seeded += 1;
      else summary.soft_seeded += 1;
      console.info("[leads/arbox-lost-lead] dispatch", {
        businessId,
        trigger_id: rule.id,
        lead_id: leadId,
        lost_date: lostDate,
        contact: null,
        dispatch: "seeded" satisfies LostLeadDispatch,
      });
    }
    if (wrote === 0) {
      const sentinel = await upsertLostLeadSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        leadId: LOST_LEAD_SOFT_SEED_SENTINEL_LEAD_ID,
        lostDate: LOST_LEAD_SOFT_SEED_SENTINEL_LOST_DATE,
        contactId: null,
        nowIso,
        status: "seeded",
        attempts: 0,
      });
      if (sentinel.ok) {
        wrote += 1;
        if (kind === "seeded") summary.seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
    }
    return wrote;
  }

  if (needsFullSeed) {
    for (const rule of allRules) {
      await seedRuleRows(rule, "seeded");
    }
    const { error: flagErr } = await input.admin
      .from("businesses")
      .update({ arbox_lost_lead_seeded: true })
      .eq("id", businessId);
    if (flagErr) {
      console.error("[leads/arbox-lost-lead] seed flag update failed:", flagErr.message);
      summary.errors += 1;
      summary.fetch_error = "arbox_lost_lead_seeded_flag_failed";
    }
    console.info("[leads/arbox-lost-lead] seeded 30-day window", {
      businessId,
      businessSlug,
      seeded: summary.seeded,
    });
  }

  let recentCheckInIndex = input.recentCheckInRows
    ? buildLostLeadRecentCheckInIndex({
        rows: input.recentCheckInRows,
        todayYmd,
      })
    : null;

  if (!needsFullSeed) {
    for (const rule of rulesWithTemplate) {
      const { count, error } = await input.admin
        .from("arbox_lost_lead_sync_log")
        .select("lead_id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("trigger_id", rule.id);
      if (error) {
        console.error("[leads/arbox-lost-lead] per-trigger seed count failed:", error.message);
        continue;
      }
      if ((count ?? 0) > 0) continue;
      await seedRuleRows(rule, "soft_seeded");
    }
  }

  const rowIsDue = (eventYmd: string | null, delayDays: number): boolean => {
    if (!eventYmd) return false;
    if (lane === "immediate") return isLostLeadImmediateDue(eventYmd, todayYmd);
    return isExactDaysAfterEvent({ eventYmd, todayYmd, delayDays });
  };

  let openDueCandidates = 0;
  if (lane === "immediate" && !input.recentCheckInRows) {
    for (const raw of reportRows) {
      const row = raw as ArboxLostLeadRow;
      const leadId = parseLostLeadId(row);
      const lostDate = normalizeLostDatePk(row.lost_date);
      const eventYmd = reportTimestampToYmd(lostDate);
      if (leadId == null || !lostDate || leadId === LOST_LEAD_SOFT_SEED_SENTINEL_LEAD_ID) continue;
      for (const rule of rulesWithTemplate) {
        if (!rowIsDue(eventYmd, rule.delay_days)) continue;
        const { data: existing, error: existingErr } = await input.admin
          .from("arbox_lost_lead_sync_log")
          .select("status")
          .eq("business_id", businessId)
          .eq("trigger_id", rule.id)
          .eq("lead_id", leadId)
          .eq("lost_date", lostDate)
          .maybeSingle();
        if (existingErr) continue;
        const status = String((existing as { status?: unknown } | null)?.status ?? "");
        if (!shouldRetryCancellationSyncLog(status)) continue;
        if (
          eventBeforeRuleActivation(
            lostLeadNormalSendAt(lostDate, rule.delay_days, todayYmd, now) ?? parseReportEventInstant(lostDate),
            rule
          )
        ) {
          continue;
        }
        openDueCandidates += 1;
      }
    }
  }

  if (
    lostLeadShouldFetchRecentCheckIns({
      lane,
      openDueCandidates,
      bookingsAlreadyProvided: Boolean(input.recentCheckInRows),
    })
  ) {
    const window = bookingsReportSharedLookbackWindow({
      now,
      missedNeedsSeed: false,
      forceWidePast: true,
    });
    const bookings = await fetchBookings({
      apiKey,
      fromDate: window.fromDate,
      toDate: window.toDate,
      locationId: boxId,
    });
    summary.pages_fetched += bookings.pagesFetched;
    if (!bookings.ok) {
      summary.fetch_error = bookings.error;
      summary.errors += 1;
      console.error("[leads/arbox-lost-lead] recent check-in fetch failed — leave unclaimed", {
        businessId,
        businessSlug,
        error: bookings.error,
      });
      return summary;
    }
    recentCheckInIndex = buildLostLeadRecentCheckInIndex({
      rows: bookings.rows,
      todayYmd,
    });
  }

  const staffIndex = await retentionStaffIndex(input.admin, businessId);
  for (const raw of reportRows) {
    const row = raw as ArboxLostLeadRow;
    const leadId = parseLostLeadId(row);
    const lostDate = normalizeLostDatePk(row.lost_date);
    if (leadId == null || !lostDate) {
      summary.errors += 1;
      continue;
    }
    if (leadId === LOST_LEAD_SOFT_SEED_SENTINEL_LEAD_ID) continue;

    const eventYmd = reportTimestampToYmd(lostDate);
    let resolved: Awaited<ReturnType<typeof resolveOrCreateContact>> | undefined;
    const companionGate = createCompanionSendGate(isArboxDailyDryRun());

    for (const rule of rulesWithTemplate) {
      if (!rowIsDue(eventYmd, rule.delay_days)) {
        continue;
      }

      summary.processed += 1;
      const logBase = {
        businessId,
        trigger_id: rule.id,
        lead_id: leadId,
        lost_date: lostDate,
      };

      try {
        const { data: existing, error: existingErr } = await input.admin
          .from("arbox_lost_lead_sync_log")
          .select("status, attempts, contact_id")
          .eq("business_id", businessId)
          .eq("trigger_id", rule.id)
          .eq("lead_id", leadId)
          .eq("lost_date", lostDate)
          .maybeSingle();
        if (existingErr) {
          logDedupBlockedSend({
            log: "[leads/arbox-lost-lead]",
            businessId,
            triggerId: rule.id,
            reason: existingErr.message,
          });
          summary.errors += 1;
          continue;
        }

        const existingStatus = String((existing as { status?: unknown } | null)?.status ?? "").trim();
        const existingAttempts = parseCancellationSyncAttempts(
          (existing as { attempts?: unknown } | null)?.attempts
        );
        if (existingStatus && existingStatus !== "pending") {
          summary.already += 1;
          console.info("[leads/arbox-lost-lead] dispatch", {
            ...logBase,
            dispatch: "already" satisfies LostLeadDispatch,
          });
          continue;
        }

        if (
          eventBeforeRuleActivation(
            lostLeadNormalSendAt(lostDate, rule.delay_days, todayYmd, now) ?? parseReportEventInstant(lostDate),
            rule
          )
        ) {
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: null,
            nowIso,
            status: "skipped",
            attempts: existingAttempts,
            reason: "before_activation",
          });
          if (!marked.ok) summary.errors += 1;
          continue;
        }

        if (!resolved) {
          resolved = await resolveOrCreateContact({
            admin: input.admin,
            businessId,
            row,
            leadId,
          });
        }
        const matchPhone = resolved.phone ?? normalizePhone(row.phone);
        const recentCheckInYmd = lostLeadRecentCheckInYmd({
          index: recentCheckInIndex,
          userId: leadId,
          phone: matchPhone,
        });
        if (recentCheckInYmd) {
          summary.skipped_recent_checkin += 1;
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "skipped",
            attempts: existingAttempts,
          });
          if (!marked.ok) summary.errors += 1;
          console.info("[leads/arbox-lost-lead] dispatch", {
            ...logBase,
            contact: resolved.contact?.id ?? null,
            phone: matchPhone ? maskPhoneForLog(matchPhone) : null,
            last_check_in: recentCheckInYmd,
            dispatch: "skipped_recent_checkin" satisfies LostLeadDispatch,
          });
          continue;
        }

        const phone = resolved.phone;
        if (isRetentionStaff(staffIndex, { userId: leadId, phone })) {
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "seeded",
            attempts: existingAttempts,
            reason: "staff",
          });
          if (!marked.ok) summary.errors += 1;
          console.info("[retention-staff] skip", { trigger: "lost_lead", businessId, user_id: leadId });
          continue;
        }
        if (!phone) {
          summary.no_phone += 1;
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "no_phone",
            attempts: existingAttempts,
          });
          if (!marked.ok) summary.errors += 1;
          console.info("[leads/arbox-lost-lead] dispatch", {
            ...logBase,
            contact: resolved.contact?.id ?? null,
            dispatch: "no_phone" satisfies LostLeadDispatch,
          });
          continue;
        }

        const activeKeys = await ensureActiveProductKeys();
        if (!activeKeys) {
          console.info("[leads/arbox-lost-lead] dispatch", {
            ...logBase,
            contact: resolved.contact?.id ?? null,
            dispatch: "active_check_failed",
          });
          continue;
        }
        if (
          matchesActiveProduct({
            userId: leadId,
            phone,
            keys: activeKeys,
          })
        ) {
          summary.skipped_active += 1;
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "seeded",
            attempts: existingAttempts,
          });
          if (!marked.ok) summary.errors += 1;
          console.info("[leads/arbox-lost-lead] dispatch", {
            ...logBase,
            contact: resolved.contact?.id ?? null,
            phone: maskPhoneForLog(phone),
            dispatch: "skipped_active" satisfies LostLeadDispatch,
          });
          continue;
        }

        const templateName = String(rule.template_name ?? "").trim();
        if (await retentionAlreadySentToday(input.admin, businessId, phone, now)) {
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: "skipped",
            attempts: existingAttempts,
            reason: "retention_daily_cap",
          });
          if (!marked.ok) summary.errors += 1;
          await closeRetentionEvent({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            phone,
            templateName,
            dedupKey: buildLostLeadScheduledDedupKey(businessId, rule.id, leadId, lostDate),
            now,
          });
          console.info("[leads/arbox-lost-lead] dispatch", {
            ...logBase,
            phone: maskPhoneForLog(phone),
            dispatch: "skipped",
            reason: "retention_daily_cap",
          });
          continue;
        }
        if ((await companionGate.before(templateName)) === "skip") continue;

        if (!isArboxDailyDryRun()) {
          const claim = await claimPendingSyncLog({
            admin: input.admin,
            table: "arbox_lost_lead_sync_log",
            insertRow: {
              business_id: businessId,
              trigger_id: rule.id,
              lead_id: leadId,
              lost_date: lostDate,
              contact_id: resolved.contact?.id ?? null,
              processed_at: nowIso,
              status: "pending",
              attempts: existing ? existingAttempts : 0,
            },
            filters: [
              ["business_id", businessId],
              ["trigger_id", rule.id],
              ["lead_id", leadId],
              ["lost_date", lostDate],
            ],
            existingAttempts: existing ? existingAttempts : null,
            nowIso,
          });
          if (claim !== "won") {
            if (claim === "error") {
              logDedupBlockedSend({
                log: "[leads/arbox-lost-lead]",
                businessId,
                triggerId: rule.id,
                reason: "claim_failed",
              });
              summary.errors += 1;
            } else {
              summary.already += 1;
            }
            continue;
          }
        }

        const send = await dispatchLostLeadTemplate({
          admin: input.admin,
          businessId,
          businessSlug,
          phone,
          fullName: resolveReportFullName(row),
          contactFullName: resolved.contact?.full_name ?? null,
          leadId,
          lostDate,
          rule,
        });
        companionGate.after(templateName, send.dispatch);

        if (send.dispatch === "immediate" || send.dispatch === "deferred" || send.dispatch === "send_unknown") {
          markRetentionSent(businessId, phone, now);
        }
        if (send.dispatch === "immediate") summary.notified += 1;
        else if (send.dispatch === "deferred") summary.deferred += 1;
        else if (send.dispatch === "gated") summary.gated += 1;

        console.info("[leads/arbox-lost-lead] dispatch", {
          ...logBase,
          contact: resolved.contact?.id ?? null,
          phone: maskPhoneForLog(phone),
          dispatch: send.dispatch,
        });

        if (
          send.dispatch === "immediate" ||
          send.dispatch === "deferred" ||
          send.dispatch === "gated" ||
          send.dispatch === "skipped" ||
          (send.dispatch === "send_failed" || send.dispatch === "send_unknown")
        ) {
          const next = nextCancellationSyncLogAfterDispatch({
            dispatch: send.dispatch,
            attemptsSoFar: existingAttempts,
          });
          if (next.hitCap) summary.abandoned += 1;
          const marked = await upsertLostLeadSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            leadId,
            lostDate,
            contactId: resolved.contact?.id ?? null,
            nowIso,
            status: next.status,
            attempts: next.attempts,
          });
          if (!marked.ok) summary.errors += 1;
        }
      } catch (e) {
        summary.errors += 1;
        console.error("[leads/arbox-lost-lead] row threw", {
          businessId,
          trigger_id: rule.id,
          lead_id: leadId,
          lost_date: lostDate,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  warnAbandonedCancellationSyncLog({
    businessId,
    abandoned: summary.abandoned,
    reason: "send_failed_cap",
  });

  return summary;
}
