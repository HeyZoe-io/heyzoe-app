import { formatDateYmdIsrael } from "@/lib/leads/arbox-trial-attended";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";

/** Israel weekday: 0=Sunday … 6=Saturday. */
export const MANUAL_BULK_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type ManualBulkWeekday = (typeof MANUAL_BULK_WEEKDAYS)[number];

export const MANUAL_BULK_WEEKDAY_LABELS_HE: Record<ManualBulkWeekday, string> = {
  0: "ראשון",
  1: "שני",
  2: "שלישי",
  3: "רביעי",
  4: "חמישי",
  5: "שישי",
  6: "שבת",
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const TIME_LOCAL_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export function parseManualBulkWeekday(raw: unknown): ManualBulkWeekday | "invalid" {
  if (raw === null || raw === undefined || raw === "") return "invalid";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 6) return "invalid";
  return n as ManualBulkWeekday;
}

export function isManualBulkWeekday(raw: unknown): raw is ManualBulkWeekday {
  return parseManualBulkWeekday(raw) !== "invalid";
}

export function parseManualBulkTimeLocal(raw: unknown): string | "invalid" {
  const s = String(raw ?? "").trim();
  const m = TIME_LOCAL_RE.exec(s);
  if (!m) return "invalid";
  return `${m[1]}:${m[2]}`;
}

export function israelWeekdaySunday0(d: Date): ManualBulkWeekday {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
  }).format(d);
  const i = WEEKDAY_SHORT.indexOf(short as (typeof WEEKDAY_SHORT)[number]);
  return (i >= 0 ? i : 0) as ManualBulkWeekday;
}

export function addDaysYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim());
  if (!m) return ymd;
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Next weekly slot at weekday+time Israel, strictly after `from` if that slot already passed. */
export function nextWeeklyRunAt(input: {
  weekday: ManualBulkWeekday;
  timeLocal: string;
  from: Date;
}): Date {
  const timeLocal = parseManualBulkTimeLocal(input.timeLocal);
  if (timeLocal === "invalid") return new Date(NaN);
  const ymd = formatDateYmdIsrael(input.from);
  const todayWd = israelWeekdaySunday0(input.from);
  let daysAhead = (input.weekday - todayWd + 7) % 7;
  const todayAt = israelWallTimeToUtc(ymd, timeLocal);
  if (daysAhead === 0 && todayAt.getTime() <= input.from.getTime()) {
    daysAhead = 7;
  }
  if (daysAhead === 0) return todayAt;
  return israelWallTimeToUtc(addDaysYmd(ymd, daysAhead), timeLocal);
}

export function occurrenceYmdFromRunAt(runAt: Date): string {
  return formatDateYmdIsrael(runAt);
}

export function shouldMaterializeWeekly(input: {
  enabled: boolean;
  nextRunAt: Date;
  now: Date;
}): boolean {
  if (!input.enabled) return false;
  if (!Number.isFinite(input.nextRunAt.getTime())) return false;
  return input.nextRunAt.getTime() <= input.now.getTime();
}

/** After firing `lastOccurrenceAt`, jump to the next future weekly slot (no backfill). */
export function advanceWeeklyNextRunAt(input: {
  weekday: ManualBulkWeekday;
  timeLocal: string;
  now: Date;
  lastOccurrenceAt: Date;
}): Date {
  const afterMs = Math.max(input.now.getTime(), input.lastOccurrenceAt.getTime()) + 1000;
  return nextWeeklyRunAt({
    weekday: input.weekday,
    timeLocal: input.timeLocal,
    from: new Date(afterMs),
  });
}

/**
 * Recurring occurrences must not use the forever send_log skip.
 * One-off M1 still skips anyone who already received this template.
 */
export function applyAlreadySentSkip(input: {
  skipAlreadySentLog: boolean;
  recipientKey: string;
  alreadySent: ReadonlySet<string>;
}): "keep" | "skip" {
  if (input.skipAlreadySentLog) return "keep";
  return input.alreadySent.has(input.recipientKey) ? "skip" : "keep";
}

/** Open-week jobs canceled when the owner disables a weekly schedule. */
export const MANUAL_BULK_OPEN_JOB_STATUSES = ["queued", "sending"] as const;

export function isOpenManualBulkJobStatus(status: string): boolean {
  return status === "queued" || status === "sending";
}
