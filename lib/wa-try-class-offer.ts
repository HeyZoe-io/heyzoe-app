/**
 * Soft «אשמח לנסות» — ask before dumping product pick.
 * Hard signup («להירשם לשיעור ניסיון») still enters the flow immediately.
 */

import { detectMessageLanguage } from "@/lib/language-detect";
import { normalizeTrialSignupIntentText } from "@/lib/wa-trial-signup-intent";
import type { BusinessContentLanguage } from "@/lib/business-content-lang";

export const TRY_CLASS_OFFER_MODEL = "try_class_info_offer";
export const TRY_CLASS_OFFER_DECLINE_MODEL = "try_class_info_offer_decline";

export const TRY_CLASS_OFFER_QUESTION_HE =
  "בא לך שאשלח לך את מידע מסודר על השיעורים ומתי אפשר להגיע לשיעור ניסיון?";
export const TRY_CLASS_OFFER_QUESTION_EN =
  "Want me to send you organized info about the classes and when you can come to a trial class?";
export const TRY_CLASS_OFFER_QUESTION_RU =
  "Отправить вам удобную информацию о занятиях и когда можно прийти на пробное?";

export const TRY_CLASS_OFFER_YES_HE = "כן";
export const TRY_CLASS_OFFER_NO_HE = "לא תודה";
export const TRY_CLASS_OFFER_YES_EN = "Yes";
export const TRY_CLASS_OFFER_NO_EN = "Not now";
export const TRY_CLASS_OFFER_YES_RU = "Да";
export const TRY_CLASS_OFFER_NO_RU = "Не сейчас";

export const TRY_CLASS_OFFER_DECLINE_HE = "אין בעיה 🙂 אני כאן אם תרצו.";
export const TRY_CLASS_OFFER_DECLINE_EN = "No problem 🙂 I'm here if you'd like that later.";
export const TRY_CLASS_OFFER_DECLINE_RU = "Без проблем 🙂 Я здесь, если захотите.";

const PRICE_OR_WHAT_IS_OPENER = /^(?:כמה\s+עולה|מה\s+המחיר|מה\s+זה|what(?:'s| is) this|how much)/u;
const REPHRASE_TRAP = /לנסח|מהאפליקציה|מה\s+אפליקציה/u;
const CANCEL_TRAP = /לבטל|לבטל את/u;

/** Desire + «לנסות» (not registration, not FAQ). */
const DESIRE_TO_TRY_RE =
  /(?:אשמח|נשמח|רוצ(?:ה|ים)|אפשר|בא\s+לי|מעוניינ(?:ת|ים)|מתעניינ(?:ת|ים))\s+(?:מאוד\s+)?לנסות/u;

const TRY_A_CLASS_RE =
  /לנסות\s+(?:את\s+)?(?:ה)?(?:שיעור|אימון|יוגה|פילאטיס|היכרות|ניסיון|נסיון)/u;

const CAN_TRY_RE = /אפשר\s+לנסות/u;

const ENGLISH_TRY_RE =
  /(?:id like to|i would like to|want to|can i|wanna)\s+try(?:\s+(?:a\s+)?(?:class|lesson|yoga|pilates))?/iu;

const NEGATIVE_REPLY =
  /^(?:לא|לא תודה|לא כרגע|לא צריך|לא בא לי|no|not now|no thanks|нет|не сейчас|не надо)$/iu;

const AFFIRMATIVE_OPENER = /^(?:כן|בטח|יאללה|אוקיי?|ok|yes|sure|да|конечно)(?:$|\s)/iu;

export function tryClassInfoOfferQuestion(lang: BusinessContentLanguage): string {
  if (lang === "en") return TRY_CLASS_OFFER_QUESTION_EN;
  if (lang === "ru") return TRY_CLASS_OFFER_QUESTION_RU;
  return TRY_CLASS_OFFER_QUESTION_HE;
}

export function tryClassInfoOfferLabels(lang: BusinessContentLanguage): [string, string] {
  if (lang === "en") return [TRY_CLASS_OFFER_YES_EN, TRY_CLASS_OFFER_NO_EN];
  if (lang === "ru") return [TRY_CLASS_OFFER_YES_RU, TRY_CLASS_OFFER_NO_RU];
  return [TRY_CLASS_OFFER_YES_HE, TRY_CLASS_OFFER_NO_HE];
}

export function tryClassInfoOfferDeclineReply(lang: BusinessContentLanguage): string {
  if (lang === "en") return TRY_CLASS_OFFER_DECLINE_EN;
  if (lang === "ru") return TRY_CLASS_OFFER_DECLINE_RU;
  return TRY_CLASS_OFFER_DECLINE_HE;
}

export function resolveTryClassOfferLang(
  inbound: string,
  businessLang: BusinessContentLanguage
): BusinessContentLanguage {
  const detected = detectMessageLanguage(inbound);
  if (detected === "en") return "en";
  if (detected === "he") return "he";
  if (detected === "ru") return "ru";
  return businessLang;
}

/**
 * Hint of wanting to come try a class — «אפשר לנסות שיעור יוגה», «אשמח לנסות».
 * Does not include hard signup («להירשם») or price/what-is questions.
 */
export function matchesTryClassIntent(raw: string): boolean {
  const s = normalizeTrialSignupIntentText(raw);
  if (!s) return false;
  if (PRICE_OR_WHAT_IS_OPENER.test(s)) return false;
  if (REPHRASE_TRAP.test(s)) return false;
  if (CANCEL_TRAP.test(s)) return false;
  if (DESIRE_TO_TRY_RE.test(s)) return true;
  if (TRY_A_CLASS_RE.test(s)) return true;
  if (CAN_TRY_RE.test(s)) return true;
  if (ENGLISH_TRY_RE.test(s)) return true;
  return false;
}

export function isTryClassOfferAffirmative(raw: string): boolean {
  const t = normalizeTrialSignupIntentText(raw);
  if (!t) return false;
  if (isTryClassOfferNegative(raw)) return false;
  if (AFFIRMATIVE_OPENER.test(t)) return true;
  if (matchesTryClassIntent(raw)) return true;
  return false;
}

export function isTryClassOfferNegative(raw: string): boolean {
  const t = normalizeTrialSignupIntentText(raw);
  if (!t || t.length > 80) return false;
  return NEGATIVE_REPLY.test(t);
}

/** Out of flow: send the organized-info question instead of Claude inventing times. */
export function shouldSendTryClassInfoOffer(input: {
  inbound: string;
  salesFlowStarted: boolean;
  trialRegistered?: boolean | null;
  sessionPhase?: string | null;
}): boolean {
  if (input.salesFlowStarted) return false;
  if (input.trialRegistered === true) return false;
  if (input.sessionPhase === "registered") return false;
  return matchesTryClassIntent(input.inbound);
}

/** Last Zoe turn was the offer, and the lead said yes / repeated try-intent. */
export function shouldStartProductPickAfterTryClassOffer(input: {
  inbound: string;
  lastAssistantModel: string | null | undefined;
}): boolean {
  if (input.lastAssistantModel !== TRY_CLASS_OFFER_MODEL) return false;
  if (isTryClassOfferNegative(input.inbound)) return false;
  return isTryClassOfferAffirmative(input.inbound);
}

export function shouldDeclineTryClassOffer(input: {
  inbound: string;
  lastAssistantModel: string | null | undefined;
}): boolean {
  if (input.lastAssistantModel !== TRY_CLASS_OFFER_MODEL) return false;
  return isTryClassOfferNegative(input.inbound);
}
