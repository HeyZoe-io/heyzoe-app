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
import type { WaReplyAddressingMode } from "@/lib/wa-assistant-reply-fixes";
import {
  declinedClassDayLetters,
  looksLikeHolidayClassScheduleAsk,
  matchCatalogServicesFromFreeText,
  parseRequestedClassDays,
  parseRequestedTimes,
} from "@/lib/wa-unknown-class-slot";

export const LEAD_DAY_TRIAL_OFFER_MODEL = "lead_day_trial_offer";
export const LEAD_DAY_TRIAL_REASK_MODEL = "lead_day_trial_reask";
export const LEAD_DAY_TRIAL_HOLD_MODEL = "lead_day_trial_hold";
export const LEAD_DAY_TRIAL_REASK_HOLD_MODEL = "lead_day_trial_reask_hold";
export const LEAD_DAY_TRIAL_DECLINED_MODEL = "lead_day_trial_declined";

const LEAD_DAY_TRIAL_PENDING_MODELS = new Set([
  LEAD_DAY_TRIAL_OFFER_MODEL,
  LEAD_DAY_TRIAL_REASK_MODEL,
  LEAD_DAY_TRIAL_HOLD_MODEL,
  LEAD_DAY_TRIAL_REASK_HOLD_MODEL,
]);

export function isLeadDayTrialOfferPending(model: string | null | undefined): boolean {
  return LEAD_DAY_TRIAL_PENDING_MODELS.has(modelUsedBase(model));
}

export function leadDayTrialOfferAlreadyReasked(model: string | null | undefined): boolean {
  const base = modelUsedBase(model);
  return base === LEAD_DAY_TRIAL_REASK_MODEL || base === LEAD_DAY_TRIAL_REASK_HOLD_MODEL;
}

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

export type ExplicitClassSlot = {
  day: IsraelDayLetter;
  dayName: string;
  time: string;
  serviceName: string;
};

export type ExplicitClassChoice =
  | { kind: "none" }
  | { kind: "day_only"; day: IsraelDayLetter; dayName: string }
  | { kind: "unique"; slot: ExplicitClassSlot }
  | { kind: "ambiguous"; slots: ExplicitClassSlot[] }
  | { kind: "missing"; day: IsraelDayLetter | null; dayName: string; time: string | null; nearest: ExplicitClassSlot[] };

function slotTimeKey(raw: string): string {
  const match = String(raw ?? "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function looseServiceNames(text: string, services: readonly LeadDayTrialService[]): string[] {
  const catalog = matchCatalogServicesFromFreeText(text, services.map((service) => ({ name: service.name })));
  if (catalog.length) return catalog;
  const folded = String(text ?? "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!folded || folded.length > 40) return [];
  const hits = services.filter((service) => {
    const name = String(service.name ?? "")
      .toLowerCase()
      .replace(/&/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    return Boolean(name) && (folded === name || folded.includes(name));
  });
  return [...new Set(hits.map((service) => service.name))];
}

function allUpcomingSlots(services: readonly LeadDayTrialService[], now: Date): ExplicitClassSlot[] {
  const out: ExplicitClassSlot[] = [];
  for (const service of services) {
    const name = String(service.name ?? "").trim();
    if (!name) continue;
    const days = [...new Set((service.scheduleSlots ?? []).map((slot) => String(slot.day ?? "").trim()))];
    for (const day of days) {
      if (!day) continue;
      for (const slot of upcomingSlotsOnDay(service.scheduleSlots ?? [], day as IsraelDayLetter, now)) {
        const time = slotTimeKey(slot.time);
        if (!time) continue;
        out.push({
          day: day as IsraelDayLetter,
          dayName: formatDayNameForScheduleDatePlaceholder(day as IsraelDayLetter),
          time,
          serviceName: name,
        });
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((slot) => {
    const key = `${slot.day}|${slot.time}|${slot.serviceName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function minutesOf(time: string): number {
  const [hour, minute] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

/**
 * A named day+time and/or class, checked against the timetable.
 * A class-name reply can use the previous message for the day and time.
 */
export function resolveExplicitClassChoice(input: {
  text: string;
  services: readonly LeadDayTrialService[];
  now?: Date;
  priorText?: string | null;
}): ExplicitClassChoice {
  const now = input.now ?? new Date();
  const text = String(input.text ?? "").trim();
  const prior = String(input.priorText ?? "").trim();
  if (!text) return { kind: "none" };
  const names = looseServiceNames(text, input.services);
  const ownTimes = parseRequestedTimes(text).map(slotTimeKey).filter(Boolean);
  const ownDays = parseRequestedClassDays(text, now);
  const times = ownTimes.length ? ownTimes : names.length && prior ? parseRequestedTimes(prior).map(slotTimeKey).filter(Boolean) : [];
  const days = ownDays.length ? ownDays : names.length && prior ? parseRequestedClassDays(prior, now) : [];
  if (!names.length && !times.length) {
    if (days.length === 1 && /ניסיון|נסיון|שיעור|אימון/u.test(text)) {
      return { kind: "day_only", day: days[0]!, dayName: formatDayNameForScheduleDatePlaceholder(days[0]!) };
    }
    return { kind: "none" };
  }
  const pool = allUpcomingSlots(input.services, now).filter((slot) => {
    if (days.length && !days.includes(slot.day)) return false;
    if (names.length && !names.includes(slot.serviceName)) return false;
    if (times.length && !times.includes(slot.time)) return false;
    return true;
  });
  if (pool.length === 1) return { kind: "unique", slot: pool[0]! };
  if (pool.length > 1) return { kind: "ambiguous", slots: pool.slice(0, 4) };
  const day = days[0] ?? null;
  const nearest = allUpcomingSlots(input.services, now)
    .filter((slot) => !day || slot.day === day)
    .filter((slot) => !names.length || names.includes(slot.serviceName))
    .sort((a, b) => {
      const target = times[0] ? minutesOf(times[0]) : minutesOf(a.time);
      return Math.abs(minutesOf(a.time) - target) - Math.abs(minutesOf(b.time) - target);
    })
    .slice(0, 3);
  return {
    kind: "missing",
    day,
    dayName: day ? formatDayNameForScheduleDatePlaceholder(day) : "",
    time: times[0] ?? null,
    nearest,
  };
}

const CHOICE_OVERRIDE_ROUTES = new Set(["schedule", "signup", "booking_change", "booking_change_trial"]);
const CHOICE_BLOCKED_ROUTES = new Set(["class_move", "class_move_member", "class_move_trial", "personal"]);

function looksLikeClassCancel(text: string): boolean {
  return /לבטל|תבטל|לא אגיע|תורידו אותי|ביטול/u.test(text);
}

/** Naming a day or time to reject it is not a slot choice. */
function looksLikeSlotRejection(text: string): boolean {
  return /לא רוצה|לא מתאים|לא קבוע|זה לא|אין לי אף|אין לי שיעור/u.test(text);
}

/** A slot choice replaces Claude's text only when the route asked for a schedule or signup, or the message itself is a trial slot and not a cancellation. */
export function explicitClassChoiceApplies(input: {
  route: string | null;
  choice: ExplicitClassChoice;
  trialAsk: boolean;
  hintCategory?: string | null;
  text?: string;
}): boolean {
  if (input.route && CHOICE_BLOCKED_ROUTES.has(input.route)) return false;
  if (input.choice.kind !== "unique" && input.choice.kind !== "ambiguous" && input.choice.kind !== "missing") {
    return false;
  }
  const text = String(input.text ?? "");
  if (looksLikeClassCancel(text) || looksLikeSlotRejection(text)) return false;
  if (input.hintCategory === "trial_slot" || input.trialAsk) return true;
  return input.route != null && CHOICE_OVERRIDE_ROUTES.has(input.route);
}

export function explicitChoiceReply(input: {
  choice: ExplicitClassChoice;
  addressingMode?: WaReplyAddressingMode;
  hasTrialSignup: boolean;
}): { action: "confirm"; slot: ExplicitClassSlot } | { action: "text"; text: string } | { action: "none" } {
  const choice = input.choice;
  if (choice.kind === "none" || choice.kind === "day_only") return { action: "none" };
  if (choice.kind === "unique") {
    if (!input.hasTrialSignup) {
      const slot = choice.slot;
      return {
        action: "text",
        text: `תודה, הבקשה ל${slot.serviceName} ביום ${slot.dayName} ב-${slot.time} עוברת לצוות 💜`,
      };
    }
    return { action: "confirm", slot: choice.slot };
  }
  const join =
    input.addressingMode === "feminine"
      ? "תרצי אחד מהם?"
      : input.addressingMode === "plural"
        ? "מה מתאים לכם?"
        : "מה מתאים?";
  if (choice.kind === "ambiguous") {
    const sameTime = new Set(choice.slots.map((slot) => `${slot.day}|${slot.time}`)).size === 1;
    const first = choice.slots[0]!;
    const list = sameTime
      ? choice.slots.map((slot) => slot.serviceName).join(", ")
      : choice.slots.map((slot) => `${slot.time} ${slot.serviceName}`).join(", ");
    const when = sameTime ? `ביום ${first.dayName} ב-${first.time}` : `ביום ${first.dayName}`;
    return { action: "text", text: `${when} יש ${list}. ${join}` };
  }
  const when = [choice.dayName ? `ביום ${choice.dayName}` : "", choice.time ? `ב-${choice.time}` : ""]
    .filter(Boolean)
    .join(" ");
  const near = choice.nearest.map((slot) => `${slot.time} ${slot.serviceName}`).join(", ");
  const head = when ? `${when} אין אימון במועד הזה.` : "אין אימון במועד הזה.";
  return { action: "text", text: near ? `${head} קרוב לזה: ${near}. ${join}` : `${head} ${join}` };
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
