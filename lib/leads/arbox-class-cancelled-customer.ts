/**
 * Class cancelled → WhatsApp the people who were registered.
 * Snapshot future bookingsReport rows, stamp schedule_id from classesSummaryReport
 * (status=active, exact class_name + date + HH:MM), then match cancellations on
 * that id only. Name + date + time collides on cancelledSessionsReport.
 *
 * Order per run: cancellation pass, snapshot refresh (bookings + trainer), send, retention.
 * The trainer gets the same template. Their phone is copied from the
 * classesSummaryReport fetch this run already makes, into
 * arbox_class_trainer_snapshot. A missing table skips trainer capture and
 * trainer sends; registered customers still go out.
 * Scheduling: cron-job.org hourly → /api/cron/arbox-class-cancel-notify.
 * IO (10 businesses, rule enabled): 3–5 Arbox GETs/business/hour
 * (cancelled + bookings + summary, bookings may be 2 pages). No extra Arbox
 * call for the trainer. Extra Supabase: one indexed read, one upsert of the
 * active classes in the horizon, and the same retention delete. No Claude.
 * Businesses without an enabled rule: 0 Arbox calls.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { eventBeforeRuleActivation, ruleActivationMs } from "@/lib/rule-activation";
import {
  decideScheduledDrainDispatch,
  decideScheduledSendGate,
} from "@/lib/scheduled-template-sends";
import { isCancelledSessionStatus } from "@/lib/leads/arbox-class-cancelled-staff";
import {
  CLASS_TRAINER_SNAPSHOT_TABLE,
  activeScheduleIdsFromSummary,
  classifyTrainerStoreError,
  planTrainerRefresh,
  shouldNotifyClassTrainer,
  trainerPhoneCoveredByCustomers,
  trainerRuleIdsToSend,
  trainerSkipReason,
  trainersFromActiveSummary,
  type TrainerSnapshotRow,
  type TrainerStoreFailure,
} from "@/lib/leads/arbox-class-trainer-snapshot";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";
import {
  buildClassesSummaryReportPath,
  buildCancelledSessionsReportPath,
} from "@/lib/leads/arbox-class-cancelled-staff";
import {
  buildBookingsReportPath,
  formatDateYmdIsrael,
  parseClassDateYmd,
} from "@/lib/leads/arbox-trial-attended";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import { extractPersonFirstName, isUsableStoredFirstName } from "@/lib/template-first-name";
import {
  bodyTextFromTemplateComponents,
  extractBodyVarCount,
} from "@/lib/template-presets";
import { createCompanionSendGate, rulesForCompanionSend } from "@/lib/same-trigger-template-order";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { isSendsHoldError } from "@/lib/business-sends-hold";
import type { OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import { contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  resolveDefaultSendChannel,
  resolveSendChannelForContact,
} from "@/lib/wa-resolve-send-channel";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** today..today+7 (inclusive span is 8 dates, under the 31-day report cap). */
export const CLASS_CANCEL_SNAPSHOT_HORIZON_DAYS = 7;
export const CLASS_CANCEL_NOTIFY_ATTEMPT_CAP = 3;
export const CLASS_CANCEL_RETENTION_DAYS = 7;
const PAGE_TIMEOUT_MS = 25_000;
const NAME_FALLBACK = "🙂";
const CLASS_NAME_FALLBACK = "השיעור";
const TIME_FALLBACK = "בקרוב";

export type ClassCancelBookingInput = {
  user_id: unknown;
  phone?: unknown;
  first_name?: unknown;
  class_name?: unknown;
  date?: unknown;
  time?: unknown;
  start_time?: unknown;
  user_role?: unknown;
};

export type ClassCancelSummaryInput = {
  schedule_id?: unknown;
  class_name?: unknown;
  date?: unknown;
  start_time?: unknown;
  time?: unknown;
  status?: unknown;
  staff_member?: unknown;
  second_staff_member?: unknown;
};

export type StampedRegistration = {
  user_id: string;
  schedule_id: string;
  phone: string | null;
  first_name: string | null;
  class_name: string;
  class_date: string;
  class_time: string;
  user_role: string | null;
};

export type StampResult = {
  stamped: StampedRegistration[];
  skipped_staff: number;
  skipped_incomplete: number;
  skipped_no_match: number;
  skipped_ambiguous: number;
};

export type SnapshotLogicRow = {
  schedule_id: string;
  user_id: string;
  class_date: string;
  disappeared_at: string | null;
  notify_status: string | null;
};

export function snapshotKey(scheduleId: string, userId: string): string {
  return `${scheduleId}\n${userId}`;
}

export function normalizeClassTimeHhmm(raw: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

export function addCalendarDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function classCancelSnapshotWindow(now: Date = new Date()): {
  fromDate: string;
  toDate: string;
} {
  const fromDate = formatDateYmdIsrael(now);
  return {
    fromDate,
    toDate: addCalendarDaysYmd(fromDate, CLASS_CANCEL_SNAPSHOT_HORIZON_DAYS),
  };
}

function trimOrNull(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

function isStaffRole(raw: unknown): boolean {
  return String(raw ?? "").trim().toLowerCase() === "staffmember";
}

/**
 * Stamp schedule_id from active summary rows.
 * Exact trimmed class_name + YYYY-MM-DD + HH:MM. Zero or 2+ distinct
 * schedule_ids → skip that booking. staffMember is excluded before the join.
 */
export function stampFutureBookings(input: {
  bookings: readonly ClassCancelBookingInput[];
  summary: readonly ClassCancelSummaryInput[];
}): StampResult {
  const idsBySlot = new Map<string, Set<string>>();
  for (const row of input.summary) {
    if (String(row.status ?? "").trim().toLowerCase() !== "active") continue;
    const name = trimOrNull(row.class_name);
    const date = parseClassDateYmd(row.date);
    const time = normalizeClassTimeHhmm(row.start_time) ?? normalizeClassTimeHhmm(row.time);
    const scheduleId = trimOrNull(row.schedule_id);
    if (!name || !date || !time || !scheduleId) continue;
    const slot = `${name}|${date}|${time}`;
    const ids = idsBySlot.get(slot) ?? new Set<string>();
    ids.add(scheduleId);
    idsBySlot.set(slot, ids);
  }

  const stamped: StampedRegistration[] = [];
  const seen = new Set<string>();
  let skipped_staff = 0;
  let skipped_incomplete = 0;
  let skipped_no_match = 0;
  let skipped_ambiguous = 0;

  for (const row of input.bookings) {
    if (isStaffRole(row.user_role)) {
      skipped_staff += 1;
      continue;
    }
    const userId = trimOrNull(row.user_id);
    const name = trimOrNull(row.class_name);
    const date = parseClassDateYmd(row.date);
    const time = normalizeClassTimeHhmm(row.time) ?? normalizeClassTimeHhmm(row.start_time);
    if (!userId || !name || !date || !time) {
      skipped_incomplete += 1;
      continue;
    }
    const ids = idsBySlot.get(`${name}|${date}|${time}`);
    if (!ids || ids.size === 0) {
      skipped_no_match += 1;
      continue;
    }
    if (ids.size > 1) {
      skipped_ambiguous += 1;
      continue;
    }
    const scheduleId = [...ids][0]!;
    const key = snapshotKey(scheduleId, userId);
    if (seen.has(key)) continue;
    seen.add(key);
    stamped.push({
      user_id: userId,
      schedule_id: scheduleId,
      phone: trimOrNull(row.phone),
      first_name: trimOrNull(row.first_name),
      class_name: name,
      class_date: date,
      class_time: time,
      user_role: trimOrNull(row.user_role),
    });
  }

  return { stamped, skipped_staff, skipped_incomplete, skipped_no_match, skipped_ambiguous };
}

/** YYYY-MM-DD HH:MM:SS (or with T) as Asia/Jerusalem wall time. */
export function parseIsraelWallDateTime(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/.exec(s);
  if (!m) return null;
  const dt = israelWallTimeToUtc(m[1]!, m[2]!);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/**
 * Rows to mark pending for one cancelled schedule.
 * notify_status must still be null. disappeared_at null, or disappeared at/after
 * cancelled_time (they vanished on a run before the cancellation showed up).
 * Rule created after cancelled_time → nobody (no retroactive blast).
 */
export function selectCancellationCohort(
  rows: readonly SnapshotLogicRow[],
  input: { scheduleId: string; cancelledAt: Date; ruleCreatedAt: Date }
): SnapshotLogicRow[] {
  if (input.ruleCreatedAt.getTime() > input.cancelledAt.getTime()) return [];
  const cancelledMs = input.cancelledAt.getTime();
  return rows.filter((row) => {
    if (row.schedule_id !== input.scheduleId) return false;
    if (row.notify_status != null) return false;
    if (row.disappeared_at == null) return true;
    const gone = Date.parse(row.disappeared_at);
    return Number.isFinite(gone) && gone >= cancelledMs;
  });
}

export function shouldAbortSnapshotRefresh(input: {
  bookingsOk: boolean;
  summaryOk: boolean;
  bookingRowCount: number;
  snapshotFutureRowCount: number;
}): boolean {
  if (!input.bookingsOk || !input.summaryOk) return true;
  if (input.bookingRowCount === 0 && input.snapshotFutureRowCount > 0) return true;
  return false;
}

/**
 * Self-cancel vs re-register, after the cancellation pass.
 * Future + still unmarked + missing from this run's stamped bookings + schedule
 * not in this run's cancelled set → disappeared_at.
 * A disappeared row that is stamped again → clear disappeared_at.
 */
export function planSnapshotPresence(input: {
  rows: readonly SnapshotLogicRow[];
  stamped: readonly { schedule_id: string; user_id: string }[];
  cancelledScheduleIds: ReadonlySet<string>;
  todayYmd: string;
}): { markDisappeared: SnapshotLogicRow[]; clearDisappeared: SnapshotLogicRow[] } {
  const seen = new Set(input.stamped.map((r) => snapshotKey(r.schedule_id, r.user_id)));
  const markDisappeared: SnapshotLogicRow[] = [];
  const clearDisappeared: SnapshotLogicRow[] = [];
  for (const row of input.rows) {
    const key = snapshotKey(row.schedule_id, row.user_id);
    if (row.disappeared_at && seen.has(key)) {
      clearDisappeared.push(row);
      continue;
    }
    if (row.disappeared_at) continue;
    if (row.notify_status != null) continue;
    if (row.class_date < input.todayYmd) continue;
    if (input.cancelledScheduleIds.has(row.schedule_id)) continue;
    if (!seen.has(key)) markDisappeared.push(row);
  }
  return { markDisappeared, clearDisappeared };
}

export function classStartHasPassed(
  classDate: string,
  classTime: string,
  now: Date
): boolean {
  const start = israelWallTimeToUtc(classDate, classTime);
  if (!Number.isFinite(start.getTime())) return false;
  return start.getTime() < now.getTime();
}

/** Night + Shabbat hold used by scheduled template drains. Leave pending. */
export function classCancelQuietHoursDecision(now: Date = new Date()): "hold" | "send" {
  return decideScheduledDrainDispatch(now).action === "hold" ? "hold" : "send";
}

/** DD/MM from YYYY-MM-DD. */
export function formatClassDateDdMm(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim());
  if (!m) return null;
  return `${m[3]}/${m[2]}`;
}

function sanitizedFirstName(raw: string | null): string {
  const name = extractPersonFirstName(raw);
  if (!isUsableStoredFirstName(name)) return NAME_FALLBACK;
  return name;
}

/**
 * Body params for class_cancelled_customer, in placeholder order.
 * The count is the template BODY's highest {{n}}, not a fixed slot list.
 * {{1}} first name (sanitized; empty/unusable → "🙂")
 * {{2}} class_name (empty → "השיעור")
 * {{3}} class date DD/MM
 * {{4}} class time HH:MM (empty → "בקרוב")
 * A template with more than 4 placeholders gets "—" for the extras so Meta
 * still receives one value per {{n}}. Flagged for approval.
 */
export function classCancelledCustomerBodyParams(input: {
  components: unknown;
  firstName: string | null;
  className: string;
  classDateYmd: string;
  classTime: string;
}): string[] {
  const body = bodyTextFromTemplateComponents(input.components);
  const varCount = extractBodyVarCount(body);
  if (varCount <= 0) return [];
  const ordered = [
    sanitizedFirstName(input.firstName),
    String(input.className ?? "").trim() || CLASS_NAME_FALLBACK,
    (formatClassDateDdMm(input.classDateYmd) ?? String(input.classDateYmd ?? "").trim()) || "—",
    normalizeClassTimeHhmm(input.classTime) || String(input.classTime ?? "").trim() || TIME_FALLBACK,
  ];
  const values: string[] = [];
  for (let i = 0; i < varCount; i += 1) {
    values.push(ordered[i] ?? "—");
  }
  return values;
}

export function classCancelledCustomerBodyComponents(
  values: readonly string[]
): OwnerTemplateComponent[] | undefined {
  if (!values.length) return undefined;
  return [
    {
      type: "body",
      parameters: values.map((text) => ({ type: "text" as const, text })),
    },
  ];
}

/** Transient Graph/network failures stay pending. A bad template fails immediately. */
export function isTransientMetaSendFailure(error: string | null | undefined): boolean {
  const s = String(error ?? "").trim();
  if (!s) return true;
  if (/timeout|ECONN|network|fetch failed|aborted|ETIMEDOUT|socket/i.test(s)) return true;
  if (/\b(130429|131016|131048|131056|133004|131000)\b/.test(s)) return true;
  if (/^http_(408|429|5\d\d)$/.test(s)) return true;
  if (/"code"\s*:\s*(408|429|500|502|503|504)/.test(s)) return true;
  return false;
}

export function nextNotifyStatusAfterSendFailure(input: {
  attempts: number;
  transient: boolean;
}): { notify_status: "pending" | "failed"; attempts: number } {
  const attempts = Math.max(0, Math.trunc(input.attempts)) + 1;
  if (!input.transient || attempts >= CLASS_CANCEL_NOTIFY_ATTEMPT_CAP) {
    return { notify_status: "failed", attempts };
  }
  return { notify_status: "pending", attempts };
}

type ReportFetch = (
  pathOrUrl: string,
  input: { apiKey: string; method?: string }
) => Promise<{ ok: boolean; status: number; json: unknown; rawText: string }>;

async function arboxGet(
  path: string,
  apiKey: string
): Promise<{ ok: boolean; status: number; json: unknown; rawText: string }> {
  try {
    return await arboxPublicFetch(path, { apiKey, method: "GET", timeoutMs: PAGE_TIMEOUT_MS });
  } catch {
    return { ok: false, status: 0, json: null, rawText: "network" };
  }
}

export type ReportPageTiming = {
  report: string;
  page: number;
  ms: number;
  status: number;
  rows: number;
};

async function fetchReport(input: {
  apiKey: string;
  locationId: string;
  report: string;
  buildPath: (page: number) => string;
}): Promise<
  | { ok: true; rows: Record<string, unknown>[]; pages: ReportPageTiming[] }
  | { ok: false; error: string; pages: ReportPageTiming[] }
> {
  const pages: ReportPageTiming[] = [];
  const fetchPage: ReportFetch = async (path) => {
    const t0 = Date.now();
    const res = await arboxGet(path, input.apiKey);
    const data = (res.json as { data?: unknown } | null)?.data;
    pages.push({
      report: input.report,
      page: pages.length + 1,
      ms: Date.now() - t0,
      status: res.status,
      rows: Array.isArray(data) ? data.length : 0,
    });
    return res;
  };
  const result = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.locationId,
    logLabel: `leads/arbox-class-cancelled-customer/${input.report}`,
    buildPath: input.buildPath,
    fetchPage,
  });
  if (!result.ok) return { ok: false, error: result.error, pages };
  return { ok: true, rows: result.rows, pages };
}

export type CancelledOccurrence = {
  scheduleId: string;
  cancelledAt: Date;
};

export function cancelledOccurrencesFromRows(
  rows: readonly Record<string, unknown>[]
): CancelledOccurrence[] {
  const byId = new Map<string, Date>();
  for (const row of rows) {
    if (!isCancelledSessionStatus(row.status)) continue;
    const scheduleId = trimOrNull(row.schedule_id);
    const cancelledAt = parseIsraelWallDateTime(row.cancelled_time);
    if (!scheduleId || !cancelledAt) continue;
    const prev = byId.get(scheduleId);
    if (!prev || cancelledAt.getTime() < prev.getTime()) byId.set(scheduleId, cancelledAt);
  }
  return [...byId.entries()].map(([scheduleId, cancelledAt]) => ({ scheduleId, cancelledAt }));
}

export type ClassCancelPreview = {
  window: { fromDate: string; toDate: string };
  pages: ReportPageTiming[];
  get_count: number;
  get_ms: number;
  booking_rows: number;
  summary_rows: number;
  cancelled_rows: number;
  stamped: number;
  skipped_staff: number;
  skipped_incomplete: number;
  skipped_no_match: number;
  skipped_ambiguous: number;
  cancelled_schedule_ids: number;
  cancelled_ids_with_stamped_registrants: number;
  stamped_rows_on_cancelled_ids: number;
  projected_first_run_inserts: number;
  projected_steady_state_inserts_if_unchanged: number;
  fetch_error?: string;
};

/** Real GETs, no DB. Used by the stage-1 dry run. */
export async function previewClassCancelledCustomer(input: {
  apiKey: string;
  boxId: string;
  now?: Date;
}): Promise<ClassCancelPreview> {
  const now = input.now ?? new Date();
  const window = classCancelSnapshotWindow(now);
  const locationId = input.boxId;
  const empty: ClassCancelPreview = {
    window,
    pages: [],
    get_count: 0,
    get_ms: 0,
    booking_rows: 0,
    summary_rows: 0,
    cancelled_rows: 0,
    stamped: 0,
    skipped_staff: 0,
    skipped_incomplete: 0,
    skipped_no_match: 0,
    skipped_ambiguous: 0,
    cancelled_schedule_ids: 0,
    cancelled_ids_with_stamped_registrants: 0,
    stamped_rows_on_cancelled_ids: 0,
    projected_first_run_inserts: 0,
    projected_steady_state_inserts_if_unchanged: 0,
  };

  const cancelled = await fetchReport({
    apiKey: input.apiKey,
    locationId,
    report: "cancelledSessionsReport",
    buildPath: (page) =>
      buildCancelledSessionsReportPath({
        fromDate: window.fromDate,
        toDate: window.toDate,
        locationId,
        page,
      }),
  });
  if (!cancelled.ok) {
    return { ...empty, pages: cancelled.pages, get_count: cancelled.pages.length, fetch_error: cancelled.error };
  }

  const [bookings, summary] = await Promise.all([
    fetchReport({
      apiKey: input.apiKey,
      locationId,
      report: "bookingsReport",
      buildPath: (page) =>
        buildBookingsReportPath({
          fromDate: window.fromDate,
          toDate: window.toDate,
          locationId,
          page,
        }),
    }),
    fetchReport({
      apiKey: input.apiKey,
      locationId,
      report: "classesSummaryReport",
      buildPath: (page) =>
        buildClassesSummaryReportPath({
          fromDate: window.fromDate,
          toDate: window.toDate,
          locationId,
          page,
        }),
    }),
  ]);

  const pages = [...cancelled.pages, ...(bookings.pages ?? []), ...(summary.pages ?? [])];
  const base = {
    ...empty,
    pages,
    get_count: pages.length,
    get_ms: pages.reduce((n, p) => n + p.ms, 0),
    cancelled_rows: cancelled.rows.length,
    booking_rows: bookings.ok ? bookings.rows.length : 0,
    summary_rows: summary.ok ? summary.rows.length : 0,
  };
  if (!bookings.ok || !summary.ok) {
    const fetchError = !bookings.ok
      ? bookings.error
      : "error" in summary
        ? summary.error
        : "report_failed";
    return {
      ...base,
      fetch_error: fetchError,
    };
  }

  const stamp = stampFutureBookings({
    bookings: bookings.rows as ClassCancelBookingInput[],
    summary: summary.rows as ClassCancelSummaryInput[],
  });
  const occurrences = cancelledOccurrencesFromRows(cancelled.rows);
  const cancelledIds = new Set(occurrences.map((o) => o.scheduleId));
  const overlapRows = stamp.stamped.filter((r) => cancelledIds.has(r.schedule_id));
  const overlapIds = new Set(overlapRows.map((r) => r.schedule_id));
  return {
    ...base,
    stamped: stamp.stamped.length,
    skipped_staff: stamp.skipped_staff,
    skipped_incomplete: stamp.skipped_incomplete,
    skipped_no_match: stamp.skipped_no_match,
    skipped_ambiguous: stamp.skipped_ambiguous,
    cancelled_schedule_ids: occurrences.length,
    cancelled_ids_with_stamped_registrants: overlapIds.size,
    stamped_rows_on_cancelled_ids: overlapRows.length,
    projected_first_run_inserts: stamp.stamped.length,
    projected_steady_state_inserts_if_unchanged: 0,
  };
}

type Db = ReturnType<typeof createSupabaseAdminClient>;

type SnapshotDbRow = SnapshotLogicRow & {
  phone: string | null;
  first_name: string | null;
  class_name: string;
  class_time: string;
  attempts: number;
  class_cancelled_at: string | null;
};

function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

async function loadWorkingSnapshot(
  admin: Db,
  businessId: number,
  todayYmd: string
): Promise<{ ok: true; rows: SnapshotDbRow[] } | { ok: false; error: string }> {
  const from = addCalendarDaysYmd(todayYmd, -CLASS_CANCEL_RETENTION_DAYS);
  const { data, error } = await admin
    .from("arbox_future_booking_snapshot")
    .select(
      "schedule_id, user_id, class_date, class_time, class_name, phone, first_name, disappeared_at, notify_status, attempts, class_cancelled_at"
    )
    .eq("business_id", businessId)
    .gte("class_date", from);
  if (error) return { ok: false, error: error.message };
  const rows: SnapshotDbRow[] = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      schedule_id: String(r.schedule_id ?? ""),
      user_id: String(r.user_id ?? ""),
      class_date: String(r.class_date ?? "").slice(0, 10),
      class_time: String(r.class_time ?? ""),
      class_name: String(r.class_name ?? ""),
      phone: trimOrNull(r.phone),
      first_name: trimOrNull(r.first_name),
      disappeared_at: r.disappeared_at == null ? null : String(r.disappeared_at),
      notify_status: r.notify_status == null ? null : String(r.notify_status),
      attempts: Number(r.attempts ?? 0) || 0,
      class_cancelled_at: r.class_cancelled_at == null ? null : String(r.class_cancelled_at),
    };
  });
  return { ok: true, rows };
}

async function contactOptedOut(
  admin: Db,
  businessId: number,
  phone: string
): Promise<boolean | "error"> {
  const variants = contactPhoneLookupVariants(phone);
  if (!variants.length) return false;
  const { data, error } = await admin
    .from("contacts")
    .select("opted_out")
    .eq("business_id", businessId)
    .in("phone", variants)
    .limit(5);
  if (error) {
    console.error("[leads/arbox-class-cancelled-customer] opt-out lookup failed", {
      businessId,
      error: error.message,
    });
    return "error";
  }
  return (data ?? []).some((row) => (row as { opted_out?: boolean }).opted_out === true);
}

export type ClassCancelSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials" | "cancel_fetch_failed" | "snapshot_read_failed";
  dry_run?: boolean;
  window?: { fromDate: string; toDate: string };
  pages: ReportPageTiming[];
  booking_rows: number;
  stamped: number;
  skipped_staff: number;
  skipped_incomplete: number;
  skipped_no_match: number;
  skipped_ambiguous: number;
  cancel_marked: number;
  inserted: number;
  disappeared: number;
  reappeared: number;
  sent: number;
  skipped_past: number;
  skipped_no_phone: number;
  skipped_opted_out: number;
  skipped_gate: number;
  held_quiet_hours: number;
  failed: number;
  retained: number;
  trainer_sent: number;
  trainer_skipped_no_phone: number;
  trainer_skipped_no_snapshot: number;
  trainer_held_quiet_hours: number;
  refresh_aborted?: boolean;
  fetch_error?: string;
};

function emptySummary(): ClassCancelSyncSummary {
  return {
    pages: [],
    booking_rows: 0,
    stamped: 0,
    skipped_staff: 0,
    skipped_incomplete: 0,
    skipped_no_match: 0,
    skipped_ambiguous: 0,
    cancel_marked: 0,
    inserted: 0,
    disappeared: 0,
    reappeared: 0,
    sent: 0,
    skipped_past: 0,
    skipped_no_phone: 0,
    skipped_opted_out: 0,
    skipped_gate: 0,
    held_quiet_hours: 0,
    failed: 0,
    retained: 0,
    trainer_sent: 0,
    trainer_skipped_no_phone: 0,
    trainer_skipped_no_snapshot: 0,
    trainer_held_quiet_hours: 0,
  };
}

export async function syncArboxClassCancelledCustomerForBusiness(input: {
  admin: Db;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  now?: Date;
  dryRun?: boolean;
}): Promise<ClassCancelSyncSummary> {
  const summary = emptySummary();
  const dryRun = input.dryRun === true;
  summary.dry_run = dryRun;
  const businessId = Number(input.businessId);
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const now = input.now ?? new Date();

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const { data: ruleRows, error: ruleErr } = await input.admin
    .from("template_triggers")
    .select("id, template_name, enabled, created_at, updated_at")
    .eq("business_id", businessId)
    .eq("trigger_type", "class_cancelled_customer")
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (ruleErr) {
    console.error("[leads/arbox-class-cancelled-customer] rule lookup failed", {
      businessId,
      error: ruleErr.message,
    });
    summary.skipped = true;
    summary.fetch_error = ruleErr.message;
    return summary;
  }
  const rules = rulesForCompanionSend(
    ((ruleRows ?? []) as Array<{ id?: string; template_name?: string | null; created_at?: string; updated_at?: string }>).flatMap(
      (row) => {
        const id = String(row.id ?? "").trim();
        const templateName = String(row.template_name ?? "").trim();
        if (!id || !templateName) return [];
        return [{ id, template_name: templateName, created_at: row.created_at, updated_at: row.updated_at }];
      }
    )
  );
  if (!rules.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  const createdMs = rules
    .map((rule) => ruleActivationMs(rule))
    .filter((ms) => Number.isFinite(ms));
  const ruleCreatedAt = new Date(createdMs.length ? Math.min(...createdMs) : Number.NaN);
  const window = classCancelSnapshotWindow(now);
  summary.window = window;
  const todayYmd = window.fromDate;

  const loaded = await loadWorkingSnapshot(input.admin, businessId, todayYmd);
  if (!loaded.ok) {
    console.error("[leads/arbox-class-cancelled-customer] snapshot read failed", {
      businessId,
      error: loaded.error,
    });
    summary.skipped = true;
    summary.skip_reason = "snapshot_read_failed";
    summary.fetch_error = loaded.error;
    return summary;
  }
  const rows = loaded.rows;

  const cancelled = await fetchReport({
    apiKey,
    locationId: boxId,
    report: "cancelledSessionsReport",
    buildPath: (page) =>
      buildCancelledSessionsReportPath({
        fromDate: window.fromDate,
        toDate: window.toDate,
        locationId: boxId,
        page,
      }),
  });
  summary.pages.push(...cancelled.pages);
  if (!cancelled.ok) {
    summary.skip_reason = "cancel_fetch_failed";
    summary.fetch_error = cancelled.error;
    console.error("[leads/arbox-class-cancelled-customer] cancelledSessionsReport failed", {
      businessId,
      error: cancelled.error,
    });
    return summary;
  }

  const occurrences = cancelledOccurrencesFromRows(cancelled.rows);
  const cancelledIds = new Set(occurrences.map((o) => o.scheduleId));
  const newlyMarkedSchedules = new Set<string>();
  const trainerStore: TrainerStoreFlag = { missingLogged: false };
  let trainerRowsThisRun: TrainerSnapshotRow[] | null = null;

  for (const occ of occurrences) {
    if (!Number.isFinite(ruleCreatedAt.getTime())) continue;
    const cohort = selectCancellationCohort(rows, {
      scheduleId: occ.scheduleId,
      cancelledAt: occ.cancelledAt,
      ruleCreatedAt,
    });
    for (const row of cohort) {
      if (dryRun) {
        row.notify_status = "pending";
        summary.cancel_marked += 1;
        newlyMarkedSchedules.add(row.schedule_id);
        continue;
      }
      const { error } = await input.admin
        .from("arbox_future_booking_snapshot")
        .update({
          class_cancelled_at: occ.cancelledAt.toISOString(),
          notify_status: "pending",
        })
        .eq("business_id", businessId)
        .eq("schedule_id", row.schedule_id)
        .eq("user_id", row.user_id)
        .is("notify_status", null);
      if (error) {
        console.error("[leads/arbox-class-cancelled-customer] cancel mark failed", {
          businessId,
          schedule_id: row.schedule_id,
          error: error.message,
        });
        continue;
      }
      row.notify_status = "pending";
      summary.cancel_marked += 1;
      newlyMarkedSchedules.add(row.schedule_id);
    }
  }

  const [bookings, summaryReport] = await Promise.all([
    fetchReport({
      apiKey,
      locationId: boxId,
      report: "bookingsReport",
      buildPath: (page) =>
        buildBookingsReportPath({
          fromDate: window.fromDate,
          toDate: window.toDate,
          locationId: boxId,
          page,
        }),
    }),
    fetchReport({
      apiKey,
      locationId: boxId,
      report: "classesSummaryReport",
      buildPath: (page) =>
        buildClassesSummaryReportPath({
          fromDate: window.fromDate,
          toDate: window.toDate,
          locationId: boxId,
          page,
        }),
    }),
  ]);
  summary.pages.push(...(bookings.pages ?? []), ...(summaryReport.pages ?? []));

  const futureSnapshotRows = rows.filter(
    (r) => r.class_date >= todayYmd && r.disappeared_at == null
  ).length;
  const refreshAbort = shouldAbortSnapshotRefresh({
    bookingsOk: bookings.ok,
    summaryOk: summaryReport.ok,
    bookingRowCount: bookings.ok ? bookings.rows.length : 0,
    snapshotFutureRowCount: futureSnapshotRows,
  });
  if (!bookings.ok || !summaryReport.ok || refreshAbort) {
    summary.refresh_aborted = true;
    summary.fetch_error = !bookings.ok
      ? bookings.error
      : !summaryReport.ok
        ? summaryReport.error
        : "bookings_empty";
    console.error("[leads/arbox-class-cancelled-customer] snapshot refresh aborted", {
      businessId,
      fetch_error: summary.fetch_error,
      booking_rows: bookings.ok ? bookings.rows.length : 0,
      future_snapshot_rows: futureSnapshotRows,
    });
  } else {
    summary.booking_rows = bookings.rows.length;
    const stamp = stampFutureBookings({
      bookings: bookings.rows as ClassCancelBookingInput[],
      summary: summaryReport.rows as ClassCancelSummaryInput[],
    });
    summary.stamped = stamp.stamped.length;
    summary.skipped_staff = stamp.skipped_staff;
    summary.skipped_incomplete = stamp.skipped_incomplete;
    summary.skipped_no_match = stamp.skipped_no_match;
    summary.skipped_ambiguous = stamp.skipped_ambiguous;

    const existing = new Set(rows.map((r) => snapshotKey(r.schedule_id, r.user_id)));
    const fresh = stamp.stamped.filter((r) => !existing.has(snapshotKey(r.schedule_id, r.user_id)));
    if (!dryRun && fresh.length) {
      const payload = fresh.map((r) => ({
        business_id: businessId,
        schedule_id: r.schedule_id,
        user_id: r.user_id,
        phone: r.phone,
        first_name: r.first_name,
        class_name: r.class_name,
        class_date: r.class_date,
        class_time: r.class_time,
        user_role: r.user_role,
      }));
      const { error } = await input.admin
        .from("arbox_future_booking_snapshot")
        .upsert(payload, {
          onConflict: "business_id,schedule_id,user_id",
          ignoreDuplicates: true,
        });
      if (error) {
        console.error("[leads/arbox-class-cancelled-customer] insert failed", {
          businessId,
          error: error.message,
        });
      } else {
        summary.inserted = fresh.length;
      }
    } else {
      summary.inserted = fresh.length;
    }

    const presence = planSnapshotPresence({
      rows,
      stamped: stamp.stamped,
      cancelledScheduleIds: cancelledIds,
      todayYmd,
    });
    const nowIso = now.toISOString();
    for (const row of presence.markDisappeared) {
      if (!dryRun) {
        const { error } = await input.admin
          .from("arbox_future_booking_snapshot")
          .update({ disappeared_at: nowIso })
          .eq("business_id", businessId)
          .eq("schedule_id", row.schedule_id)
          .eq("user_id", row.user_id)
          .is("disappeared_at", null)
          .is("notify_status", null);
        if (error) {
          console.error("[leads/arbox-class-cancelled-customer] disappear mark failed", {
            businessId,
            schedule_id: row.schedule_id,
            error: error.message,
          });
          continue;
        }
      }
      row.disappeared_at = nowIso;
      summary.disappeared += 1;
    }
    for (const row of presence.clearDisappeared) {
      if (!dryRun) {
        const { error } = await input.admin
          .from("arbox_future_booking_snapshot")
          .update({ disappeared_at: null })
          .eq("business_id", businessId)
          .eq("schedule_id", row.schedule_id)
          .eq("user_id", row.user_id);
        if (error) {
          console.error("[leads/arbox-class-cancelled-customer] reappear clear failed", {
            businessId,
            schedule_id: row.schedule_id,
            error: error.message,
          });
          continue;
        }
      }
      row.disappeared_at = null;
      summary.reappeared += 1;
    }

    trainerRowsThisRun = await refreshTrainerSnapshot({
      admin: input.admin,
      businessId,
      summaryRows: summaryReport.rows as ClassCancelSummaryInput[],
      now,
      dryRun,
      store: trainerStore,
    });
  }

  const inSendWindow = classCancelQuietHoursDecision(now) === "send";
  if (!inSendWindow) {
    const held = rows.filter((r) => r.notify_status === "pending").length;
    summary.held_quiet_hours = held;
    console.info("[leads/arbox-class-cancelled-customer] quiet hours — leave pending", {
      businessId,
      pending: held,
    });
  } else if (!dryRun) {
    await sendPending({
      admin: input.admin,
      businessId,
      rules,
      rows: rows.filter((r) => r.notify_status === "pending"),
      now,
      summary,
    });
  }

  if (!dryRun) {
    await notifySnapshottedTrainers({
      admin: input.admin,
      businessId,
      rules,
      rows,
      occurrences,
      newlyMarkedSchedules,
      now,
      summary,
      inSendWindow,
      store: trainerStore,
      todayYmd,
      preloaded: trainerRowsThisRun,
    });
  }

  const retainBefore = addCalendarDaysYmd(todayYmd, -CLASS_CANCEL_RETENTION_DAYS);
  if (!dryRun) {
    const { error, count } = await input.admin
      .from("arbox_future_booking_snapshot")
      .delete({ count: "exact" })
      .eq("business_id", businessId)
      .lt("class_date", retainBefore);
    if (error) {
      console.error("[leads/arbox-class-cancelled-customer] retention delete failed", {
        businessId,
        error: error.message,
      });
    } else {
      summary.retained = count ?? 0;
    }
    if (!trainerStore.missingLogged) {
      const { error: trainerRetainErr } = await input.admin
        .from(CLASS_TRAINER_SNAPSHOT_TABLE)
        .delete()
        .eq("business_id", businessId)
        .lt("class_date", retainBefore);
      if (trainerRetainErr) {
        noteTrainerStoreError(trainerStore, businessId, trainerRetainErr.message, "retention");
      }
    }
  }

  console.info("[leads/arbox-class-cancelled-customer] business done", {
    businessId,
    slug: input.businessSlug,
    dry_run: dryRun,
    cancel_marked: summary.cancel_marked,
    inserted: summary.inserted,
    disappeared: summary.disappeared,
    sent: summary.sent,
    trainer_sent: summary.trainer_sent,
    trainer_skipped_no_phone: summary.trainer_skipped_no_phone,
    trainer_skipped_no_snapshot: summary.trainer_skipped_no_snapshot,
    trainer_held_quiet_hours: summary.trainer_held_quiet_hours,
    refresh_aborted: summary.refresh_aborted === true,
    gets: summary.pages.length,
  });
  return summary;
}

const CLASS_CANCEL_NOTIFY_LOG = "arbox_class_cancelled_customer_notify_log";

type ClassCancelRule = { id: string; template_name: string; created_at?: string; updated_at?: string };

async function loggedCancelTriggerIds(
  admin: Db,
  businessId: number,
  row: { schedule_id: string; user_id: string }
): Promise<Set<string> | null> {
  const { data, error } = await admin
    .from(CLASS_CANCEL_NOTIFY_LOG)
    .select("trigger_id")
    .eq("business_id", businessId)
    .eq("schedule_id", row.schedule_id)
    .eq("user_id", row.user_id);
  if (error) {
    console.error("[leads/arbox-class-cancelled-customer] notify log lookup failed", {
      businessId,
      schedule_id: row.schedule_id,
      error: error.message,
    });
    return null;
  }
  return new Set(
    (data ?? [])
      .map((item) => String((item as { trigger_id?: unknown }).trigger_id ?? "").trim())
      .filter(Boolean)
  );
}

async function recordCancelNotify(input: {
  admin: Db;
  businessId: number;
  ruleId: string;
  row: { schedule_id: string; user_id: string };
  status: string;
  now: Date;
}): Promise<boolean> {
  const { error } = await input.admin.from(CLASS_CANCEL_NOTIFY_LOG).upsert(
    {
      business_id: input.businessId,
      trigger_id: input.ruleId,
      schedule_id: input.row.schedule_id,
      user_id: input.row.user_id,
      status: input.status,
      processed_at: input.now.toISOString(),
    },
    { onConflict: "business_id,trigger_id,schedule_id,user_id" }
  );
  if (error) {
    console.error("[leads/arbox-class-cancelled-customer] notify log upsert failed", {
      businessId: input.businessId,
      schedule_id: input.row.schedule_id,
      trigger_id: input.ruleId,
      error: error.message,
    });
    return false;
  }
  return true;
}

async function sendPending(input: {
  admin: Db;
  businessId: number;
  rules: ClassCancelRule[];
  rows: SnapshotDbRow[];
  now: Date;
  summary: ClassCancelSyncSummary;
}): Promise<void> {
  if (!input.rows.length || !input.rules.length) return;
  const { data: bizRow } = await input.admin
    .from("businesses")
    .select("waba_id")
    .eq("id", input.businessId)
    .maybeSingle();
  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  const templates = new Map<string, { language: string; components: unknown; approved: boolean }>();
  for (const rule of input.rules) {
    const { data: approvedTpl } = await input.admin
      .from("whatsapp_templates")
      .select("id, language, components")
      .eq("business_id", input.businessId)
      .eq("name", rule.template_name)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle();
    templates.set(rule.id, {
      language: String((approvedTpl as { language?: string } | null)?.language ?? "he").trim() || "he",
      components: (approvedTpl as { components?: unknown } | null)?.components,
      approved: Boolean((approvedTpl as { id?: unknown } | null)?.id),
    });
  }

  for (const row of input.rows) {
    const logged = await loggedCancelTriggerIds(input.admin, input.businessId, row);
    if (!logged) continue;
    const closeAll = async (status: string) => {
      for (const rule of input.rules) {
        if (logged.has(rule.id)) continue;
        const ok = await recordCancelNotify({
          admin: input.admin,
          businessId: input.businessId,
          ruleId: rule.id,
          row,
          status,
          now: input.now,
        });
        if (ok) logged.add(rule.id);
      }
      await markNotify(input.admin, input.businessId, row, { notify_status: status });
    };

    if (row.attempts >= CLASS_CANCEL_NOTIFY_ATTEMPT_CAP) {
      await closeAll("failed");
      input.summary.failed += 1;
      continue;
    }
    if (classStartHasPassed(row.class_date, row.class_time, input.now)) {
      await closeAll("skipped_past");
      input.summary.skipped_past += 1;
      continue;
    }
    const phone = normalizePhone(row.phone);
    if (!phone) {
      await closeAll("skipped_no_phone");
      input.summary.skipped_no_phone += 1;
      continue;
    }
    const optedOut = await contactOptedOut(input.admin, input.businessId, phone);
    if (optedOut === "error") continue;
    if (optedOut) {
      await closeAll("skipped_opted_out");
      input.summary.skipped_opted_out += 1;
      continue;
    }

    const channel =
      (await resolveSendChannelForContact(input.admin, input.businessId, phone)) ??
      (await resolveDefaultSendChannel(input.admin, input.businessId));
    const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
    const cancelledAt = row.class_cancelled_at ? new Date(String(row.class_cancelled_at)) : null;
    const pending = input.rules.filter((rule) => {
      if (logged.has(rule.id)) return false;
      if (!cancelledAt || Number.isNaN(cancelledAt.getTime())) return false;
      return !eventBeforeRuleActivation(cancelledAt, rule);
    });
    const companion = createCompanionSendGate();
    let anyFailed = false;
    let failedTransient = true;
    for (const rule of pending) {
      const tpl = templates.get(rule.id);
      const slot = await companion.before(rule.template_name);
      if (slot === "skip") continue;
      const gate = decideScheduledSendGate({
        hasChannel: Boolean(phoneNumberId),
        hasWaba: Boolean(wabaId),
        hasApprovedTemplate: Boolean(tpl?.approved),
      });
      if (gate.action === "cancel") {
        companion.after(rule.template_name, "gated");
        const ok = await recordCancelNotify({
          admin: input.admin,
          businessId: input.businessId,
          ruleId: rule.id,
          row,
          status: "skipped_gate",
          now: input.now,
        });
        if (ok) logged.add(rule.id);
        input.summary.skipped_gate += 1;
        continue;
      }
      const values = classCancelledCustomerBodyParams({
        components: tpl?.components,
        firstName: row.first_name,
        className: row.class_name,
        classDateYmd: row.class_date,
        classTime: row.class_time,
      });
      const send = await sendBusinessTemplate({
        to: phone,
        phoneNumberId,
        templateName: rule.template_name,
        alertTriggerId: rule.id,
        languageCode: tpl?.language || "he",
        skipOptOutGate: true,
        components: classCancelledCustomerBodyComponents(values),
      });
      if (!send.ok && isSendsHoldError(send.error)) {
        companion.after(rule.template_name, "gated");
        continue;
      }
      if (send.ok) {
        companion.after(rule.template_name, "immediate");
        const ok = await recordCancelNotify({
          admin: input.admin,
          businessId: input.businessId,
          ruleId: rule.id,
          row,
          status: "sent",
          now: input.now,
        });
        if (ok) logged.add(rule.id);
        input.summary.sent += 1;
        console.info("[leads/arbox-class-cancelled-customer] sent", {
          businessId: input.businessId,
          schedule_id: row.schedule_id,
          trigger_id: rule.id,
          phone: maskPhone(phone),
        });
        continue;
      }
      companion.after(rule.template_name, "send_failed");
      anyFailed = true;
      failedTransient = failedTransient && isTransientMetaSendFailure(send.error);
      console.error("[leads/arbox-class-cancelled-customer] send failed", {
        businessId: input.businessId,
        schedule_id: row.schedule_id,
        trigger_id: rule.id,
        phone: maskPhone(phone),
        error: String(send.error ?? "").slice(0, 300),
      });
    }

    if (input.rules.every((rule) => logged.has(rule.id))) {
      await markNotify(input.admin, input.businessId, row, {
        notify_status: "sent",
        notified_at: input.now.toISOString(),
        attempts: row.attempts + 1,
      });
      continue;
    }
    if (!anyFailed) continue;
    const next = nextNotifyStatusAfterSendFailure({
      attempts: row.attempts,
      transient: failedTransient,
    });
    await markNotify(input.admin, input.businessId, row, next);
    if (next.notify_status === "failed") input.summary.failed += 1;
  }
}

async function markNotify(
  admin: Db,
  businessId: number,
  row: SnapshotDbRow,
  patch: {
    notify_status: string;
    notified_at?: string;
    attempts?: number;
  }
): Promise<void> {
  const { error } = await admin
    .from("arbox_future_booking_snapshot")
    .update(patch)
    .eq("business_id", businessId)
    .eq("schedule_id", row.schedule_id)
    .eq("user_id", row.user_id)
    .eq("notify_status", "pending");
  if (error) {
    console.error("[leads/arbox-class-cancelled-customer] notify update failed", {
      businessId,
      schedule_id: row.schedule_id,
      error: error.message,
    });
  }
}

type TrainerStoreFlag = { missingLogged: boolean };

function noteTrainerStoreError(
  store: TrainerStoreFlag,
  businessId: number,
  message: string,
  what: string
): TrainerStoreFailure {
  const kind = classifyTrainerStoreError(message);
  if (kind === "missing") {
    if (!store.missingLogged) {
      store.missingLogged = true;
      console.warn(
        "[leads/arbox-class-cancelled-customer] trainer snapshot table missing — skip trainer capture and sends until supabase/arbox_class_trainer_snapshot.sql is applied",
        { businessId }
      );
    }
    return kind;
  }
  console.error("[leads/arbox-class-cancelled-customer] trainer snapshot failed", {
    businessId,
    what,
    error: message,
  });
  return kind;
}

function mapTrainerRow(row: Record<string, unknown>): TrainerSnapshotRow | null {
  const scheduleId = String(row.schedule_id ?? "").trim();
  const slot = row.slot === "second" ? "second" : row.slot === "primary" ? "primary" : null;
  const staffUserId = String(row.staff_user_id ?? "").trim();
  if (!scheduleId || !slot || !staffUserId) return null;
  return {
    schedule_id: scheduleId,
    slot,
    staff_user_id: staffUserId,
    phone: trimOrNull(row.phone),
    full_name: trimOrNull(row.full_name),
    class_name: String(row.class_name ?? ""),
    class_date: String(row.class_date ?? "").slice(0, 10),
    class_time: String(row.class_time ?? ""),
    seen_at: String(row.seen_at ?? ""),
  };
}

async function loadTrainerSnapshots(
  admin: Db,
  businessId: number,
  todayYmd: string,
  store: TrainerStoreFlag
): Promise<TrainerSnapshotRow[] | null> {
  if (store.missingLogged) return null;
  const from = addCalendarDaysYmd(todayYmd, -CLASS_CANCEL_RETENTION_DAYS);
  const { data, error } = await admin
    .from(CLASS_TRAINER_SNAPSHOT_TABLE)
    .select("schedule_id, slot, staff_user_id, phone, full_name, class_name, class_date, class_time, seen_at")
    .eq("business_id", businessId)
    .gte("class_date", from);
  if (error) {
    noteTrainerStoreError(store, businessId, error.message, "read");
    return null;
  }
  return (data ?? []).flatMap((row) => {
    const mapped = mapTrainerRow(row as Record<string, unknown>);
    return mapped ? [mapped] : [];
  });
}

async function refreshTrainerSnapshot(input: {
  admin: Db;
  businessId: number;
  summaryRows: ClassCancelSummaryInput[];
  now: Date;
  dryRun: boolean;
  store: TrainerStoreFlag;
}): Promise<TrainerSnapshotRow[] | null> {
  const existing = await loadTrainerSnapshots(
    input.admin,
    input.businessId,
    formatDateYmdIsrael(input.now),
    input.store
  );
  if (!existing) return null;
  const sightings = trainersFromActiveSummary(input.summaryRows);
  const plan = planTrainerRefresh({
    existing,
    sightings,
    activeScheduleIds: activeScheduleIdsFromSummary(input.summaryRows),
    nowIso: input.now.toISOString(),
  });
  if (input.dryRun) return [];
  if (plan.upserts.length) {
    const { error } = await input.admin.from(CLASS_TRAINER_SNAPSHOT_TABLE).upsert(
      plan.upserts.map((row) => ({
        business_id: input.businessId,
        schedule_id: row.schedule_id,
        slot: row.slot,
        staff_user_id: row.staff_user_id,
        phone: row.phone,
        full_name: row.full_name,
        class_name: row.class_name,
        class_date: row.class_date,
        class_time: row.class_time,
        seen_at: row.seen_at,
      })),
      { onConflict: "business_id,schedule_id,slot" }
    );
    if (error) {
      noteTrainerStoreError(input.store, input.businessId, error.message, "upsert");
      return null;
    }
  }
  for (const slot of plan.deleteSlots) {
    if (input.store.missingLogged) return null;
    const { error } = await input.admin
      .from(CLASS_TRAINER_SNAPSHOT_TABLE)
      .delete()
      .eq("business_id", input.businessId)
      .eq("schedule_id", slot.schedule_id)
      .eq("slot", slot.slot);
    if (error) {
      noteTrainerStoreError(input.store, input.businessId, error.message, "delete-slot");
      if (input.store.missingLogged) return null;
    }
  }
  const deleted = new Set(plan.deleteSlots.map((slot) => `${slot.schedule_id}\n${slot.slot}`));
  const merged = new Map(existing.map((row) => [`${row.schedule_id}\n${row.slot}`, row]));
  for (const key of deleted) merged.delete(key);
  for (const row of plan.upserts) merged.set(`${row.schedule_id}\n${row.slot}`, row);
  return [...merged.values()];
}

async function notifySnapshottedTrainers(input: {
  admin: Db;
  businessId: number;
  rules: ClassCancelRule[];
  rows: SnapshotDbRow[];
  occurrences: CancelledOccurrence[];
  newlyMarkedSchedules: ReadonlySet<string>;
  now: Date;
  summary: ClassCancelSyncSummary;
  inSendWindow: boolean;
  store: TrainerStoreFlag;
  todayYmd: string;
  preloaded: TrainerSnapshotRow[] | null;
}): Promise<void> {
  if (!input.rules.length || input.store.missingLogged) return;
  const trainers =
    input.preloaded ??
    (await loadTrainerSnapshots(input.admin, input.businessId, input.todayYmd, input.store));
  if (!trainers) return;

  const cancelledAtBySchedule = new Map(input.occurrences.map((occ) => [occ.scheduleId, occ.cancelledAt]));
  const scheduleIds = new Set<string>([
    ...input.occurrences.map((occ) => occ.scheduleId),
    ...input.rows.filter((row) => row.notify_status === "pending").map((row) => row.schedule_id),
  ]);

  let wabaId = "";
  let contextLoaded = false;
  const templates = new Map<string, { language: string; components: unknown; approved: boolean }>();
  const ensureSendContext = async () => {
    if (contextLoaded) return;
    contextLoaded = true;
    const { data: bizRow } = await input.admin
      .from("businesses")
      .select("waba_id")
      .eq("id", input.businessId)
      .maybeSingle();
    wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
      .trim()
      .replace(/\s+/g, "");
    for (const rule of input.rules) {
      const { data: approvedTpl } = await input.admin
        .from("whatsapp_templates")
        .select("id, language, components")
        .eq("business_id", input.businessId)
        .eq("name", rule.template_name)
        .eq("status", "APPROVED")
        .eq("disabled", false)
        .limit(1)
        .maybeSingle();
      templates.set(rule.id, {
        language: String((approvedTpl as { language?: string } | null)?.language ?? "he").trim() || "he",
        components: (approvedTpl as { components?: unknown } | null)?.components,
        approved: Boolean((approvedTpl as { id?: unknown } | null)?.id),
      });
    }
  };

  for (const scheduleId of scheduleIds) {
    const customers = input.rows.filter((row) => row.schedule_id === scheduleId);
    const trainerRows = trainers.filter((row) => row.schedule_id === scheduleId);
    const timeSource = trainerRows[0] ?? customers[0];
    const classPassed = timeSource
      ? classStartHasPassed(timeSource.class_date, timeSource.class_time, input.now)
      : false;
    const open = shouldNotifyClassTrainer({
      customerRowCount: customers.length,
      pendingCustomerCount: customers.filter((row) => row.notify_status === "pending").length,
      newlyMarkedCount: input.newlyMarkedSchedules.has(scheduleId) ? 1 : 0,
      classPassed,
    });
    if (!open) continue;
    const pendingReady = customers.filter((row) => row.notify_status === "pending" && row.class_cancelled_at);
    if (customers.length > 0 && pendingReady.length === 0) continue;
    if (!input.inSendWindow) {
      if (trainerRows.length > 0) {
        input.summary.trainer_held_quiet_hours += trainerRows.length;
        console.info("[leads/arbox-class-cancelled-customer] trainer skip", {
          businessId: input.businessId,
          schedule_id: scheduleId,
          reason: "outside_window",
        });
      }
      continue;
    }
    if (!trainerRows.length) {
      const customersWaiting = customers.some((row) => row.notify_status === "pending");
      if (customersWaiting || input.newlyMarkedSchedules.has(scheduleId)) {
        input.summary.trainer_skipped_no_snapshot += 1;
        console.info("[leads/arbox-class-cancelled-customer] trainer skip", {
          businessId: input.businessId,
          schedule_id: scheduleId,
          reason: "no_snapshot",
        });
      }
      continue;
    }

    const cancelledAt =
      cancelledAtBySchedule.get(scheduleId) ??
      (() => {
        const raw = customers.find((row) => row.class_cancelled_at)?.class_cancelled_at;
        const parsed = raw ? new Date(raw) : null;
        return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
      })();
    if (!cancelledAt) continue;

    const coveredPhones = customers.filter((row) => row.notify_status != null).map((row) => row.phone);
    const seenPhones = new Set<string>();
    for (const trainer of trainerRows) {
      const phone = normalizePhone(trainer.phone);
      const covered =
        trainerPhoneCoveredByCustomers(trainer.phone, coveredPhones) || (phone != null && seenPhones.has(phone));
      const reason = trainerSkipReason({
        inWindow: true,
        classPassed: false,
        hasSnapshot: true,
        phone: trainer.phone,
        coveredByCustomer: covered,
      });
      if (reason === "covered") {
        if (phone) seenPhones.add(phone);
        continue;
      }
      if (reason === "no_staff_phone") {
        input.summary.trainer_skipped_no_phone += 1;
        console.info("[leads/arbox-class-cancelled-customer] trainer skip", {
          businessId: input.businessId,
          schedule_id: scheduleId,
          staff_user_id: trainer.staff_user_id,
          reason: "no_staff_phone",
        });
        const logged = await loggedCancelTriggerIds(input.admin, input.businessId, {
          schedule_id: scheduleId,
          user_id: trainer.staff_user_id,
        });
        if (!logged) continue;
        for (const rule of input.rules) {
          if (logged.has(rule.id)) continue;
          const ok = await recordCancelNotify({
            admin: input.admin,
            businessId: input.businessId,
            ruleId: rule.id,
            row: { schedule_id: scheduleId, user_id: trainer.staff_user_id },
            status: "skipped_no_phone",
            now: input.now,
          });
          if (ok) logged.add(rule.id);
        }
        continue;
      }
      if (!phone) continue;
      seenPhones.add(phone);

      const logged = await loggedCancelTriggerIds(input.admin, input.businessId, {
        schedule_id: scheduleId,
        user_id: trainer.staff_user_id,
      });
      if (!logged) continue;
      const ruleIds = trainerRuleIdsToSend({
        ruleIds: input.rules
          .filter((rule) => !eventBeforeRuleActivation(cancelledAt, rule))
          .map((rule) => rule.id),
        loggedRuleIds: logged,
        coveredByCustomer: false,
      });
      if (!ruleIds.length) continue;
      await ensureSendContext();

      const optedOut = await contactOptedOut(input.admin, input.businessId, phone);
      if (optedOut === "error") continue;
      if (optedOut) {
        for (const ruleId of ruleIds) {
          const ok = await recordCancelNotify({
            admin: input.admin,
            businessId: input.businessId,
            ruleId,
            row: { schedule_id: scheduleId, user_id: trainer.staff_user_id },
            status: "skipped_opted_out",
            now: input.now,
          });
          if (ok) logged.add(ruleId);
        }
        continue;
      }

      const channel =
        (await resolveSendChannelForContact(input.admin, input.businessId, phone)) ??
        (await resolveDefaultSendChannel(input.admin, input.businessId));
      const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
      const companion = createCompanionSendGate();
      const rulesById = new Map(input.rules.map((rule) => [rule.id, rule]));
      for (const ruleId of ruleIds) {
        const rule = rulesById.get(ruleId);
        if (!rule) continue;
        const tpl = templates.get(rule.id);
        const slot = await companion.before(rule.template_name);
        if (slot === "skip") continue;
        const gate = decideScheduledSendGate({
          hasChannel: Boolean(phoneNumberId),
          hasWaba: Boolean(wabaId),
          hasApprovedTemplate: Boolean(tpl?.approved),
        });
        if (gate.action === "cancel") {
          companion.after(rule.template_name, "gated");
          const ok = await recordCancelNotify({
            admin: input.admin,
            businessId: input.businessId,
            ruleId: rule.id,
            row: { schedule_id: scheduleId, user_id: trainer.staff_user_id },
            status: "skipped_gate",
            now: input.now,
          });
          if (ok) logged.add(rule.id);
          input.summary.skipped_gate += 1;
          continue;
        }
        const values = classCancelledCustomerBodyParams({
          components: tpl?.components,
          firstName: trainer.full_name,
          className: trainer.class_name,
          classDateYmd: trainer.class_date,
          classTime: trainer.class_time,
        });
        const send = await sendBusinessTemplate({
          to: phone,
          phoneNumberId,
          templateName: rule.template_name,
          alertTriggerId: rule.id,
          languageCode: tpl?.language || "he",
          skipOptOutGate: true,
          recipientKind: "staff",
          components: classCancelledCustomerBodyComponents(values),
        });
        if (!send.ok && isSendsHoldError(send.error)) {
          companion.after(rule.template_name, "gated");
          continue;
        }
        if (send.ok) {
          companion.after(rule.template_name, "immediate");
          const ok = await recordCancelNotify({
            admin: input.admin,
            businessId: input.businessId,
            ruleId: rule.id,
            row: { schedule_id: scheduleId, user_id: trainer.staff_user_id },
            status: "sent",
            now: input.now,
          });
          if (ok) logged.add(rule.id);
          input.summary.trainer_sent += 1;
          console.info("[leads/arbox-class-cancelled-customer] trainer sent", {
            businessId: input.businessId,
            schedule_id: scheduleId,
            trigger_id: rule.id,
            staff_user_id: trainer.staff_user_id,
            phone: maskPhone(phone),
          });
          continue;
        }
        companion.after(rule.template_name, "send_failed");
        const transient = isTransientMetaSendFailure(send.error);
        console.error("[leads/arbox-class-cancelled-customer] trainer send failed", {
          businessId: input.businessId,
          schedule_id: scheduleId,
          trigger_id: rule.id,
          staff_user_id: trainer.staff_user_id,
          phone: maskPhone(phone),
          error: String(send.error ?? "").slice(0, 300),
        });
        if (!transient) {
          const ok = await recordCancelNotify({
            admin: input.admin,
            businessId: input.businessId,
            ruleId: rule.id,
            row: { schedule_id: scheduleId, user_id: trainer.staff_user_id },
            status: "failed",
            now: input.now,
          });
          if (ok) logged.add(rule.id);
        }
      }
    }
  }
}
