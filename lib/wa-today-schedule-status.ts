/**
 * "האם חדר הכושר פתוח או סגור היום" — לא שאלת ידע רגילה.
 *
 * סדר עדיפות:
 * 1) שעות פעילות (schedule_text) עם תאריך קונקרטי להיום (למשל 20.9 ערב כיפור)
 * 2) לעסקי ארבוקס — שיעורי היום מ־schedule_slots (יום־שבוע) לפני העברה לצוות
 */
import { filterConfiguredProductScheduleSlots, sortProductScheduleSlots } from "@/lib/product-schedule-slots";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import {
  formatIsraelDayMonth,
  getIsraelDayLetter,
  israelCalendarDatePlusDays,
  type IsraelDayLetter,
} from "@/lib/israel-time";

export const TODAY_SCHEDULE_FOUND_MODEL = "arbox_today_schedule_found";
export const TODAY_SCHEDULE_NOT_FOUND_MODEL = "arbox_today_schedule_not_found";
/** מענה דטרמיניסטי משעות פעילות לפי תאריך היום (חג/סגירה) — לפני Arbox לפי יום־שבוע. */
export const TODAY_OPENING_HOURS_FROM_SCHEDULE_TEXT_MODEL = "today_opening_hours_from_schedule_text";

export const TODAY_SCHEDULE_NOT_FOUND_REPLY =
  "אני כרגע לא רואה שיעורים במערכת, בכל מקרה אני מעבירה לצוות שיוכלו ליצור איתך קשר ולעדכן.";

const OPEN_TOKEN_RE = /פתוח(?:ה|ים|ות)?|\bopen\b/iu;
const CLOSED_TOKEN_RE = /סגור(?:ה|ים|ות)?|\bclosed\b/iu;
const TEMPORAL_RE = /היום|עכשיו|כרגע|כעת|\btoday\b|\bnow\b|\bcurrently\b/iu;
const QUESTION_MARKER_RE = /[?؟]|האם|אתם\s|\bare you\b|\bis (?:the|it)\b/iu;

const DAY_NAME: Record<IsraelDayLetter, string> = {
  א: "ראשון",
  ב: "שני",
  ג: "שלישי",
  ד: "רביעי",
  ה: "חמישי",
  ו: "שישי",
  ש: "שבת",
};

/** «אתם פתוחים היום?» / «חדר הכושר פתוח או סגור היום» — לא כל משפט עם «פתוח» (למשל מנוי פתוח). */
export function looksLikeBusinessOpenOrClosedTodayQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 300) return false;
  const hasOpen = OPEN_TOKEN_RE.test(t);
  const hasClosed = CLOSED_TOKEN_RE.test(t);
  if (!hasOpen && !hasClosed) return false;
  if (!QUESTION_MARKER_RE.test(t)) return false;
  return TEMPORAL_RE.test(t) || (hasOpen && hasClosed);
}

export type TodayScheduleClass = { time: string; className: string };

/**
 * וריאנטים של תאריך היום כפי שמופיעים בידע («20.9», «20/9», «20.09.2026»…).
 * מוגבלים בגבולות לא־ספרתיים כדי לא לתפוס 120.9 / 20.90.
 */
export function israelTodayDateMatchTokens(now: Date = new Date()): string[] {
  const cal = israelCalendarDatePlusDays(now, 0);
  const d = cal.day;
  const m = cal.month;
  const y = cal.year;
  const d2 = String(d).padStart(2, "0");
  const m2 = String(m).padStart(2, "0");
  return [
    `${d}.${m}`,
    `${d}/${m}`,
    `${d}-${m}`,
    `${d2}.${m}`,
    `${d2}/${m}`,
    `${d}.${m2}`,
    `${d}/${m2}`,
    `${d2}.${m2}`,
    `${d2}/${m2}`,
    `${d2}-${m2}`,
    `${d}.${m}.${y}`,
    `${d}/${m}/${y}`,
    `${d2}.${m2}.${y}`,
    `${d2}/${m2}/${y}`,
    formatIsraelDayMonth(m, d),
  ];
}

function lineMentionsIsraelTodayDate(line: string, tokens: string[]): boolean {
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^0-9])${escaped}(?:[^0-9]|$)`).test(line)) return true;
  }
  return false;
}

/**
 * שורות משעות פעילות שמזכירות את תאריך היום — חג/סגירה גוברות על שעות שבועיות.
 * null = אין התאמת תאריך בידע (לא אומר שאין שעות כלליות).
 */
export function extractScheduleTextForToday(
  scheduleText: string,
  now: Date = new Date()
): string | null {
  const raw = String(scheduleText ?? "").trim();
  if (!raw) return null;
  const tokens = israelTodayDateMatchTokens(now);
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const matched = lines.filter((line) => lineMentionsIsraelTodayDate(line, tokens));
  if (!matched.length) return null;
  return matched.join("\n");
}

export function buildTodayOpeningHoursFromScheduleTextReply(
  snippet: string,
  now: Date = new Date()
): string {
  const cal = israelCalendarDatePlusDays(now, 0);
  const name = DAY_NAME[cal.letter];
  const dateLabel = formatIsraelDayMonth(cal.month, cal.day);
  const body = String(snippet ?? "").trim();
  return `היום (${name} ${dateLabel}):\n${body}`;
}

/**
 * שאלה «פתוחים היום» + שעות פעילות עם תאריך היום → מענה דטרמיניסטי.
 * בלי התאמת תאריך → null (Claude / Arbox לפי יום־שבוע).
 */
export function tryBuildTodayOpeningHoursFromScheduleText(input: {
  text: string;
  scheduleText: string | null | undefined;
  now?: Date;
}): { text: string; modelUsed: string } | null {
  if (!looksLikeBusinessOpenOrClosedTodayQuestion(input.text)) return null;
  const now = input.now ?? new Date();
  const snippet = extractScheduleTextForToday(input.scheduleText ?? "", now);
  if (!snippet) return null;
  return {
    text: buildTodayOpeningHoursFromScheduleTextReply(snippet, now),
    modelUsed: TODAY_OPENING_HOURS_FROM_SCHEDULE_TEXT_MODEL,
  };
}

/** שיעורי היום מתוך מערכת השעות (schedule_slots) — לפי שעון ישראל. */
export function resolveTodayScheduleClasses(
  services: SfServiceRow[],
  now: Date = new Date()
): TodayScheduleClass[] {
  const today = getIsraelDayLetter(now);
  const out: TodayScheduleClass[] = [];
  const seen = new Set<string>();
  for (const service of services ?? []) {
    const className = String(service.name ?? "").trim();
    if (!className) continue;
    const slots = sortProductScheduleSlots(filterConfiguredProductScheduleSlots(service.scheduleSlots ?? []));
    for (const slot of slots) {
      if (String(slot.day ?? "").trim() !== today) continue;
      const key = `${slot.time}__${className}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ time: slot.time, className });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.className.localeCompare(b.className));
}

export function buildTodayScheduleFoundReply(classes: TodayScheduleClass[]): string {
  const lines = classes.map((c) => `${c.time} | ${c.className}`);
  return ["אני רואה שיש שיעורים במערכת!", "שעה | שם השיעור", ...lines].join("\n");
}
