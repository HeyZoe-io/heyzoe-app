/**
 * Class cancelled → WhatsApp the people who were registered.
 * Snapshot future bookingsReport rows, stamp schedule_id from classesSummaryReport
 * (status=active, exact class_name + date + HH:MM), then match cancellations on
 * that id only. Name + date + time collides on cancelledSessionsReport.
 *
 * Order per run: cancellation pass, snapshot refresh, send, retention.
 * Scheduling: cron-job.org hourly → /api/cron/arbox-class-cancel-notify.
 * IO (10 businesses, rule enabled): 3–5 Arbox GETs/business/hour
 * (cancelled + bookings + summary, bookings may be 2 pages). No Claude.
 * Businesses without an enabled rule: 0 Arbox calls.
 */
import { ARBOX_API_BASE } from "@/lib/crm/adapters/arbox";
import {
  decideScheduledDrainDispatch,
  decideScheduledSendGate,
} from "@/lib/scheduled-template-sends";
import { isCancelledSessionStatus } from "@/lib/leads/arbox-class-cancelled-staff";
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
import { isUsableStoredFirstName } from "@/lib/template-first-name";
import {
  bodyTextFromTemplateComponents,
  extractBodyVarCount,
} from "@/lib/template-presets";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
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
const NAME_FALLBACK = "שלום";
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
  const token = String(raw ?? "").trim().split(/\s+/).filter(Boolean)[0] ?? "";
  if (!isUsableStoredFirstName(token)) return NAME_FALLBACK;
  return token;
}

/**
 * Body params for class_cancelled_customer, in placeholder order.
 * The count is the template BODY's highest {{n}}, not a fixed slot list.
 * {{1}} first name (sanitized; empty/unusable → "שלום")
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
  const url = path.startsWith("http")
    ? path
    : `${ARBOX_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
    });
    const rawText = await res.text();
    let json: unknown = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, rawText };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, json: null, rawText: msg };
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
      "schedule_id, user_id, class_date, class_time, class_name, phone, first_name, disappeared_at, notify_status, attempts"
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

  const { data: ruleRow, error: ruleErr } = await input.admin
    .from("template_triggers")
    .select("id, template_name, enabled, created_at")
    .eq("business_id", businessId)
    .eq("trigger_type", "class_cancelled_customer")
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  if (ruleErr) {
    console.error("[leads/arbox-class-cancelled-customer] rule lookup failed", {
      businessId,
      error: ruleErr.message,
    });
    summary.skipped = true;
    summary.fetch_error = ruleErr.message;
    return summary;
  }
  const rule = ruleRow as {
    id?: string;
    template_name?: string | null;
    created_at?: string;
  } | null;
  if (!rule?.id) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  const ruleCreatedAt = new Date(String(rule.created_at ?? ""));
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
  }

  if (classCancelQuietHoursDecision(now) === "hold") {
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
      templateName: String(rule.template_name ?? "").trim(),
      rows: rows.filter((r) => r.notify_status === "pending"),
      now,
      summary,
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
  }

  console.info("[leads/arbox-class-cancelled-customer] business done", {
    businessId,
    slug: input.businessSlug,
    dry_run: dryRun,
    cancel_marked: summary.cancel_marked,
    inserted: summary.inserted,
    disappeared: summary.disappeared,
    sent: summary.sent,
    refresh_aborted: summary.refresh_aborted === true,
    gets: summary.pages.length,
  });
  return summary;
}

async function sendPending(input: {
  admin: Db;
  businessId: number;
  templateName: string;
  rows: SnapshotDbRow[];
  now: Date;
  summary: ClassCancelSyncSummary;
}): Promise<void> {
  if (!input.rows.length) return;
  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id").eq("id", input.businessId).maybeSingle(),
    input.templateName
      ? input.admin
          .from("whatsapp_templates")
          .select("id, language, components")
          .eq("business_id", input.businessId)
          .eq("name", input.templateName)
          .eq("status", "APPROVED")
          .eq("disabled", false)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  const language =
    String((approvedTpl as { language?: string } | null)?.language ?? "he").trim() || "he";
  const components = (approvedTpl as { components?: unknown } | null)?.components;

  for (const row of input.rows) {
    if (row.attempts >= CLASS_CANCEL_NOTIFY_ATTEMPT_CAP) {
      await markNotify(input.admin, input.businessId, row, {
        notify_status: "failed",
        attempts: row.attempts,
      });
      input.summary.failed += 1;
      continue;
    }
    if (classStartHasPassed(row.class_date, row.class_time, input.now)) {
      await markNotify(input.admin, input.businessId, row, { notify_status: "skipped_past" });
      input.summary.skipped_past += 1;
      continue;
    }
    const phone = normalizePhone(row.phone);
    if (!phone) {
      await markNotify(input.admin, input.businessId, row, { notify_status: "skipped_no_phone" });
      input.summary.skipped_no_phone += 1;
      continue;
    }
    const optedOut = await contactOptedOut(input.admin, input.businessId, phone);
    if (optedOut === "error") continue;
    if (optedOut) {
      await markNotify(input.admin, input.businessId, row, { notify_status: "skipped_opted_out" });
      input.summary.skipped_opted_out += 1;
      continue;
    }
    const channel =
      (await resolveSendChannelForContact(input.admin, input.businessId, phone)) ??
      (await resolveDefaultSendChannel(input.admin, input.businessId));
    const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
    const gate = decideScheduledSendGate({
      hasChannel: Boolean(phoneNumberId),
      hasWaba: Boolean(wabaId),
      hasApprovedTemplate: Boolean((approvedTpl as { id?: unknown } | null)?.id),
    });
    if (gate.action === "cancel") {
      await markNotify(input.admin, input.businessId, row, { notify_status: "skipped_gate" });
      input.summary.skipped_gate += 1;
      continue;
    }

    const values = classCancelledCustomerBodyParams({
      components,
      firstName: row.first_name,
      className: row.class_name,
      classDateYmd: row.class_date,
      classTime: row.class_time,
    });
    const send = await sendBusinessTemplate({
      to: phone,
      phoneNumberId,
      templateName: input.templateName,
      languageCode: language,
      skipOptOutGate: true,
      components: classCancelledCustomerBodyComponents(values),
    });
    if (send.ok) {
      await markNotify(input.admin, input.businessId, row, {
        notify_status: "sent",
        notified_at: input.now.toISOString(),
        attempts: row.attempts + 1,
      });
      input.summary.sent += 1;
      console.info("[leads/arbox-class-cancelled-customer] sent", {
        businessId: input.businessId,
        schedule_id: row.schedule_id,
        phone: maskPhone(phone),
      });
      continue;
    }
    const next = nextNotifyStatusAfterSendFailure({
      attempts: row.attempts,
      transient: isTransientMetaSendFailure(send.error),
    });
    await markNotify(input.admin, input.businessId, row, next);
    if (next.notify_status === "failed") input.summary.failed += 1;
    console.error("[leads/arbox-class-cancelled-customer] send failed", {
      businessId: input.businessId,
      schedule_id: row.schedule_id,
      phone: maskPhone(phone),
      notify_status: next.notify_status,
      attempts: next.attempts,
      error: String(send.error ?? "").slice(0, 300),
    });
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
