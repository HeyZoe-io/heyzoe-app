/**
 * "האם חדר הכושר פתוח או סגור היום" — לא שאלת ידע רגילה: לפני העברה גנרית לצוות,
 * לעסקי ארבוקס בודקים את מערכת השעות (schedule_slots מסונכרן) לשיעורי היום.
 */
import { filterConfiguredProductScheduleSlots, sortProductScheduleSlots } from "@/lib/product-schedule-slots";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { getIsraelDayLetter } from "@/lib/israel-time";

export const TODAY_SCHEDULE_FOUND_MODEL = "arbox_today_schedule_found";
export const TODAY_SCHEDULE_NOT_FOUND_MODEL = "arbox_today_schedule_not_found";

export const TODAY_SCHEDULE_NOT_FOUND_REPLY =
  "אני כרגע לא רואה שיעורים במערכת, בכל מקרה אני מעבירה לצוות שיוכלו ליצור איתך קשר ולעדכן.";

const OPEN_TOKEN_RE = /פתוח(?:ה|ים|ות)?|\bopen\b/iu;
const CLOSED_TOKEN_RE = /סגור(?:ה|ים|ות)?|\bclosed\b/iu;
const TEMPORAL_RE = /היום|עכשיו|כרגע|כעת|\btoday\b|\bnow\b|\bcurrently\b/iu;
const QUESTION_MARKER_RE = /[?؟]|האם|אתם\s|\bare you\b|\bis (?:the|it)\b/iu;

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
