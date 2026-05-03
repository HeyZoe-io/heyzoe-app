const IL_TZ = "Asia/Jerusalem";

function weekdayIndexFromShortEn(w: string): number {
  // 0=Sun ... 6=Sat
  switch (w) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    default:
      return 0;
  }
}

function getOffsetMinutesInTz(dateUtc: Date, timeZone: string): number {
  // Uses Intl shortOffset (e.g., "GMT+3")
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(dateUtc);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2] ?? "0");
  const mm = Number(m[3] ?? "0");
  return sign * (hh * 60 + mm);
}

function getLocalPartsInTz(dateUtc: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(dateUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = weekdayIndexFromShortEn(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday,
  };
}

function makeUtcDateFromLocalInTz(input: { year: number; month: number; day: number; hour: number; minute: number }) {
  // First guess: treat local wall time as UTC, then subtract offset for that instant.
  const guess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0));
  const offset = getOffsetMinutesInTz(guess, IL_TZ);
  return new Date(guess.getTime() - offset * 60_000);
}

/** תחילת חודש קלנדרי בישראל (00:00 Asia/Jerusalem) כמועד UTC */
export function getIsraelMonthStartUtc(referenceUtc: Date = new Date()): Date {
  const p = getLocalPartsInTz(referenceUtc, IL_TZ);
  return makeUtcDateFromLocalInTz({ year: p.year, month: p.month, day: 1, hour: 0, minute: 0 });
}

/** מפתח חודש ישראלי לדוגמה 2026-04 */
export function formatIsraelYearMonth(referenceUtc: Date = new Date()): string {
  const p = getLocalPartsInTz(referenceUtc, IL_TZ);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** יום בחודש בלוח ישראלי (1–31) — לאיפוס cron ודומה */
export function getIsraelCalendarDay(referenceUtc: Date = new Date()): number {
  const p = getLocalPartsInTz(referenceUtc, IL_TZ);
  return p.day;
}

export function isAllowedWhatsAppSendTimeIsrael(dateUtc: Date): boolean {
  const p = getLocalPartsInTz(dateUtc, IL_TZ);

  // Quiet hours: 23:00–06:30 (inclusive start, exclusive end)
  const minutes = p.hour * 60 + p.minute;
  const quietStart = 23 * 60;
  const quietEnd = 6 * 60 + 30;
  const inQuiet = minutes >= quietStart || minutes < quietEnd;
  if (inQuiet) return false;

  // Weekend block: Fri 16:00 → Sat 19:00 (Israel time)
  const isFri = p.weekday === 5;
  const isSat = p.weekday === 6;
  if (isFri && minutes >= 16 * 60) return false;
  if (isSat && minutes < 19 * 60) return false;

  return true;
}

export function nextAllowedWhatsAppSendTimeIsrael(dateUtc: Date): Date {
  if (isAllowedWhatsAppSendTimeIsrael(dateUtc)) return dateUtc;

  const p = getLocalPartsInTz(dateUtc, IL_TZ);
  const minutes = p.hour * 60 + p.minute;

  // Weekend block
  if (p.weekday === 5 && minutes >= 16 * 60) {
    // Friday after 16:00 → Saturday 19:00
    return makeUtcDateFromLocalInTz({ year: p.year, month: p.month, day: p.day + 1, hour: 19, minute: 0 });
  }
  if (p.weekday === 6 && minutes < 19 * 60) {
    // Saturday before 19:00 → Saturday 19:00
    return makeUtcDateFromLocalInTz({ year: p.year, month: p.month, day: p.day, hour: 19, minute: 0 });
  }

  // Quiet hours
  if (minutes >= 23 * 60) {
    // After 23:00 → next day 06:30
    return makeUtcDateFromLocalInTz({ year: p.year, month: p.month, day: p.day + 1, hour: 6, minute: 30 });
  }
  // Before 06:30 → same day 06:30
  return makeUtcDateFromLocalInTz({ year: p.year, month: p.month, day: p.day, hour: 6, minute: 30 });
}

