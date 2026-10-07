/**
 * attendance_gap: days since last check_in="Yes" with no future-booking split.
 * (Former C2 only — C1 booked path removed; messaging someone already booked is noise.)
 * Tiers = template_triggers.delay_days (7/14/21). Dedup includes gap_start_date for re-entry.
 * sync_log still stores variant='unbooked' (PK column kept; no migration).
 */
import { logMessage } from "@/lib/analytics";
import {
  addCalendarDaysYmd,
  decideActivationEventAction,
  eventBeforeRuleActivation,
  israelSlotInstant,
} from "@/lib/rule-activation";
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import {
  isCancellationSyncLogTerminal,
  nextCancellationSyncLogAfterDispatch,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import { closeRetentionEvent, markRetentionSent, retentionAlreadySentToday } from "@/lib/leads/retention-daily-cap";
import {
  missedClassOccurrenceKey,
  missedOccurrenceYesCount,
  normalizeMissedClassNamePk,
  normalizeMissedClassTimePk,
} from "@/lib/leads/arbox-missed-class";
import {
  fetchArboxMembersOnHoldReport,
  type ArboxMembersOnHoldRow,
} from "@/lib/leads/arbox-members-on-hold-report";
import {
  isArboxActiveCustomerMembershipStatus,
  isArboxActiveCustomerSessionStatus,
} from "@/lib/leads/arbox-customer-set";
import {
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  sharedFutureBookingsLookup,
  isBookingCheckedIn,
  membershipTypeNameLooksLikeTrial,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildAttendanceGapScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import {
  companionTemplateAlreadySent,
  recordCompanionTemplateSent,
  settleCompanionTemplateSent,
  rulesForCompanionSend,
  runCompanionTemplateSends,
} from "@/lib/same-trigger-template-order";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledAttendanceGapTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Past window for last Yes (Arbox report span cap). Gaps older than this are out of scope. */
export const ATTENDANCE_GAP_PAST_SPAN_DAYS = 30;
/**
 * Future bookings horizon used by freeze ending (C14/C15) shared cron prefetch.
 * Attendance gap itself no longer fetches future bookings.
 */
export const ATTENDANCE_GAP_FUTURE_SPAN_DAYS = 14;

/** Fixed sync_log variant — column kept in PK; booked path removed. */
export const ATTENDANCE_GAP_SYNC_VARIANT = "unbooked" as const;

export type AttendanceGapTriggerType = "attendance_gap";

export type AttendanceGapUserState = {
  userId: number;
  lastYesYmd: string;
  gapDays: number;
  /** Any past row used for phone / name resolution. */
  sampleRow: ArboxBookingReportRow;
};

export type AttendanceGapSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  lookback_from?: string;
  lookback_to?: string;
  fetched_past: number;
  pages_fetched: number;
  users_with_gap: number;
  seeded: number;
  soft_seeded: number;
  processed: number;
  already: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  abandoned: number;
  /** Sends skipped because a booking in the gap sat in a class with zero Yes. */
  class_unmarked: number;
  /** Sends skipped because a freeze is active or overlapped the gap. */
  frozen: number;
  /** membersOnHoldReport windows fetched. Zero when there is no send candidate. */
  freeze_report_calls: number;
  /** Candidates left pending because the freeze report failed. */
  freeze_unavailable: number;
  /** Sends skipped because there is no active paid membership or punch card. */
  not_active_member: number;
  /** Sends skipped because the only active product is a staff membership. */
  staff: number;
  /** Candidates left pending because this run had no complete membership report. */
  member_unavailable: number;
  /** Sends skipped because the person has a booking in the next 14 days. */
  has_future_booking: number;
  /** bookingsReport calls made for the future-booking check. Zero when the run already had the rows. */
  future_booking_calls: number;
  /** Candidates left pending because the future-booking report failed. */
  future_unavailable: number;
  /** delay_days of the enabled rules. */
  gap_delays: number[];
  /** True when the fetched past span reaches the longest delay. */
  lookback_covers_delays: boolean;
  errors: number;
  fetch_error?: string;
};

export function attendanceGapPastWindow(now: Date = new Date()): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(now);
  const [y, m, d] = toDate.split("-").map((n) => Number(n));
  const toUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const fromUtc = new Date(toUtc.getTime() - (ATTENDANCE_GAP_PAST_SPAN_DAYS - 1) * MS_PER_DAY);
  const yy = fromUtc.getUTCFullYear();
  const mm = String(fromUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fromUtc.getUTCDate()).padStart(2, "0");
  return { fromDate: `${yy}-${mm}-${dd}`, toDate };
}

/**
 * Shared future bookingsReport window (freeze ending + trial_reminder).
 * includeToday=false → today+1 … today+14 (freeze ending; class today is not "future").
 * includeToday=true → today … today+14 (trial_reminder delay 0 = morning of class).
 */
export function sharedFutureBookingsWindow(
  now: Date = new Date(),
  opts?: { includeToday?: boolean }
): {
  fromDate: string;
  toDate: string;
} {
  const today = formatDateYmdIsrael(now);
  const [y, m, d] = today.split("-").map((n) => Number(n));
  const todayUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const fromUtc = opts?.includeToday
    ? todayUtc
    : new Date(todayUtc.getTime() + MS_PER_DAY);
  const toUtc = new Date(todayUtc.getTime() + ATTENDANCE_GAP_FUTURE_SPAN_DAYS * MS_PER_DAY);
  const fmt = (dt: Date) => {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };
  return { fromDate: fmt(fromUtc), toDate: fmt(toUtc) };
}

/** Shared with freeze ending cron prefetch (today+1 … today+14). */
export function attendanceGapFutureWindow(now: Date = new Date()): {
  fromDate: string;
  toDate: string;
} {
  return sharedFutureBookingsWindow(now, { includeToday: false });
}

export function ymdDiffDays(laterYmd: string, earlierYmd: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(laterYmd);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(earlierYmd);
  if (!a || !b) return null;
  const later = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]), 12, 0, 0);
  const earlier = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]), 12, 0, 0);
  return Math.round((later - earlier) / MS_PER_DAY);
}

export function parseAttendanceGapUserId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/**
 * After the business seed flag is true: tiers with zero sync_log rows need soft-seed
 * (mark current cohort, no WhatsApp). Empty cohort still needs a one-shot sentinel.
 */
export function attendanceGapTiersNeedingSoftSeed(input: {
  attendanceGapSeeded: boolean;
  configuredTiers: readonly number[];
  tiersWithAnySyncLog: ReadonlySet<number>;
}): number[] {
  if (!input.attendanceGapSeeded) return [];
  return input.configuredTiers.filter((t) => !input.tiersWithAnySyncLog.has(t));
}

/** Users in a seed/soft-seed pass for one tier (no WhatsApp). */
export function attendanceGapSeedCandidates(input: {
  states: readonly AttendanceGapUserState[];
  tier: number;
}): AttendanceGapUserState[] {
  return input.states.filter((s) => s.gapDays >= input.tier);
}

/**
 * E1: seed only when the 09:00 slot on last-Yes + tier already passed.
 * Due on the run day (sendAt === now) or later stays on the send path.
 */
export function attendanceGapDueAction(input: {
  lastYesYmd: string;
  tier: number;
  now: Date;
}): "seed" | "send" {
  const dueYmd = addCalendarDaysYmd(input.lastYesYmd, input.tier);
  const sendAt = dueYmd ? israelSlotInstant(dueYmd, "09:00") : null;
  return decideActivationEventAction({ sendAt, now: input.now });
}

/**
 * One-off for the Oriya 14-day tier. These four were due 2026-10-07 and the
 * new-tier skip never sent them. On 2026-10-08 they take the normal send path.
 * Any earlier run must not seed them.
 */
const ORIYA_TIER14_CATCHUP_USER_IDS = new Set([8966278, 11493613, 11493625, 9177440]);

export function attendanceGapOct8CatchUp(input: {
  businessId: number;
  userId: number;
  tier: number;
  todayYmd: string;
}): "send" | "hold" | null {
  if (input.businessId !== 3646 || input.tier !== 14) return null;
  if (!ORIYA_TIER14_CATCHUP_USER_IDS.has(input.userId)) return null;
  if (input.todayYmd === "2026-10-08") return "send";
  if (input.todayYmd < "2026-10-08") return "hold";
  return null;
}

/** Any booking whose class date falls in [fromYmd, toYmd], including a No check-in. */
export function attendanceGapFutureBookingUserIds(input: {
  rows: readonly { user_id?: unknown; date?: unknown }[];
  fromYmd: string;
  toYmd: string;
}): Set<number> {
  const ids = new Set<number>();
  for (const row of input.rows) {
    const userId = parseAttendanceGapUserId(row.user_id);
    const ymd = parseClassDateYmd(row.date);
    if (userId == null || !ymd) continue;
    if (ymd < input.fromYmd || ymd > input.toYmd) continue;
    ids.add(userId);
  }
  return ids;
}

/**
 * Per-user last real attendance (check_in Yes only — registration/No does not count).
 * No future-booking filter: anyone past the absence tier is a candidate.
 */
export function computeAttendanceGapStates(input: {
  pastRows: readonly ArboxBookingReportRow[];
  todayYmd: string;
}): AttendanceGapUserState[] {
  type Acc = {
    lastYesYmd: string | null;
    sampleRow: ArboxBookingReportRow | null;
  };
  const pastByUser = new Map<number, Acc>();

  for (const row of input.pastRows) {
    const userId = parseAttendanceGapUserId(row.user_id);
    const classDateYmd = parseClassDateYmd(row.date);
    if (userId == null || !classDateYmd) continue;
    if (classDateYmd >= input.todayYmd) continue;

    let acc = pastByUser.get(userId);
    if (!acc) {
      acc = { lastYesYmd: null, sampleRow: row };
      pastByUser.set(userId, acc);
    } else if (!acc.sampleRow) {
      acc.sampleRow = row;
    }

    if (!isBookingCheckedIn(row.check_in)) continue;
    if (!acc.lastYesYmd || classDateYmd > acc.lastYesYmd) {
      acc.lastYesYmd = classDateYmd;
      acc.sampleRow = row;
    }
  }

  const out: AttendanceGapUserState[] = [];
  for (const [userId, past] of pastByUser) {
    if (!past.lastYesYmd || !past.sampleRow) continue;
    const gapDays = ymdDiffDays(input.todayYmd, past.lastYesYmd);
    if (gapDays == null || gapDays < 1) continue;
    out.push({
      userId,
      lastYesYmd: past.lastYesYmd,
      gapDays,
      sampleRow: past.sampleRow,
    });
  }
  return out;
}

/**
 * The fetched span covers a delay when last Yes for that delay is still inside it.
 * A 30-day report starts 29 days back, so delays of 7, 14, and 21 fit. 30 does not.
 */
export function attendanceGapLookbackCoversDelays(input: {
  lookbackFrom: string | undefined;
  todayYmd: string;
  delayDays: readonly number[];
}): boolean {
  const delays = input.delayDays.map((day) => Math.trunc(day)).filter((day) => day > 0);
  if (!input.lookbackFrom || !delays.length) return false;
  const earliestYes = addCalendarDaysYmd(input.todayYmd, -Math.max(...delays));
  if (!earliestYes) return false;
  return input.lookbackFrom <= earliestYes;
}

/**
 * Gap window is past classes strictly after last Yes and before today.
 * A booking in a class occurrence with zero Yes blocks the send.
 * No bookings in the window, or only bookings in a class that has a Yes, do not.
 */
export function attendanceGapUnmarkedBooking(input: {
  userId: number;
  lastYesYmd: string;
  todayYmd: string;
  rows: readonly Pick<ArboxBookingReportRow, "user_id" | "date" | "time" | "class_name">[];
  occurrenceYes: ReadonlyMap<string, number>;
}): { classDate: string; classTime: string; className: string } | null {
  for (const row of input.rows) {
    if (parseAttendanceGapUserId(row.user_id) !== input.userId) continue;
    const classDate = parseClassDateYmd(row.date);
    const classTime = normalizeMissedClassTimePk(row.time);
    const className = normalizeMissedClassNamePk(row.class_name);
    if (!classDate || !classTime || !className) continue;
    if (classDate <= input.lastYesYmd || classDate >= input.todayYmd) continue;
    const yes = input.occurrenceYes.get(missedClassOccurrenceKey(classDate, classTime, className)) ?? 0;
    if (yes > 0) continue;
    return { classDate, classTime, className };
  }
  return null;
}

/** membersOnHoldReport fromDate/toDate span. 30 days apart is the Arbox cap. */
export const ATTENDANCE_GAP_FREEZE_SPAN_CAP_DAYS = 30;
/**
 * Live membersOnHoldReport returns a hold when its END falls in the range.
 * An active freeze ending after today is invisible in a window that stops today.
 * 90 days ahead covers that end; longer spans split into more calls.
 */
export const ATTENDANCE_GAP_FREEZE_END_HORIZON_DAYS = 90;

export type AttendanceGapFreezeWindow = { fromDate: string; toDate: string };

export type AttendanceGapFreezeHold = {
  userId: number;
  startYmd: string;
  /** Null end stays open, so the freeze is still active. */
  endYmd: string | null;
};

export type AttendanceGapFreezeDecision = "send" | "frozen" | "pending" | "stale_hold";

/**
 * Holds are returned by END date. Cover from the earliest candidate last-Yes
 * through today+horizon so an active freeze and one that already ended inside
 * the gap are both visible. No candidates → no call. A delay longer than the
 * cap pulls the start back to today−delay. Spans over the cap split.
 */
export function attendanceGapFreezeReportWindows(input: {
  candidateLastYesYmds: readonly string[];
  todayYmd: string;
  maxDelayDays: number;
  spanCapDays?: number;
  endHorizonDays?: number;
}): AttendanceGapFreezeWindow[] {
  if (!input.candidateLastYesYmds.length) return [];
  const cap = Math.max(1, Math.trunc(input.spanCapDays ?? ATTENDANCE_GAP_FREEZE_SPAN_CAP_DAYS));
  let start = input.candidateLastYesYmds.reduce((earliest, ymd) => (ymd < earliest ? ymd : earliest));
  const delay = Math.max(0, Math.trunc(input.maxDelayDays));
  if (delay > cap) {
    const delayStart = addCalendarDaysYmd(input.todayYmd, -delay);
    if (delayStart && delayStart < start) start = delayStart;
  }
  const horizon = Math.max(0, Math.trunc(input.endHorizonDays ?? ATTENDANCE_GAP_FREEZE_END_HORIZON_DAYS));
  const horizonEnd = addCalendarDaysYmd(input.todayYmd, horizon);
  const end = horizonEnd && horizonEnd > input.todayYmd ? horizonEnd : input.todayYmd;
  if (!start || start > end) return [];
  const windows: AttendanceGapFreezeWindow[] = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = addCalendarDaysYmd(cursor, cap);
    if (!chunkEnd) break;
    const toDate = chunkEnd < end ? chunkEnd : end;
    windows.push({ fromDate: cursor, toDate });
    if (toDate >= end) break;
    const next = addCalendarDaysYmd(toDate, 1);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return windows;
}

/** Active now, or the hold overlaps last-Yes…today. An end before last Yes does not. */
export function attendanceGapFreezeBlocks(input: {
  userId: number;
  lastYesYmd: string;
  todayYmd: string;
  holds: readonly AttendanceGapFreezeHold[];
}): AttendanceGapFreezeHold | null {
  for (const hold of input.holds) {
    if (hold.userId !== input.userId) continue;
    if (!hold.startYmd || hold.startYmd > input.todayYmd) continue;
    if (hold.endYmd && hold.endYmd < input.lastYesYmd) continue;
    return hold;
  }
  return null;
}

/**
 * A pending row with no contact is the freeze-report failure marker.
 * The same Israel day can still send. A later day must not.
 */
export function attendanceGapStaleFreezeHold(input: {
  status: string | null | undefined;
  contactId: string | null | undefined;
  processedAtIso: string | null | undefined;
  todayYmd: string;
}): boolean {
  if (String(input.status ?? "").trim() !== "pending") return false;
  if (input.contactId) return false;
  if (!input.processedAtIso || !input.todayYmd) return false;
  const processed = new Date(input.processedAtIso);
  if (Number.isNaN(processed.getTime())) return false;
  const processedYmd = formatDateYmdIsrael(processed);
  return Boolean(processedYmd) && processedYmd < input.todayYmd;
}

export function attendanceGapDecideFreeze(input: {
  reportOk: boolean;
  userId: number;
  lastYesYmd: string;
  todayYmd: string;
  holds: readonly AttendanceGapFreezeHold[];
  existingStatus?: string | null;
  existingContactId?: string | null;
  existingProcessedAtIso?: string | null;
}): AttendanceGapFreezeDecision {
  if (
    attendanceGapStaleFreezeHold({
      status: input.existingStatus,
      contactId: input.existingContactId,
      processedAtIso: input.existingProcessedAtIso,
      todayYmd: input.todayYmd,
    })
  ) {
    return "stale_hold";
  }
  if (!input.reportOk) return "pending";
  if (
    attendanceGapFreezeBlocks({
      userId: input.userId,
      lastYesYmd: input.lastYesYmd,
      todayYmd: input.todayYmd,
      holds: input.holds,
    })
  ) {
    return "frozen";
  }
  return "send";
}

function attendanceGapHoldsFromRows(rows: readonly ArboxMembersOnHoldRow[]): AttendanceGapFreezeHold[] {
  const holds: AttendanceGapFreezeHold[] = [];
  for (const row of rows) {
    const userId = parseAttendanceGapUserId(row.user_id) ?? parseAttendanceGapUserId(row.membership_user_id);
    const startYmd = parseClassDateYmd(row.start_suspend_time);
    if (userId == null || !startYmd) continue;
    holds.push({
      userId,
      startYmd,
      endYmd: parseClassDateYmd(row.end_suspend_time),
    });
  }
  return holds;
}

/**
 * Arbox membership type is plan | session | service | trial. There is no staff flag.
 * ציפורה's live product is type plan, name "מנוי צוות".
 */
export function attendanceGapMembershipIsStaff(name: unknown): boolean {
  return /צוות|\bstaff\b/i.test(String(name ?? ""));
}

export type AttendanceGapMemberDecision = "send" | "staff" | "not_active_member";

function attendanceGapProductName(row: Record<string, unknown>): string {
  return String(row.membership_type_name ?? row.name ?? row.item_name ?? "").trim();
}

function attendanceGapProductType(row: Record<string, unknown>): string {
  return String(row.type ?? row.membership_type ?? row.item_type ?? "").trim().toLowerCase();
}

function attendanceGapTrialTypeIds(raw: readonly number[] | undefined): number[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw.map((id) => Math.trunc(Number(id))).filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
}

function attendanceGapRowIsTrial(row: Record<string, unknown>, trialTypeIds: readonly number[]): boolean {
  const type = attendanceGapProductType(row);
  if (type === "trial") return true;
  if (membershipTypeNameLooksLikeTrial(attendanceGapProductName(row))) return true;
  const id = Number(row.membership_type_id);
  return Number.isFinite(id) && id > 0 && trialTypeIds.includes(Math.trunc(id));
}

/** Active paid plan, punch card, or staff. Trial and service do not qualify. */
function attendanceGapActiveProductHit(
  row: Record<string, unknown>,
  source: "membership" | "session",
  trialTypeIds: readonly number[]
): "paid" | "punch" | "staff" | null {
  const active =
    source === "membership"
      ? isArboxActiveCustomerMembershipStatus(row.status)
      : isArboxActiveCustomerSessionStatus(row.status);
  if (!active) return null;
  if (attendanceGapMembershipIsStaff(attendanceGapProductName(row))) return "staff";
  if (attendanceGapRowIsTrial(row, trialTypeIds)) return null;
  const type = attendanceGapProductType(row);
  if (source === "session" || type === "session") return "punch";
  if (type === "service") return null;
  return "paid";
}

/**
 * Send only for an active paid plan or a valid punch card.
 * Staff alone does not send. A paid plan beside a staff plan still sends.
 * Anyone else in these active rows (trial only, or absent) does not send.
 */
export function attendanceGapMemberDecision(input: {
  userId: number;
  membershipRows: readonly Record<string, unknown>[];
  sessionRows: readonly Record<string, unknown>[];
  trialTypeIds?: readonly number[];
}): AttendanceGapMemberDecision {
  const trialTypeIds = attendanceGapTrialTypeIds(input.trialTypeIds);
  let staff = false;
  let send = false;
  const visit = (row: Record<string, unknown>, source: "membership" | "session") => {
    if (parseAttendanceGapUserId(row.user_id) !== input.userId) return;
    const hit = attendanceGapActiveProductHit(row, source, trialTypeIds);
    if (hit === "paid" || hit === "punch") send = true;
    else if (hit === "staff") staff = true;
  };
  for (const row of input.membershipRows) visit(row, "membership");
  for (const row of input.sessionRows) visit(row, "session");
  if (send) return "send";
  if (staff) return "staff";
  return "not_active_member";
}

export function attendanceGapStaffProducts(input: {
  membershipRows: readonly Record<string, unknown>[];
  sessionRows: readonly Record<string, unknown>[];
}): { userId: number; name: string; source: "membership" | "session" }[] {
  const out: { userId: number; name: string; source: "membership" | "session" }[] = [];
  const visit = (row: Record<string, unknown>, source: "membership" | "session") => {
    const active =
      source === "membership"
        ? isArboxActiveCustomerMembershipStatus(row.status)
        : isArboxActiveCustomerSessionStatus(row.status);
    if (!active) return;
    const name = attendanceGapProductName(row);
    if (!attendanceGapMembershipIsStaff(name)) return;
    const userId = parseAttendanceGapUserId(row.user_id);
    if (userId == null) return;
    out.push({ userId, name, source });
  };
  for (const row of input.membershipRows) visit(row, "membership");
  for (const row of input.sessionRows) visit(row, "session");
  return out;
}

function resolveReportFullName(row: ArboxBookingReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

type ContactRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  arbox_user_id: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxBookingReportRow;
  source: string;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const contactSelect = "id, phone, full_name, arbox_user_id";
  const arboxUserId = String(input.row.user_id ?? "").trim();
  let phoneNorm = normalizePhone(input.row.phone);
  const fullName = resolveReportFullName(input.row);

  let existing: ContactRow | undefined;
  if (arboxUserId) {
    const { data } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", input.businessId)
      .eq("arbox_user_id", arboxUserId)
      .order("updated_at", { ascending: false })
      .limit(1);
    existing = data?.[0] as ContactRow | undefined;
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
    if (arboxUserId && String(existing.arbox_user_id ?? "").trim() !== arboxUserId) {
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
      source: input.source,
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();
  if (error || !inserted) {
    console.error("[leads/arbox-attendance-gap] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertGapSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  userId: number;
  gapStartDate: string;
  tier: number;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_attendance_gap_sync_log").upsert(
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      user_id: input.userId,
      variant: ATTENDANCE_GAP_SYNC_VARIANT,
      gap_start_date: input.gapStartDate,
      tier: input.tier,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    { onConflict: "business_id,trigger_id,user_id,variant,gap_start_date,tier" }
  );
  if (error) {
    console.error("[leads/arbox-attendance-gap] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchGapTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  contactFullName?: string | null;
  userId: number;
  gapStartDate: string;
  tier: number;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
  dueOffsetMs?: number;
}): Promise<{ dispatch: "immediate" | "deferred" | "gated" | "skipped" | "send_failed" | "no_rule"; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  // Tier lives in delay_days; send is immediate on detection day (not event+N).
  const dueAt = new Date(
    computeDueAt({ delay_days: 0, delay_direction: "after" }, input.now).getTime() +
      Math.max(0, input.dueOffsetMs ?? 0)
  );

  if (dueAt.getTime() > input.now.getTime() + 15_000) {
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildAttendanceGapScheduledDedupKey(
        input.businessId,
        input.rule.id,
        input.userId,
        input.gapStartDate,
        input.tier
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-attendance-gap] enqueue failed:", enqueueResult.error);
      return { dispatch: "send_failed", ok: false };
    }
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
    { full_name: input.contactFullName ?? null },
    input.fullName
  );
  if (!firstName && templateBodyUsesFirstNameSlot("attendance_gap", (approvedTpl as { components?: unknown }).components)) {
    console.info("[leads/arbox-attendance-gap] skip", { reason: "no_valid_name" });
    return { dispatch: "skipped", ok: false };
  }
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "attendance_gap",
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

  if (!sendResult.ok) {
    console.error("[leads/arbox-attendance-gap] template send failed:", sendResult.error);
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

function normalizeTiersFromRules(rules: PurchaseTemplateTriggerRule[]): number[] {
  const tiers = new Set<number>();
  for (const r of rules) {
    if (!r.template_name?.trim()) continue;
    const t = Math.max(1, Math.trunc(Number(r.delay_days) || 0));
    tiers.add(t);
  }
  return [...tiers].sort((a, b) => a - b);
}

/** Soft-seed: tiers with zero sync_log rows for this business after global seed. */
export async function findAttendanceGapTiersNeedingSoftSeed(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  tiers: number[];
}): Promise<number[]> {
  const withRows = new Set<number>();
  for (const tier of input.tiers) {
    const { count, error } = await input.admin
      .from("arbox_attendance_gap_sync_log")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .eq("variant", ATTENDANCE_GAP_SYNC_VARIANT)
      .eq("tier", tier);
    if (error) {
      console.error("[leads/arbox-attendance-gap] soft-seed count failed:", error.message);
      continue;
    }
    if ((count ?? 0) > 0) withRows.add(tier);
  }
  return attendanceGapTiersNeedingSoftSeed({
    attendanceGapSeeded: true,
    configuredTiers: input.tiers,
    tiersWithAnySyncLog: withRows,
  });
}

export async function syncArboxAttendanceGapForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  attendanceGapSeeded: boolean;
  now?: Date;
  /** Past bookingsReport rows (shared cron prefetch preferred). */
  prefetchedPastRows?: ArboxBookingReportRow[];
  prefetchedPastPages?: number;
  lookbackFrom?: string;
  lookbackTo?: string;
  /**
   * activeMembershipsReport from this same run. Undefined means it was not loaded.
   * A complete empty array means nobody is active.
   */
  activeMembershipRows?: Record<string, unknown>[];
  activeMembershipsComplete?: boolean;
  /** sessionsReport from this same run (punch cards). Undefined means it was not loaded. */
  activeSessionRows?: Record<string, unknown>[];
  activeSessionsComplete?: boolean;
  trialMembershipTypeIds?: readonly number[];
}): Promise<AttendanceGapSyncSummary> {
  const summary: AttendanceGapSyncSummary = {
    fetched_past: 0,
    pages_fetched: 0,
    users_with_gap: 0,
    seeded: 0,
    soft_seeded: 0,
    processed: 0,
    already: 0,
    notified: 0,
    deferred: 0,
    gated: 0,
    no_phone: 0,
    abandoned: 0,
    class_unmarked: 0,
    frozen: 0,
    freeze_report_calls: 0,
    freeze_unavailable: 0,
    not_active_member: 0,
    staff: 0,
    member_unavailable: 0,
    has_future_booking: 0,
    future_booking_calls: 0,
    future_unavailable: 0,
    gap_delays: [],
    lookback_covers_delays: false,
    errors: 0,
  };

  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const todayYmd = formatDateYmdIsrael(now);

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const rules = await loadEnabledAttendanceGapTemplateTriggers(input.admin, businessId);
  const tiers = normalizeTiersFromRules(rules);
  summary.gap_delays = tiers;
  if (!tiers.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  let pastRows: ArboxBookingReportRow[];
  if (input.prefetchedPastRows) {
    pastRows = input.prefetchedPastRows;
    summary.pages_fetched = input.prefetchedPastPages ?? 0;
    summary.lookback_from = input.lookbackFrom;
    summary.lookback_to = input.lookbackTo;
  } else {
    const pastWindow = attendanceGapPastWindow(now);
    summary.lookback_from = pastWindow.fromDate;
    summary.lookback_to = pastWindow.toDate;
    const pastReport = await fetchArboxBookingsReport({
      apiKey,
      fromDate: pastWindow.fromDate,
      toDate: pastWindow.toDate,
      locationId: boxId,
    });
    summary.pages_fetched = pastReport.pagesFetched;
    if (!pastReport.ok) {
      summary.fetch_error = pastReport.error;
      summary.errors += 1;
      return summary;
    }
    pastRows = pastReport.rows;
  }
  summary.fetched_past = pastRows.length;
  summary.lookback_covers_delays = attendanceGapLookbackCoversDelays({
    lookbackFrom: summary.lookback_from,
    todayYmd,
    delayDays: tiers,
  });
  const occurrenceYes = missedOccurrenceYesCount(pastRows);

  const states = computeAttendanceGapStates({
    pastRows,
    todayYmd,
  });
  summary.users_with_gap = states.length;

  let seedTiers: number[] = [];
  if (!input.attendanceGapSeeded) {
    seedTiers = tiers;
  } else {
    seedTiers = await findAttendanceGapTiersNeedingSoftSeed({
      admin: input.admin,
      businessId,
      tiers,
    });
  }

  const isFullSeed = !input.attendanceGapSeeded;

  for (const tier of seedTiers) {
    let wroteForTier = 0;
    for (const state of attendanceGapSeedCandidates({ states, tier })) {
      const catchUp = attendanceGapOct8CatchUp({
        businessId,
        userId: state.userId,
        tier,
        todayYmd,
      });
      if (catchUp === "send" || catchUp === "hold") continue;
      if (attendanceGapDueAction({ lastYesYmd: state.lastYesYmd, tier, now }) === "send") continue;
      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row: state.sampleRow,
        source: "arbox_attendance_gap_seed",
      });
      const tierRuleIds = rules
        .filter(
          (candidate) =>
            Boolean(candidate.template_name?.trim()) &&
            Math.max(1, Math.trunc(Number(candidate.delay_days) || 0)) === tier &&
            candidate.id
        )
        .map((candidate) => candidate.id);
      let upOk = true;
      for (const triggerId of tierRuleIds) {
        const up = await upsertGapSyncLog({
          admin: input.admin,
          businessId,
          triggerId,
          userId: state.userId,
          gapStartDate: state.lastYesYmd,
          tier,
          contactId: resolved.contact?.id ?? null,
          attempts: 0,
          status: "seeded",
          nowIso,
        });
        if (!up.ok) upOk = false;
      }
      if (upOk && tierRuleIds.length) {
        wroteForTier += 1;
        if (isFullSeed) summary.seeded += 1;
        else summary.soft_seeded += 1;
        console.info("[leads/arbox-attendance-gap] seeded_past_due", {
          businessId,
          tier,
          user_id: state.userId,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(String(state.sampleRow.phone ?? "")),
          last_yes: state.lastYesYmd,
          due: addCalendarDaysYmd(state.lastYesYmd, tier),
          reason: "seeded_past_due",
        });
      } else summary.errors += 1;
    }
    // Soft-seed must be one-shot even with an empty cohort.
    if (!isFullSeed && wroteForTier === 0) {
      const sentinel = await upsertGapSyncLog({
        admin: input.admin,
        businessId,
        triggerId: "00000000-0000-0000-0000-000000000000",
        userId: 0,
        gapStartDate: todayYmd,
        tier,
        contactId: null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (sentinel.ok) summary.soft_seeded += 1;
      else summary.errors += 1;
    }
  }

  if (isFullSeed) {
    const { error: seedFlagErr } = await input.admin
      .from("businesses")
      .update({ arbox_attendance_gap_seeded: true })
      .eq("id", businessId);
    if (seedFlagErr) {
      console.error("[leads/arbox-attendance-gap] seed flag update failed:", seedFlagErr.message);
      summary.errors += 1;
    }
    console.info("[leads/arbox-attendance-gap] seeded current gaps", {
      businessId,
      businessSlug,
      seeded: summary.seeded,
    });
  } else if (seedTiers.length) {
    console.info("[leads/arbox-attendance-gap] soft-seeded new tiers", {
      businessId,
      businessSlug,
      soft_seeded: summary.soft_seeded,
      tiers: seedTiers,
    });
  }

  type GapExistingRow = {
    status?: unknown;
    contact_id?: unknown;
    processed_at?: unknown;
    trigger_id?: unknown;
  };
  type GapSendCandidate = {
    state: AttendanceGapUserState;
    tier: number;
    pendingRules: PurchaseTemplateTriggerRule[];
    existingRows: GapExistingRow[];
  };
  const staffProducts = attendanceGapStaffProducts({
    membershipRows: input.activeMembershipRows ?? [],
    sessionRows: input.activeSessionRows ?? [],
  });
  console.info("[leads/arbox-attendance-gap] staff_memberships", {
    businessId,
    detection: "name_contains_צוות_or_staff",
    memberships_complete: input.activeMembershipsComplete === true,
    sessions_complete: input.activeSessionsComplete === true,
    count: staffProducts.length,
    products: staffProducts.map((product) => ({
      user_id: product.userId,
      name: product.name,
      source: product.source,
    })),
  });

  const gapSendQueue: GapSendCandidate[] = [];

  for (const state of states) {
    for (const tier of tiers) {
      if (state.gapDays < tier) continue;
      const catchUp = attendanceGapOct8CatchUp({
        businessId,
        userId: state.userId,
        tier,
        todayYmd,
      });
      if (catchUp === "hold") continue;

      const tierRules = rulesForCompanionSend(
        rules.filter(
          (candidate) =>
            Boolean(candidate.template_name?.trim()) &&
            Math.max(1, Math.trunc(Number(candidate.delay_days) || 0)) === tier &&
            (catchUp === "send" ||
              !eventBeforeRuleActivation(
                israelSlotInstant(addCalendarDaysYmd(state.lastYesYmd, tier) ?? "", "09:00"),
                candidate
              ))
        )
      );
      if (!tierRules.length) continue;

      try {
        const { data: existingRows } = await input.admin
          .from("arbox_attendance_gap_sync_log")
          .select("trigger_id, status, attempts, contact_id, processed_at")
          .eq("business_id", businessId)
          .eq("user_id", state.userId)
          .eq("variant", ATTENDANCE_GAP_SYNC_VARIANT)
          .eq("gap_start_date", state.lastYesYmd)
          .eq("tier", tier);
        const rows = (existingRows ?? []) as GapExistingRow[];
        const terminalIds = new Set(
          rows
            .filter((row) => isCancellationSyncLogTerminal(String(row.status ?? "")))
            .map((row) => String(row.trigger_id ?? ""))
        );
        const pendingRules = tierRules.filter((rule) => rule.id && !terminalIds.has(rule.id));
        if (!pendingRules.length) {
          summary.already += 1;
          continue;
        }
        gapSendQueue.push({ state, tier, pendingRules, existingRows: rows });
      } catch (e) {
        summary.errors += 1;
        console.error("[leads/arbox-attendance-gap] row threw", {
          businessId,
          user_id: state.userId,
          tier,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  const futureWindow = sharedFutureBookingsWindow(now, { includeToday: true });
  let futureBookingUserIds = new Set<number>();
  let futureReportOk = true;
  if (gapSendQueue.length) {
    const lookup = sharedFutureBookingsLookup(futureWindow.fromDate, futureWindow.toDate);
    if (lookup === "missing") summary.future_booking_calls += 1;
    if (lookup === "failed") {
      futureReportOk = false;
      summary.errors += 1;
      summary.fetch_error = "future_bookings_unavailable";
    } else {
      const futureReport = await fetchArboxBookingsReport({
        apiKey,
        fromDate: futureWindow.fromDate,
        toDate: futureWindow.toDate,
        locationId: boxId,
      });
      if (!futureReport.ok) {
        futureReportOk = false;
        summary.errors += 1;
        summary.fetch_error = futureReport.error;
        console.error("[leads/arbox-attendance-gap] future bookings failed", {
          businessId,
          error: futureReport.error,
        });
      } else {
        futureBookingUserIds = attendanceGapFutureBookingUserIds({
          rows: futureReport.rows,
          fromYmd: futureWindow.fromDate,
          toYmd: futureWindow.toDate,
        });
      }
    }
    console.info("[leads/arbox-attendance-gap] future_bookings", {
      businessId,
      from: futureWindow.fromDate,
      to: futureWindow.toDate,
      calls: summary.future_booking_calls,
      lookup,
      ok: futureReportOk,
      users: futureBookingUserIds.size,
    });
  }

  const freezeHolds: AttendanceGapFreezeHold[] = [];
  let freezeReportOk = true;
  if (gapSendQueue.length) {
    const windows = attendanceGapFreezeReportWindows({
      candidateLastYesYmds: gapSendQueue.map((item) => item.state.lastYesYmd),
      todayYmd,
      maxDelayDays: Math.max(...tiers),
    });
    for (const window of windows) {
      const report = await fetchArboxMembersOnHoldReport({
        apiKey,
        fromDate: window.fromDate,
        toDate: window.toDate,
        locationId: boxId,
      });
      summary.freeze_report_calls += 1;
      if (!report.ok || report.hitPageCap) {
        freezeReportOk = false;
        summary.errors += 1;
        summary.fetch_error = report.ok ? "membersOnHoldReport_page_cap" : report.error;
        console.error("[leads/arbox-attendance-gap] freeze report failed", {
          businessId,
          from: window.fromDate,
          to: window.toDate,
          error: summary.fetch_error,
        });
        break;
      }
      freezeHolds.push(...attendanceGapHoldsFromRows(report.rows));
    }
    console.info("[leads/arbox-attendance-gap] freeze_report", {
      businessId,
      calls: summary.freeze_report_calls,
      ok: freezeReportOk,
      holds: freezeHolds.length,
      windows,
    });
  }

  for (const item of gapSendQueue) {
    const { state, tier, pendingRules } = item;
    try {
      const stale = item.existingRows.some((row) =>
        attendanceGapStaleFreezeHold({
          status: row.status == null ? null : String(row.status),
          contactId:
            row.contact_id == null || String(row.contact_id).trim() === ""
              ? null
              : String(row.contact_id),
          processedAtIso: row.processed_at == null ? null : String(row.processed_at),
          todayYmd,
        })
      );
      if (stale || !freezeReportOk) {
        const status: CancellationSyncLogStatus = stale ? "seeded" : "pending";
        let wroteOk = true;
        for (const rule of pendingRules) {
          const up = await upsertGapSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: state.userId,
            gapStartDate: state.lastYesYmd,
            tier,
            contactId: null,
            attempts: 0,
            status,
            nowIso,
          });
          if (!up.ok) wroteOk = false;
        }
        if (!wroteOk) summary.errors += 1;
        summary.freeze_unavailable += 1;
        console.info("[leads/arbox-attendance-gap] freeze_report_failed", {
          businessId,
          tier,
          user_id: state.userId,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(String(state.sampleRow.phone ?? "")),
          last_yes: state.lastYesYmd,
          status,
          reason: "freeze_report_failed",
        });
        continue;
      }

      if (!futureReportOk) {
        let wroteOk = true;
        for (const rule of pendingRules) {
          const up = await upsertGapSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: state.userId,
            gapStartDate: state.lastYesYmd,
            tier,
            contactId: null,
            attempts: 0,
            status: "pending",
            nowIso,
          });
          if (!up.ok) wroteOk = false;
        }
        if (!wroteOk) summary.errors += 1;
        summary.future_unavailable += 1;
        console.info("[leads/arbox-attendance-gap] future_bookings_unavailable", {
          businessId,
          tier,
          user_id: state.userId,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(String(state.sampleRow.phone ?? "")),
          last_yes: state.lastYesYmd,
          status: "pending",
          reason: "future_bookings_unavailable",
        });
        continue;
      }

      const unmarked = attendanceGapUnmarkedBooking({
        userId: state.userId,
        lastYesYmd: state.lastYesYmd,
        todayYmd,
        rows: pastRows,
        occurrenceYes,
      });
      if (unmarked) {
        let seededOk = true;
        for (const rule of pendingRules) {
          const up = await upsertGapSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: state.userId,
            gapStartDate: state.lastYesYmd,
            tier,
            contactId: null,
            attempts: 0,
            status: "seeded",
            nowIso,
          });
          if (!up.ok) seededOk = false;
        }
        if (!seededOk) summary.errors += 1;
        summary.class_unmarked += 1;
        console.info("[leads/arbox-attendance-gap] class_unmarked", {
          businessId,
          tier,
          user_id: state.userId,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(String(state.sampleRow.phone ?? "")),
          last_yes: state.lastYesYmd,
          class_date: unmarked.classDate,
          class_time: unmarked.classTime,
          class_name: unmarked.className,
          reason: "class_unmarked",
        });
        continue;
      }

      const blocking = attendanceGapFreezeBlocks({
        userId: state.userId,
        lastYesYmd: state.lastYesYmd,
        todayYmd,
        holds: freezeHolds,
      });
      if (blocking) {
        let seededOk = true;
        for (const rule of pendingRules) {
          const up = await upsertGapSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: state.userId,
            gapStartDate: state.lastYesYmd,
            tier,
            contactId: null,
            attempts: 0,
            status: "seeded",
            nowIso,
          });
          if (!up.ok) seededOk = false;
        }
        if (!seededOk) summary.errors += 1;
        summary.frozen += 1;
        console.info("[leads/arbox-attendance-gap] frozen", {
          businessId,
          tier,
          user_id: state.userId,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(String(state.sampleRow.phone ?? "")),
          last_yes: state.lastYesYmd,
          freeze_start: blocking.startYmd,
          freeze_end: blocking.endYmd,
          reason: "frozen",
        });
        continue;
      }

      const membershipsReady = input.activeMembershipsComplete === true && input.activeMembershipRows != null;
      const sessionsReady = input.activeSessionsComplete === true && input.activeSessionRows != null;
      const memberDecision = membershipsReady
        ? attendanceGapMemberDecision({
            userId: state.userId,
            membershipRows: input.activeMembershipRows ?? [],
            sessionRows: sessionsReady ? (input.activeSessionRows ?? []) : [],
            trialTypeIds: input.trialMembershipTypeIds,
          })
        : null;
      if (!membershipsReady || (memberDecision === "not_active_member" && !sessionsReady)) {
        let wroteOk = true;
        for (const rule of pendingRules) {
          const up = await upsertGapSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: state.userId,
            gapStartDate: state.lastYesYmd,
            tier,
            contactId: null,
            attempts: 0,
            status: "pending",
            nowIso,
          });
          if (!up.ok) wroteOk = false;
        }
        if (!wroteOk) summary.errors += 1;
        summary.member_unavailable += 1;
        console.info("[leads/arbox-attendance-gap] member_unavailable", {
          businessId,
          tier,
          user_id: state.userId,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(String(state.sampleRow.phone ?? "")),
          last_yes: state.lastYesYmd,
          memberships_ready: membershipsReady,
          sessions_ready: sessionsReady,
          status: "pending",
          reason: "member_report_unavailable",
        });
        continue;
      }
      if (memberDecision !== "send") {
        let seededOk = true;
        for (const rule of pendingRules) {
          const up = await upsertGapSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: state.userId,
            gapStartDate: state.lastYesYmd,
            tier,
            contactId: null,
            attempts: 0,
            status: "seeded",
            nowIso,
          });
          if (!up.ok) seededOk = false;
        }
        if (!seededOk) summary.errors += 1;
        if (memberDecision === "staff") summary.staff += 1;
        else summary.not_active_member += 1;
        console.info("[leads/arbox-attendance-gap] member", {
          businessId,
          tier,
          user_id: state.userId,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(String(state.sampleRow.phone ?? "")),
          last_yes: state.lastYesYmd,
          reason: memberDecision,
        });
        continue;
      }

      if (futureBookingUserIds.has(state.userId)) {
        let seededOk = true;
        for (const rule of pendingRules) {
          const up = await upsertGapSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId: state.userId,
            gapStartDate: state.lastYesYmd,
            tier,
            contactId: null,
            attempts: 0,
            status: "seeded",
            nowIso,
          });
          if (!up.ok) seededOk = false;
        }
        if (!seededOk) summary.errors += 1;
        summary.has_future_booking += 1;
        console.info("[leads/arbox-attendance-gap] future_booking", {
          businessId,
          tier,
          user_id: state.userId,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(String(state.sampleRow.phone ?? "")),
          last_yes: state.lastYesYmd,
          reason: "has_future_booking",
        });
        continue;
      }

        const attemptsSoFar = 0;

        const resolved = await resolveOrCreateContact({
          admin: input.admin,
          businessId,
          row: state.sampleRow,
          source: "arbox_attendance_gap",
        });
        if (!resolved.phone || !resolved.contact?.id) {
          summary.no_phone += 1;
          for (const rule of pendingRules) {
            await upsertGapSyncLog({
              admin: input.admin,
              businessId,
              triggerId: rule.id,
              userId: state.userId,
              gapStartDate: state.lastYesYmd,
              tier,
              contactId: resolved.contact?.id ?? null,
              attempts: attemptsSoFar,
              status: "no_phone",
              nowIso,
            });
          }
          continue;
        }

        const sendPhone = resolved.phone;
        const sendContact = resolved.contact;
        if (!sendPhone || !sendContact) continue;
        if (await retentionAlreadySentToday(input.admin, businessId, sendPhone, now)) {
          console.info("[leads/arbox-attendance-gap] dispatch", {
            businessId,
            user_id: state.userId,
            tier,
            dispatch: "skipped",
            reason: "retention_daily_cap",
          });
          for (const rule of pendingRules) {
            await closeRetentionEvent({
              admin: input.admin,
              businessId,
              triggerId: rule.id,
              phone: sendPhone,
              templateName: String(rule.template_name ?? ""),
              dedupKey: buildAttendanceGapScheduledDedupKey(
                businessId,
                rule.id,
                state.userId,
                state.lastYesYmd,
                tier
              ),
              now,
            });
            await upsertGapSyncLog({
              admin: input.admin,
              businessId,
              triggerId: rule.id,
              userId: state.userId,
              gapStartDate: state.lastYesYmd,
              tier,
              contactId: sendContact.id,
              attempts: attemptsSoFar,
              status: "skipped",
              nowIso,
            });
          }
          continue;
        }

        const sendDispatch = await runCompanionTemplateSends({
          rules: pendingRules,
          dryRun: isArboxDailyDryRun(),
          send: async (rule, ctx) => {
            const send = await dispatchGapTemplate({
              admin: input.admin,
              businessId,
              businessSlug,
              phone: sendPhone,
              fullName: resolveReportFullName(state.sampleRow),
              contactFullName: sendContact.full_name ?? null,
              userId: state.userId,
              gapStartDate: state.lastYesYmd,
              tier,
              rule,
              now,
              dueOffsetMs: ctx.dueOffsetMs,
            });
            return send.dispatch;
          },
          alreadyDelivered: (rule) =>
            companionTemplateAlreadySent(
              input.admin,
              buildAttendanceGapScheduledDedupKey(
                businessId,
                rule.id,
                state.userId,
                state.lastYesYmd,
                tier
              ),
              { businessId, triggerId: rule.id }
            ),
          recordDelivered: (rule) =>
            recordCompanionTemplateSent(input.admin, {
              dedupKey: buildAttendanceGapScheduledDedupKey(
                businessId,
                rule.id,
                state.userId,
                state.lastYesYmd,
                tier
              ),
              businessId,
              ruleId: rule.id,
              phone: sendPhone,
              templateName: String(rule.template_name ?? "").trim(),
              nowIso,
            }),
          settleDelivered: (rule, status) =>
            settleCompanionTemplateSent(
              input.admin,
              buildAttendanceGapScheduledDedupKey(
                businessId,
                rule.id,
                state.userId,
                state.lastYesYmd,
                tier
              ),
              status
            ),
        });

        const mapped =
          sendDispatch === "immediate"
            ? ("immediate" as const)
            : sendDispatch === "deferred"
              ? ("deferred" as const)
              : sendDispatch === "gated"
                ? ("gated" as const)
                : sendDispatch === "skipped"
                  ? ("skipped" as const)
                  : sendDispatch === "send_failed"
                    ? ("send_failed" as const)
                    : ("gated" as const);

        const next = nextCancellationSyncLogAfterDispatch({
          dispatch: mapped,
          attemptsSoFar,
        });
        for (const rule of pendingRules) {
        await upsertGapSyncLog({
          admin: input.admin,
          businessId,
          triggerId: rule.id,
          userId: state.userId,
          gapStartDate: state.lastYesYmd,
          tier,
          contactId: resolved.contact.id,
          attempts: next.attempts,
          status: next.status,
          nowIso,
        });
        }

        summary.processed += 1;
        if (sendDispatch === "immediate" || sendDispatch === "deferred") {
          markRetentionSent(businessId, sendPhone, now);
        }
        if (sendDispatch === "immediate") summary.notified += 1;
        else if (sendDispatch === "deferred") summary.deferred += 1;
        else if (sendDispatch === "gated") summary.gated += 1;
        else if (sendDispatch === "send_failed") {
          if (next.hitCap) summary.abandoned += 1;
          else summary.errors += 1;
        }

        console.info("[leads/arbox-attendance-gap] dispatch", {
          businessId,
          tier,
          user_id: state.userId,
          gap_days: state.gapDays,
          gap_start: state.lastYesYmd,
          full_name: resolveReportFullName(state.sampleRow),
          contact: maskPhoneForLog(resolved.phone),
          dispatch: sendDispatch,
          status: next.status,
        });
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-attendance-gap] row threw", {
        businessId,
        user_id: state.userId,
        tier,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  warnAbandonedCancellationSyncLog({
    businessId,
    abandoned: summary.abandoned,
    reason: "attendance_gap_send_failed_cap",
  });

  return summary;
}
