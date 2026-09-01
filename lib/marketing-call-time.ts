import { toPipelineDateOnly, toPipelineTime } from "@/lib/marketing-next-call";

const HEBREW_WEEKDAY: Record<string, number> = {
  ראשון: 0,
  א: 0,
  שני: 1,
  ב: 1,
  שלישי: 2,
  ג: 2,
  רביעי: 3,
  ד: 3,
  חמישי: 4,
  ה: 4,
  שישי: 5,
  ו: 5,
  שבת: 6,
  ז: 6,
};

export type ParsedMarketingCallSlot = {
  dateYmd: string | null;
  timeHm: string;
  hasDate: boolean;
};

export function israelCalendarYmd(now: Date = new Date()): string {
  return israelYmd(now);
}

function israelYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function israelHm(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = (parts.find((p) => p.type === "hour")?.value ?? "00").padStart(2, "0");
  const minute = (parts.find((p) => p.type === "minute")?.value ?? "00").padStart(2, "0");
  return `${hour}:${minute}`;
}

function israelWeekday(now: Date): number {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[day] ?? 0;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + days);
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Convert a civil date+time in Asia/Jerusalem to a UTC Date.
 */
export function israelWallTimeToUtc(ymd: string, hm: string): Date {
  const date = toPipelineDateOnly(ymd);
  const time = toPipelineTime(hm) ?? "08:00";
  if (!date) return new Date(NaN);
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const gotY = Number(parts.find((p) => p.type === "year")?.value);
  const gotM = Number(parts.find((p) => p.type === "month")?.value);
  const gotD = Number(parts.find((p) => p.type === "day")?.value);
  const gotH = Number(parts.find((p) => p.type === "hour")?.value);
  const gotMin = Number(parts.find((p) => p.type === "minute")?.value);
  const gotUtc = Date.UTC(gotY, gotM - 1, gotD, gotH, gotMin, 0);
  return new Date(guess - (gotUtc - guess));
}

export type CallDayDueResult =
  | { kind: "schedule"; at: Date; sendYmd: string }
  | { kind: "send_now"; at: Date; sendYmd: string }
  | { kind: "skip_past"; sendYmd: string }
  | { kind: "invalid" };

export function callDaySendYmd(input: {
  dateYmd: string;
  delayDays: number;
  delayDirection: string;
}): string | null {
  const date = toPipelineDateOnly(input.dateYmd);
  if (!date) return null;
  const days = Math.max(0, Math.trunc(Number(input.delayDays) || 0));
  const before = String(input.delayDirection ?? "after").trim().toLowerCase() === "before";
  return addDaysYmd(date, before ? -days : days);
}

/**
 * Send time for a call_day trigger: 08:00 Israel on (call date ± delay_days).
 * Never collapses a different calendar day into "send now" — that was sending
 * reminders to leads whose meeting is not today.
 */
export function resolveCallDayDue(input: {
  dateYmd: string;
  timeHm?: string | null;
  delayDays: number;
  delayDirection: string;
  now?: Date;
  morningHour?: number;
}): CallDayDueResult {
  const sendYmd = callDaySendYmd(input);
  if (!sendYmd) return { kind: "invalid" };
  const now = input.now ?? new Date();
  const today = israelYmd(now);
  if (sendYmd < today) return { kind: "skip_past", sendYmd };
  const hour = Math.min(23, Math.max(0, Math.trunc(input.morningHour ?? 8)));
  const due = israelWallTimeToUtc(sendYmd, `${String(hour).padStart(2, "0")}:00`);
  if (!Number.isFinite(due.getTime())) return { kind: "invalid" };
  if (sendYmd === today && due.getTime() <= now.getTime()) {
    return { kind: "send_now", at: now, sendYmd };
  }
  return { kind: "schedule", at: due, sendYmd };
}

/** @returns due Date, or null to skip (past day / invalid). */
export function computeCallDayDueAt(input: {
  dateYmd: string;
  timeHm?: string | null;
  delayDays: number;
  delayDirection: string;
  now?: Date;
  morningHour?: number;
}): Date | null {
  const resolved = resolveCallDayDue(input);
  if (resolved.kind === "schedule" || resolved.kind === "send_now") return resolved.at;
  return null;
}

function extractTimeHm(text: string): string | null {
  for (const m of text.matchAll(/(\d{1,2})[:.](\d{2})/g)) {
    const parsed = toPipelineTime(`${m[1]}:${m[2]}`);
    if (parsed) return parsed;
  }
  return null;
}

function extractAbsoluteDate(text: string, todayYmd: string): string | null {
  const full = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (full) {
    const day = String(Number(full[1])).padStart(2, "0");
    const month = String(Number(full[2])).padStart(2, "0");
    let year = Number(full[3]);
    if (year < 100) year += 2000;
    return toPipelineDateOnly(`${year}-${month}-${day}`);
  }
  const short = text.match(/(\d{1,2})[./](\d{1,2})(?!\d)/);
  if (short) {
    const day = String(Number(short[1])).padStart(2, "0");
    const month = String(Number(short[2])).padStart(2, "0");
    const year = Number(todayYmd.slice(0, 4));
    let ymd = toPipelineDateOnly(`${year}-${month}-${day}`);
    if (ymd && ymd < todayYmd) {
      ymd = toPipelineDateOnly(`${year + 1}-${month}-${day}`);
    }
    return ymd;
  }
  return null;
}

function extractWeekdayOffset(text: string, todayWeekday: number): number | null {
  const cleaned = text.replace(/יום\s+/g, " ").replace(/\s+/g, " ");
  for (const [label, weekday] of Object.entries(HEBREW_WEEKDAY)) {
    if (label.length === 1) {
      const re = new RegExp(`(?:^|\\s)${label}(?:\\s|$)`);
      if (!re.test(cleaned) && !text.includes(`יום ${label}`)) continue;
    } else if (!text.includes(label)) {
      continue;
    }
    let delta = (weekday - todayWeekday + 7) % 7;
    if (delta === 0) delta = 0;
    return delta;
  }
  return null;
}

function resolveDateFromCallText(text: string, now: Date): string | null {
  const todayYmd = israelYmd(now);
  const todayWeekday = israelWeekday(now);
  const nowHm = israelHm(now);
  const timeHm = extractTimeHm(text);

  const absolute = extractAbsoluteDate(text, todayYmd);
  if (absolute) return absolute;

  if (text.includes("מחרתיים")) return addDaysYmd(todayYmd, 2);
  if (text.includes("מחר")) return addDaysYmd(todayYmd, 1);
  if (text.includes("היום")) return todayYmd;

  const weekdayDelta = extractWeekdayOffset(text, todayWeekday);
  if (weekdayDelta != null) {
    if (weekdayDelta === 0 && timeHm && timeHm <= nowHm) {
      return addDaysYmd(todayYmd, 7);
    }
    return addDaysYmd(todayYmd, weekdayDelta);
  }
  return null;
}

/** Day-only answers like «רביעי» / «מחר» / «03.09» — no time required. */
export function parseMarketingCallDay(answerText: string, now: Date = new Date()): string | null {
  const text = String(answerText ?? "").trim();
  if (!text) return null;
  return resolveDateFromCallText(text, now);
}

/**
 * Parse a marketing-flow answer like "מחר 18:00" / "ראשון 10:00" into a date+time.
 * Time-only answers («10:00») do not assume today — the caller must attach a known date.
 */
export function parseMarketingCallSlot(
  answerText: string,
  now: Date = new Date()
): ParsedMarketingCallSlot | null {
  const text = String(answerText ?? "").trim();
  if (!text) return null;
  const timeHm = extractTimeHm(text);
  if (!timeHm) return null;

  const dateYmd = resolveDateFromCallText(text, now);
  if (dateYmd) return { dateYmd, timeHm, hasDate: true };
  return { dateYmd: null, timeHm, hasDate: false };
}
