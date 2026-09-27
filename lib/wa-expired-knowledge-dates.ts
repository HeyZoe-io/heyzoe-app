/**
 * ידע עם תאריך או טווח שכבר נגמר (למשל «בחופש 30.8-3.9» כשהיום 27.9)
 * לא נשלח למודל כמצב נוכחי, וגם לא נשאר בתשובה ללקוח אם המודל בכל זאת ציטט אותו.
 * בלי קריאות API. השוואה ללוח ישראל בלבד.
 */
import { israelCalendarDatePlusDays } from "@/lib/israel-time";

type Ymd = { y: number; m: number; d: number };

const URL_RE = /https?:\/\/\S+/gi;

const HEBREW_MONTHS: Record<string, number> = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

/** טווח `30.8-3.9` / `30/8–3/9` / עם שנה. */
const RANGE_RE =
  /(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s*[-–—]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/g;

/** «עד 3.9» / «עד ה-3.9» / «עד 3 בספטמבר». */
const UNTIL_NUMERIC_RE =
  /(?<![\p{L}\d])עד\s*(?:ה\s*-?\s*)?(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/gu;

const UNTIL_MONTH_NAME_RE =
  /(?<![\p{L}\d])עד\s*(?:ה\s*-?\s*)?(\d{1,2})\s+ב?(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/gu;

const POINT_RE = /(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/g;

const TEMP_STATUS_RE = /חופש|חופשה|סגור|סגיר|חג|לא\s*זמינ|לא\s*עובד|שבתון|לא\s*תהיה|לא\s*יהיה/u;

const INTERNAL_NOTE =
  "הוראה פנימית (לא לליד): פריט הידע הזה היה מוגבל בתאריך שכבר עבר. אל תאמרי שהוא עדיין בתוקף ואל תמציאי תאריך.";

type WindowHit = { start: number; end: number; expired: boolean; bounded: boolean };

function todayYmd(now: Date): Ymd {
  const cal = israelCalendarDatePlusDays(now, 0);
  return { y: cal.year, m: cal.month, d: cal.day };
}

function expandYear(year: number): number {
  return year >= 100 ? year : 2000 + year;
}

function cmpYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function validDay(month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(2024, month - 1, day));
  return dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function ordinal(ymd: Ymd): number {
  return Date.UTC(ymd.y, ymd.m - 1, ymd.d);
}

function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((ordinal(b) - ordinal(a)) / 86_400_000);
}

function placePoint(month: number, day: number, year: number | undefined, today: Ymd): Ymd | null {
  if (!validDay(month, day)) return null;
  if (year != null) return { y: expandYear(year), m: month, d: day };
  const thisYear: Ymd = { y: today.y, m: month, d: day };
  if (cmpYmd(thisYear, today) >= 0) return thisYear;
  const nextYear: Ymd = { y: today.y + 1, m: month, d: day };
  const daysPast = daysBetween(thisYear, today);
  const daysUntilNext = daysBetween(today, nextYear);
  // «עד 3.1» בדצמבר = ינואר הקרוב, לא ינואר שכבר עבר.
  if (daysPast > 90 && daysUntilNext <= 120) return nextYear;
  return thisYear;
}

function placeRange(
  start: { m: number; d: number; y?: number },
  end: { m: number; d: number; y?: number },
  today: Ymd
): { start: Ymd; end: Ymd } | null {
  if (!validDay(start.m, start.d) || !validDay(end.m, end.d)) return null;
  if (start.y != null && end.y != null) {
    return {
      start: { y: expandYear(start.y), m: start.m, d: start.d },
      end: { y: expandYear(end.y), m: end.m, d: end.d },
    };
  }
  const crosses = end.m * 100 + end.d < start.m * 100 + start.d;
  if (start.y != null) {
    const startY = expandYear(start.y);
    return {
      start: { y: startY, m: start.m, d: start.d },
      end: { y: crosses ? startY + 1 : startY, m: end.m, d: end.d },
    };
  }
  if (end.y != null) {
    const endY = expandYear(end.y);
    return {
      start: { y: crosses ? endY - 1 : endY, m: start.m, d: start.d },
      end: { y: endY, m: end.m, d: end.d },
    };
  }
  let best: { start: Ymd; end: Ymd } | null = null;
  let bestDist = Infinity;
  for (const startYear of [today.y - 1, today.y, today.y + 1]) {
    const endYear = crosses ? startYear + 1 : startYear;
    const s: Ymd = { y: startYear, m: start.m, d: start.d };
    const e: Ymd = { y: endYear, m: end.m, d: end.d };
    if (cmpYmd(e, s) < 0) continue;
    let dist = 0;
    if (cmpYmd(today, s) < 0) dist = daysBetween(today, s);
    else if (cmpYmd(today, e) > 0) dist = daysBetween(e, today);
    if (dist < bestDist) {
      bestDist = dist;
      best = { start: s, end: e };
    }
  }
  return best;
}

function overlaps(hits: WindowHit[], start: number, end: number): boolean {
  return hits.some((h) => start < h.end && end > h.start);
}

function pushHit(
  hits: WindowHit[],
  start: number,
  end: number,
  expired: boolean,
  bounded: boolean
) {
  if (overlaps(hits, start, end)) return;
  hits.push({ start, end, expired, bounded });
}

function findWindows(text: string, now: Date): WindowHit[] {
  const today = todayYmd(now);
  const hits: WindowHit[] = [];

  for (const match of text.matchAll(RANGE_RE)) {
    const placed = placeRange(
      { m: Number(match[2]), d: Number(match[1]), y: match[3] ? Number(match[3]) : undefined },
      { m: Number(match[5]), d: Number(match[4]), y: match[6] ? Number(match[6]) : undefined },
      today
    );
    if (!placed) continue;
    const index = match.index ?? 0;
    pushHit(hits, index, index + match[0].length, cmpYmd(placed.end, today) < 0, true);
  }

  for (const match of text.matchAll(UNTIL_NUMERIC_RE)) {
    const placed = placePoint(Number(match[2]), Number(match[1]), match[3] ? Number(match[3]) : undefined, today);
    if (!placed) continue;
    const index = match.index ?? 0;
    pushHit(hits, index, index + match[0].length, cmpYmd(placed, today) < 0, true);
  }

  for (const match of text.matchAll(UNTIL_MONTH_NAME_RE)) {
    const month = HEBREW_MONTHS[match[2] ?? ""];
    if (!month) continue;
    const placed = placePoint(month, Number(match[1]), undefined, today);
    if (!placed) continue;
    const index = match.index ?? 0;
    pushHit(hits, index, index + match[0].length, cmpYmd(placed, today) < 0, true);
  }

  for (const match of text.matchAll(POINT_RE)) {
    const placed = placePoint(Number(match[2]), Number(match[1]), match[3] ? Number(match[3]) : undefined, today);
    if (!placed) continue;
    const index = match.index ?? 0;
    pushHit(hits, index, index + match[0].length, cmpYmd(placed, today) < 0, false);
  }

  return hits;
}

function clauseIsExpired(clause: string, now: Date): boolean {
  const windows = findWindows(clause, now);
  if (!windows.length || !windows.every((w) => w.expired)) return false;
  if (windows.some((w) => w.bounded)) return true;
  return TEMP_STATUS_RE.test(clause);
}

function splitClauses(line: string): string[] {
  return line
    .split(/\s*(?:,|;|،)\s*|\s+אבל\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function annotateLine(line: string, now: Date): string {
  const trimmed = line.trim();
  if (!trimmed) return line;
  const clauses = splitClauses(trimmed);
  if (!clauses.length) return line;
  const kept = clauses.filter((clause) => !clauseIsExpired(clause, now));
  if (kept.length === clauses.length) return line;
  if (!kept.length) return "";
  const joiner = trimmed.includes(",") || trimmed.includes("،") || trimmed.includes(";") ? ", " : " ";
  return kept.join(joiner);
}

function maskUrls(text: string): { masked: string; restore: (value: string) => string } {
  const urls: string[] = [];
  const masked = text.replace(URL_RE, (url) => {
    const token = `\u0000U${urls.length}\u0000`;
    urls.push(url);
    return token;
  });
  return {
    masked,
    restore: (value) => value.replace(/\u0000U(\d+)\u0000/g, (_m, index: string) => urls[Number(index)] ?? ""),
  };
}

/**
 * מסיר מהידע משפטים שחלון התאריך שלהם נגמר לפני היום.
 * שאר המשפט (לינק, «שאר הצוות זמין») נשאר.
 */
export function annotateExpiredIsraelDates(text: string, now: Date = new Date()): string {
  const raw = String(text ?? "");
  if (!raw.trim()) return raw;
  const { masked, restore } = maskUrls(raw);
  const lines = masked.split("\n").map((line) => annotateLine(line, now));
  let out = lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!out) out = INTERNAL_NOTE;
  const restored = restore(out);
  return restored === raw.trim() ? raw : restored;
}

/**
 * אם המודל בכל זאת אמר «בחופש עד 3.9» אחרי שהתאריך עבר — המשפט הזה לא נשלח.
 * שאר התשובה (לינק לשיריון וכו') נשארת.
 */
export function stripExpiredDatedStatusFromReply(text: string, now: Date = new Date()): string {
  const raw = String(text ?? "").trim();
  if (!raw) return raw;
  const { masked, restore } = maskUrls(raw);
  let removed = false;
  const lines = masked.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (/הוראה פנימית/u.test(trimmed)) {
      removed = true;
      return "";
    }
    const clauses = splitClauses(trimmed);
    const kept = clauses.filter((clause) => {
      if (!clauseIsExpired(clause, now)) return true;
      removed = true;
      return false;
    });
    if (kept.length === clauses.length) return line;
    return kept.join(", ");
  });
  if (!removed) return raw;
  return restore(lines.filter((line) => line.trim()).join("\n"))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:אבל|אך)\s+/u, "")
    .trim();
}
