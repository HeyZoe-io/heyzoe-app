/**
 * לינק הרשמה לפי שיעור שזוהה מיום+שעה / שם — לא לינק מערכת שעות.
 */

import type { SfServiceRow } from "@/lib/sf-service-rows";
import { isJoinSignupIntentText } from "@/lib/wa-warmup-skip-intent";
import {
  matchCatalogServiceByDayAndTime,
  matchCatalogServiceFromFreeText,
  matchCatalogServiceSlotByDayAndTime,
  parseRequestedClassDays,
  type DayLetter,
} from "@/lib/wa-unknown-class-slot";
import { matchesTryClassIntent } from "@/lib/wa-try-class-offer";
import { normalizeTrialSignupIntentText } from "@/lib/wa-trial-signup-intent";
import { matchesUnspecifiedClassPriceQuestion } from "@/lib/wa-price-which-service";

export const REGISTRATION_CTA_LINK_MODEL = "registration_cta_class_link";
export const REGISTRATION_CTA_ASK_CLASS_MODEL = "registration_cta_ask_class";
export const REGISTRATION_CTA_FULL_MODEL = "registration_cta_class_full";
export const REGISTRATION_CTA_CANCELLED_MODEL = "registration_cta_class_cancelled";

/** Display name + time, never arbox_class_name — the lead never sees the Arbox join key. */
export function formatServiceAndTime(displayName: string, time: string): string {
  return `${displayName} ב-${time}`;
}

export function classFullNotice(serviceAndTime: string): string {
  return `כרגע אני רואה שהשיעור ${serviceAndTime} מלא במערכת, אבל אני לא תמיד מעודכנת 100%, אפשר לבדוק באפליקציה ואני גם אעביר את הפניה לצוות סבבה?`;
}

export function classCancelledNotice(serviceAndTime: string): string {
  return `רגע, אני רואה שהמפגש של ${serviceAndTime} לא מתקיים השבוע. השיעור עצמו קבוע במערכת, אז סביר שהוא חוזר בשבוע הבא - אני מעבירה את הפנייה לצוות שיעדכן אותך בדיוק, בסדר?`;
}

export type CtaOccurrenceOutcome = "notice_full" | "notice_cancelled" | "send_link";

/**
 * Maps a raw occurrence-check result to the final CTA action. "open" and "unknown" — and a
 * check that was never attempted (state === null, e.g. no concrete day/time, no stamp, no
 * Arbox context) — all resolve to "send_link": suppress only on positive evidence.
 */
export function resolveCtaOccurrenceOutcome(
  state: "open" | "full" | "cancelled" | "unknown" | null,
  opts?: { ignoreFull?: boolean }
): CtaOccurrenceOutcome {
  if (state === "cancelled") return "notice_cancelled";
  if (state === "full" && !opts?.ignoreFull) return "notice_full";
  return "send_link";
}

const SKIP_PHASES = new Set([
  "branch_pick",
  "schedule_date",
  "schedule_time",
  "call_schedule_day",
  "call_schedule_time",
  "registered",
]);

export type RegistrationCtaDecision =
  /** day/time are set only when the lead named an unambiguous concrete slot ("tomorrow at
   * 8") — a generic "I want to register" with no day/time mentioned leaves them unset, and
   * callers must not attempt an occurrence check in that case (nothing to check). */
  | { action: "send_link"; serviceName: string; day?: DayLetter; time?: string }
  | { action: "ask_class" }
  | { action: "none" };

export function shouldLookupRegistrationCta(currentText: string): boolean {
  const t = String(currentText ?? "").trim();
  if (!t) return false;
  if (isJoinSignupIntentText(t)) return true;
  if (looksLikeTrialVisitIntent(t)) return true;
  if (parseRequestedClassDays(t).length > 0) return true;
  if (/\b(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/i.test(t)) return true;
  if (/(?:[01]?\d|2[0-3]):[0-5]\d/.test(t)) return true;
  return false;
}

export function conversationBlobForRegistrationCta(
  currentText: string,
  recentUserTexts: string[]
): string {
  const parts: string[] = [];
  const push = (raw: string) => {
    const t = String(raw ?? "").trim();
    if (!t) return;
    if (parts.length && parts[parts.length - 1] === t) return;
    parts.push(t);
  };
  for (const row of recentUserTexts) push(row);
  push(currentText);
  return parts.slice(-6).join("\n");
}

/**
 * שאלה או בירור — לא התחייבות להרשמה.
 * «איך נרשמים» נשאר הרשמה כי isJoinSignupIntentText תופס אותו לפני הקריאה לכאן.
 */
export function inboundAsksInsteadOfRegistering(raw: string): boolean {
  const original = String(raw ?? "");
  const t = normalizeTrialSignupIntentText(original);
  if (!t) return false;
  if (/[?؟]/.test(original)) return true;
  if (
    /(?:^|\s)(?:what|how much|how many|is there|can i|can we|do you|does it|could i|before (?:i |we )?(?:sign|regist))\b/i.test(
      t
    )
  ) {
    return true;
  }
  return /(?:^|\s)(?:מה|כמה|האם|למה|איפה|איזה|איזו|מתי|לברר|לא\s+ברור|יש\s+אפשרות|לפני\s+(?:ש)?נרשמ|לפני\s+הרישום)(?:\s|$)/u.test(
    t
  );
}

function namesConcreteSlot(raw: string): boolean {
  if (parseRequestedClassDays(raw).length > 0) return true;
  if (/(?:[01]?\d|2[0-3]):[0-5]\d/.test(raw)) return true;
  if (/\b(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/i.test(raw)) return true;
  const t = normalizeTrialSignupIntentText(raw);
  return /(?:^|\s)(?:מחר|היום|tomorrow|today)(?:\s|$)/iu.test(t);
}

function hasClockTime(raw: string): boolean {
  return (
    /(?:[01]?\d|2[0-3]):[0-5]\d/.test(raw) ||
    /\b(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/i.test(raw)
  );
}

/** «רביעי 16:45» / «At the 8am class» — אישור מועד, לא פסקה שמזכירה יום. */
function isBareSlotConfirmation(raw: string): boolean {
  const t = normalizeTrialSignupIntentText(raw);
  if (!t || t.length > 60) return false;
  if (inboundAsksInsteadOfRegistering(raw)) return false;
  if (!namesConcreteSlot(raw)) return false;
  let rest = ` ${t} `;
  rest = rest.replace(
    /\b(?:at|the|a|an|class|in|on|for|to|tomorrow|today|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,
    " "
  );
  rest = rest.replace(
    /(?:^|\s)(?:ביום|יום|בשעה|שעה|מחר|היום|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|ב|ל|את|השיעור|שיעור|אימון)(?=\s|$)/gu,
    " "
  );
  rest = rest.replace(/(?:^|\s)ב?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?=\s|$)/gu, " ");
  rest = rest.replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g, " ");
  rest = rest.replace(/\b(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm)\b/gi, " ");
  rest = rest.replace(/[\s:.,-]+/g, " ").trim();
  return rest.length === 0;
}

/**
 * הודעה נוכחית שמקדמת הרשמה. היסטוריה יכולה לזהות איזה שיעור,
 * אבל לא מספיקה לבד כדי לשלוח לינק.
 */
function currentTurnAdvancesRegistration(current: string): boolean {
  if (isJoinSignupIntentText(current)) return true;
  if (inboundAsksInsteadOfRegistering(current)) return false;
  if (isBareSlotConfirmation(current)) return true;
  return looksLikeTrialVisitIntent(current) && hasClockTime(current);
}

function registrationLinkAlreadySent(serviceName: string, input: {
  services: SfServiceRow[];
  recentAssistantTexts?: string[];
}): boolean {
  const url = input.services.find((s) => s.name === serviceName)?.paymentLink?.trim() ?? "";
  if (!url) return false;
  return (input.recentAssistantTexts ?? []).some((text) => text.includes(url));
}

/** «come in tomorrow for a trial» / ניסיון / הרשמה — בלי שאלת לוח. */
export function looksLikeTrialVisitIntent(raw: string): boolean {
  const t = normalizeTrialSignupIntentText(raw);
  if (!t) return false;
  if (isJoinSignupIntentText(raw)) return true;
  if (matchesTryClassIntent(raw)) return true;
  if (/(?:come in|come)\b.{0,80}\btrial\b/u.test(t)) return true;
  if (/\bfor a trial(?:\s+class)?\b/u.test(t)) return true;
  if (/(?:שיעור|אימון)\s+(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)) return true;
  if (/(?:להירשם|להרשם|להצטרף)/u.test(t)) return true;
  return false;
}

function resolveMatchedServiceName(input: {
  currentText: string;
  blob: string;
  services: SfServiceRow[];
  committedServiceName?: string | null;
  now: Date;
}): string | null {
  const fromCurrentName = matchCatalogServiceFromFreeText(input.currentText, input.services);
  if (fromCurrentName) return fromCurrentName;
  const fromBlobName = matchCatalogServiceFromFreeText(input.blob, input.services);
  if (fromBlobName) return fromBlobName;
  const fromSlot = matchCatalogServiceByDayAndTime(input.blob, input.services, input.now);
  if (fromSlot) return fromSlot;
  const committed = String(input.committedServiceName ?? "").trim();
  if (committed && input.services.some((s) => s.name === committed)) return committed;
  return null;
}

/**
 * כשרוצים להירשם: לינק של השיעור שזוהה (מחר ב-8 = Power&HIIT).
 * אם אין שיעור חד-משמעי — לשאול באיזה שיעור, לא לשלוח מערכת שעות.
 */
export function resolveRegistrationCtaDecision(input: {
  currentText: string;
  recentUserTexts: string[];
  services: SfServiceRow[];
  committedServiceName?: string | null;
  sessionPhase?: string | null;
  trialRegistered?: boolean | null;
  now?: Date;
  /** תשובות זואי אחרונות — אותו לינק לא נשלח שוב בלי בקשת הרשמה מפורשת. */
  recentAssistantTexts?: string[];
}): RegistrationCtaDecision {
  const phase = String(input.sessionPhase ?? "").trim();
  if (SKIP_PHASES.has(phase)) return { action: "none" };
  if (input.trialRegistered === true) return { action: "none" };
  if (!input.services.length) return { action: "none" };

  const current = String(input.currentText ?? "").trim();
  if (!current || current.length > 500) return { action: "none" };
  if (matchesUnspecifiedClassPriceQuestion(current)) return { action: "none" };

  const blob = conversationBlobForRegistrationCta(current, input.recentUserTexts);
  const registerAsk = isJoinSignupIntentText(current);
  const now = input.now ?? new Date();
  const uniqueSlot = matchCatalogServiceByDayAndTime(blob, input.services, now);
  const matched = resolveMatchedServiceName({
    currentText: current,
    blob,
    services: input.services,
    committedServiceName: registerAsk ? input.committedServiceName : uniqueSlot ? input.committedServiceName : null,
    now,
  });

  const advances = currentTurnAdvancesRegistration(current);
  const canSend = Boolean(matched) && advances && (registerAsk || Boolean(uniqueSlot));

  if (canSend && matched && !registerAsk && registrationLinkAlreadySent(matched, input)) {
    return { action: "none" };
  }

  if (canSend && matched) {
    const matchedSlot = matchCatalogServiceSlotByDayAndTime(blob, input.services, input.now ?? new Date());
    if (matchedSlot && matchedSlot.serviceName === matched) {
      return { action: "send_link", serviceName: matched, day: matchedSlot.day, time: matchedSlot.time };
    }
    return { action: "send_link", serviceName: matched };
  }
  if (registerAsk && input.services.length > 1) return { action: "ask_class" };
  if (registerAsk && input.services.length === 1) {
    return { action: "send_link", serviceName: input.services[0]!.name };
  }
  return { action: "none" };
}
