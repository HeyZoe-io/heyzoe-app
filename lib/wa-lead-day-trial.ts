/**
 * ליד (לא מנוי ידוע) שמבקשת שיעור ניסיון ביום מסוים —
 * מציגים את האימונים של היום, ואחרי שנשמר מוצר מאשרים רק את המועדים של היום הזה.
 */

import { hasWeeklySlotPassedToday, type IsraelDayLetter } from "@/lib/israel-time";
import {
  filterConfiguredProductScheduleSlots,
  formatDayNameForScheduleDatePlaceholder,
  sortProductScheduleSlots,
} from "@/lib/product-schedule-slots";
import { matchesBookedClassMoveIntent } from "@/lib/wa-registration-intent";
import { modelUsedBase } from "@/lib/wa-reply-route";
import {
  declinedClassDayLetters,
  looksLikeHolidayClassScheduleAsk,
  parseRequestedClassDays,
} from "@/lib/wa-unknown-class-slot";

export const LEAD_DAY_TRIAL_OFFER_MODEL = "lead_day_trial_offer";
export const LEAD_DAY_TRIAL_DECLINED_MODEL = "lead_day_trial_declined";

export const LEAD_DAY_TRIAL_JOIN_QUESTION = "תרצי להצטרף לאחד מהם?";
export const LEAD_DAY_TRIAL_DECLINE_REPLY = "סבבה. אם תרצי לשאול עוד משהו, אני כאן.";

const TRIAL_MENTION =
  /(?:שיעור(?:י)?|אימון(?:י)?|אימוני)\s*(?:ה)?(?:ני?סיון|(?:ה)?(?:י?כרות))/u;
const WANT_TO_COME =
  /אשמח|נשמח|רוצ(?:ה|ים|ה)|מעוניינ|להגיע|לבוא|להצטרף|לקבוע|לתאם|לשריין/u;
const PRICE_OR_INFO =
  /כמה\s+עולה|מה\s+(?:ה)?מחיר|מה\s+זה|איך\s+מגיעים|איפה\s+אתם/u;

const FLOW_RESTART_MODELS = new Set(["greeting", "default_opening"]);

export type LeadDayTrialService = {
  name: string;
  scheduleSlots?: readonly { day: string; time: string }[] | null;
};

export type LeadDayTrialFollowup = "yes" | "no";

function normalizeLeadDayTrialText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\s+/g, " ");
}

/** כן / לא קצר לשאלת «תרצי להצטרף לאחד מהם?». */
export function classifyLeadDayTrialFollowup(raw: string): LeadDayTrialFollowup | null {
  const t = normalizeLeadDayTrialText(raw)
    .replace(/[!.,?;:~'"`\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 40) return null;
  if (/^(?:לא|לא תודה|לא כרגע|לא צריך|לא עכשיו|לא בא לי|no|no thanks|not now)$/iu.test(t)) {
    return "no";
  }
  if (/^(?:כן|בטח|יאללה|אשמח|בואי|בוא|בואו|אוקיי?|ok|okay|yes|sure)(?:\s+(?:בבקשה|תודה|מאוד|יאללה))?$/iu.test(t)) {
    return "yes";
  }
  return null;
}

/**
 * יום אחד + שיעור ניסיון, רק כשאין מנוי ידוע ואין הרשמה שכבר נשמרה.
 * הזזה מפורשת של אימון קיים נשארת במסלול ההזזה.
 */
export function resolveLeadDayTrialAsk(input: {
  text: string;
  arboxIsMember?: boolean | null;
  trialRegistered?: boolean | null;
  now?: Date;
}): IsraelDayLetter | null {
  if (input.arboxIsMember === true) return null;
  if (input.trialRegistered === true) return null;
  const text = String(input.text ?? "").trim();
  if (!text || text.length > 500) return null;
  if (matchesBookedClassMoveIntent(text)) return null;
  if (looksLikeHolidayClassScheduleAsk(text)) return null;
  if (PRICE_OR_INFO.test(text)) return null;
  if (!TRIAL_MENTION.test(text) || !WANT_TO_COME.test(text)) return null;
  const now = input.now ?? new Date();
  const declined = new Set(declinedClassDayLetters(text, now));
  const days = parseRequestedClassDays(text, now).filter((day) => !declined.has(day));
  if (days.length !== 1) return null;
  return days[0] ?? null;
}

export function upcomingSlotsOnDay<T extends { day: string; time: string }>(
  slots: readonly T[],
  day: IsraelDayLetter,
  now: Date
): T[] {
  const configured = filterConfiguredProductScheduleSlots(slots);
  const sameDay = configured.filter((slot) => String(slot.day ?? "").trim() === day);
  return sortProductScheduleSlots(sameDay).filter((slot) => !hasWeeklySlotPassedToday(day, slot.time, now));
}

function dayClassLines(services: readonly LeadDayTrialService[], day: IsraelDayLetter, now: Date): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const service of services) {
    const name = String(service.name ?? "").trim();
    if (!name) continue;
    for (const slot of upcomingSlotsOnDay(service.scheduleSlots ?? [], day, now)) {
      const time = String(slot.time ?? "").trim();
      const key = `${time}|${name}`;
      if (!time || seen.has(key)) continue;
      seen.add(key);
      lines.push(`${time}, ${name}`);
    }
  }
  return lines.sort((a, b) => a.localeCompare(b, "en"));
}

export function buildLeadDayTrialOfferReply(input: {
  day: IsraelDayLetter;
  services: readonly LeadDayTrialService[];
  now?: Date;
  /** כשהמוצר שנשמר לא רץ ביום שביקשו. */
  missingServiceName?: string | null;
}): string | null {
  const now = input.now ?? new Date();
  const lines = dayClassLines(input.services, input.day, now);
  if (!lines.length) return null;
  const dayName = formatDayNameForScheduleDatePlaceholder(input.day);
  const head = `יש לנו ביום ${dayName}:\n${lines.join("\n")}`;
  const missing = String(input.missingServiceName ?? "").trim();
  const body = missing ? `ל${missing} אין אימון ביום ${dayName}.\n${head}` : head;
  return `${body}\n\n${LEAD_DAY_TRIAL_JOIN_QUESTION}`;
}

export function parseLeadDayTrialOfferDay(content: string): IsraelDayLetter | null {
  const match = String(content ?? "").match(
    /יש לנו ביום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/u
  );
  const name = match?.[1];
  if (!name) return null;
  const letter = (
    [
      ["ראשון", "א"],
      ["שני", "ב"],
      ["שלישי", "ג"],
      ["רביעי", "ד"],
      ["חמישי", "ה"],
      ["שישי", "ו"],
      ["שבת", "ש"],
    ] as const
  ).find(([label]) => label === name)?.[1];
  return letter ?? null;
}

/** ההצעה האחרונה עדיין פתוחה אם לא הייתה אחריה ברכה או סירוב. */
export function pendingLeadDayFromRecentMessages(
  rowsNewestFirst: readonly { role?: string | null; content?: string | null; model_used?: string | null }[]
): IsraelDayLetter | null {
  for (const row of rowsNewestFirst) {
    if (row.role != null && row.role !== "assistant") continue;
    const model = modelUsedBase(row.model_used);
    if (model === LEAD_DAY_TRIAL_DECLINED_MODEL || FLOW_RESTART_MODELS.has(model)) return null;
    if (model !== LEAD_DAY_TRIAL_OFFER_MODEL) continue;
    return parseLeadDayTrialOfferDay(String(row.content ?? ""));
  }
  return null;
}
