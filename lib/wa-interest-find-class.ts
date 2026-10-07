/**
 * לידה חדשה עם שאלה מעבר ל«אשמח לשמוע על האימונים»:
 * עונים על השאלה, שואלים אם למצוא שיעור, ופותחים פלואו רק אחרי אישור.
 */

import type { BusinessContentLanguage } from "@/lib/business-content-lang";
import { detectMessageLanguage } from "@/lib/language-detect";
import {
  isSalesFlowStartTrigger,
  normalizeSalesFlowGreetingToken,
  stripLeadingCasualGreeting,
} from "@/lib/sales-flow-start-triggers";
import { isAddressOrDirectionsIntent } from "@/lib/wa-address-intent";
import { modelUsedBase } from "@/lib/wa-reply-route";
import {
  stripSalesFlowCtaHookFromAnswer,
  stripTrailingFollowUpQuestion,
} from "@/lib/wa-split-answer";
import { isJoinSignupIntentText } from "@/lib/wa-warmup-skip-intent";

export const FIND_CLASS_ASK_MODEL = "interest_answer_find_class_ask";
export const FIND_CLASS_DECLINE_MODEL = "interest_find_class_declined";

export const FIND_CLASS_BRIDGE_HE = "רוצה שנמצא את השיעור המתאים עבורך?";
export const FIND_CLASS_BRIDGE_EN = "Want us to find the right class for you?";
export const FIND_CLASS_BRIDGE_RU = "Хотите, подберём для вас подходящее занятие?";

export const FIND_CLASS_DECLINE_HE = "סבבה. אם תרצי לשאול עוד משהו, אני כאן.";
export const FIND_CLASS_DECLINE_EN = "Sure. If you want to ask anything else, I'm here.";
export const FIND_CLASS_DECLINE_RU = "Хорошо. Если захотите спросить ещё что-нибудь, я здесь.";

const BRIDGE_LINES = [FIND_CLASS_BRIDGE_HE, FIND_CLASS_BRIDGE_EN, FIND_CLASS_BRIDGE_RU];

/** מחיר, מיקום, משך, התאמה, ציוד, חניה — לא «מתי השיעור בלוח». */
const SEPARATE_FACT_RE =
  /מחיר|עלות|עלויות|עולה|מחירון|pricing|\bprice\b|\bcost\b|how much|איפה|היכן|כתובת|מיקום|חניה|איך מגיעים|איך להגיע|כמה זמן|משך|אורך ה(?:שיעור|אימון)|how long|\bduration\b|למי (?:זה )?מתאים|מגיל|באיזה גיל|הריון|מה להביא|איזה ציוד|מזרן|כמה\s+(?:אימונים|שיעורים|פעמים)/iu;

const CLASS_INTEREST_RE =
  /אימון|שיעור|להגיע|להצטרף|פרטים|מידע|מנוי|ניסיון|להתחיל|class|trial/iu;

const AFFIRMATIVE_RE =
  /^(?:כן|בטח|יאללה|אשמח|בואו|בוא|אוקיי?|ok|okay|yes|sure|да|конечно)(?:\s+(?:בבקשה|תודה|מאוד|יאללה|בוא|בואו))?$/iu;

const NEGATIVE_RE =
  /^(?:לא|לא תודה|לא כרגע|לא צריך|לא עכשיו|לא בא לי|no|no thanks|not now|нет|не сейчас|не надо)$/iu;

function coreAsk(raw: string): string {
  return stripLeadingCasualGreeting(normalizeSalesFlowGreetingToken(raw));
}

function normReply(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[!.,?;:~'"`\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBareClassDetailsAsk(core: string): boolean {
  if (!core) return false;
  return (
    /^(?:אפשר\s+)?(?:לקבל\s+)?(?:עוד\s+|קצת\s+)?(?:מידע|פרטים)(?:\s+נוסף|\s+נוספים)?(?:\s+על\s+(?:זה|האימונים|השיעורים|הסטודיו|המקום))?$/u.test(
      core
    ) ||
    /^(?:אשמח|נשמח|רוצה|רוצים|בא לי)\s+(?:לשמוע|לקבל|לדעת)\s+(?:עוד\s+|קצת\s+)?(?:מידע|פרטים|על\s+(?:זה|האימונים|השיעורים|הסטודיו))?$/u.test(
      core
    ) ||
    /^(?:אשמח|נשמח)\s+ל(?:שמוע|קבל)(?:\s+פרטים)?$/u.test(core) ||
    /^(?:מידע|פרטים)$/u.test(core) ||
    /^(?:אפשר\s+)?(?:לקבל\s+)?מידע\s+נוסף(?:\s+על\s+זה)?$/u.test(core) ||
    /^(?:hello\s+)?(?:can i get more info(?: on this)?|more info|details)$/iu.test(core) ||
    /^(?:id like details|i would like details)$/iu.test(core)
  );
}

/**
 * יש שאלה מעבר לבקשה לשמוע על האימונים.
 * «פרטים» / «אשמח לשמוע» / «איך נרשמים» לבד — אין.
 */
export function inboundHasQuestionBeyondClassInterest(raw: string): boolean {
  const t = coreAsk(raw);
  if (!t) return false;
  if (SEPARATE_FACT_RE.test(t)) return true;
  if (isBareClassDetailsAsk(t)) return false;
  if (isJoinSignupIntentText(raw) || isSalesFlowStartTrigger(raw)) return false;
  if (/(?:רציתי|אשמח|אפשר)\s+(?:לדעת|לשאול|לברר)/u.test(t)) {
    if (
      /(?:לדעת|לשאול|לברר)\s+על\s+(?:ה)?(?:אימונים|שיעורים|סטודיו|מקום|זה)\b/u.test(t)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

export function isFindClassBridgeModel(model: string | null | undefined): boolean {
  return modelUsedBase(model) === FIND_CLASS_ASK_MODEL;
}

export function isAffirmativeFindClassReply(raw: string): boolean {
  const t = normReply(raw);
  if (!t || t.length > 40) return false;
  if (NEGATIVE_RE.test(t)) return false;
  return AFFIRMATIVE_RE.test(t);
}

export function isNegativeFindClassReply(raw: string): boolean {
  const t = normReply(raw);
  if (!t || t.length > 40) return false;
  return NEGATIVE_RE.test(t);
}

export function isFindClassBridgeYesNo(raw: string): boolean {
  return isAffirmativeFindClassReply(raw) || isNegativeFindClassReply(raw);
}

export function resolveFindClassLang(
  inbound: string,
  businessLang: BusinessContentLanguage
): BusinessContentLanguage {
  const detected = detectMessageLanguage(inbound);
  if (detected === "en" || detected === "he" || detected === "ru") return detected;
  return businessLang;
}

export function findClassBridgeQuestion(lang: BusinessContentLanguage): string {
  if (lang === "en") return FIND_CLASS_BRIDGE_EN;
  if (lang === "ru") return FIND_CLASS_BRIDGE_RU;
  return FIND_CLASS_BRIDGE_HE;
}

export function findClassDeclineReply(lang: BusinessContentLanguage): string {
  if (lang === "en") return FIND_CLASS_DECLINE_EN;
  if (lang === "ru") return FIND_CLASS_DECLINE_RU;
  return FIND_CLASS_DECLINE_HE;
}

const UNCLEAR_SNIPPETS = [
  "לא בטוחה שהבנתי",
  "לא בטוחה שאני יכולה לעזור",
  "not sure i fully understood",
  "not sure i can help",
];

/** תשובה לשאלה: נשאר מחיר. יורדים תפריט, «שנשריין», ושאלת הגשר אם המודל כתב אותה. */
export function sanitizeFindClassAnswer(text: string): string {
  const raw = stripSalesFlowCtaHookFromAnswer(text)
    .split("\n")
    .filter((line) => !/^\d+\.\s+\S/u.test(line.trim()))
    .filter((line) => !BRIDGE_LINES.some((q) => line.trim() === q))
    .join("\n");
  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (UNCLEAR_SNIPPETS.some((snippet) => lower.includes(snippet))) continue;
    if (/שנשריין/u.test(trimmed)) continue;
    if (/רוצה שנמצא את השיעור/u.test(trimmed)) continue;
    kept.push(trimmed);
  }
  return stripTrailingFollowUpQuestion(kept.join("\n")).trim();
}

function bodyHasPrice(body: string): boolean {
  return /₪|מחיר|עול|ללא עלות|\bprice\b|\bcost\b/iu.test(body);
}

function displayPrice(raw: string): string {
  const t = raw.trim();
  if (/^\d+(?:[.,]\d+)?$/u.test(t)) return `${t} ₪`;
  return t;
}

/** פירוט מחירים מהשירותים, בלי קריאת מודל. שורות בלי מחיר נשמטות. */
export function formatServicePriceDetail(
  services: { name: string; priceText: string }[]
): string {
  const groups = new Map<string, string[]>();
  for (const service of services) {
    const name = String(service.name ?? "").trim();
    const price = String(service.priceText ?? "").trim();
    if (!name || !price) continue;
    const label = displayPrice(price);
    const names = groups.get(label) ?? [];
    names.push(name);
    groups.set(label, names);
  }
  if (!groups.size) return "";
  return [...groups.entries()].map(([price, names]) => `${names.join(", ")}: ${price}`).join("\n");
}

export function resolveInterestQuestionAnswer(input: {
  inbound: string;
  claudeBody: string;
  services: { name: string; priceText: string }[];
  address: string;
}): string {
  let body = sanitizeFindClassAnswer(input.claudeBody);
  const priceAsk = SEPARATE_FACT_RE.test(coreAsk(input.inbound)) && /מחיר|עלות|עלויות|עולה|מחירון|pricing|\bprice\b|\bcost\b|how much/iu.test(coreAsk(input.inbound));
  if (priceAsk && !bodyHasPrice(body)) {
    const prices = formatServicePriceDetail(input.services);
    if (prices) body = body ? `${body}\n\n${prices}` : prices;
  }
  const address = String(input.address ?? "").trim();
  if (isAddressOrDirectionsIntent(input.inbound) && address) {
    const probe = address.slice(0, Math.min(8, address.length));
    if (probe && !body.includes(probe)) {
      const line = `הכתובת שלנו: ${address}.`;
      body = body ? `${line}\n${body}` : line;
    }
  }
  return body.trim();
}

export function composeFindClassOffer(answer: string, lang: BusinessContentLanguage): string {
  const question = findClassBridgeQuestion(lang);
  const body = String(answer ?? "").trim();
  if (!body) return question;
  if (body.includes(question)) return body;
  return `${body}\n\n${question}`;
}

/**
 * לפתוח את ההצעה במקום פלואו מיידי.
 * interest עם שאלה נוספת, signup מפורש עם שאלה נוספת,
 * או answer כשהמשפט גם מבקש לשמוע על האימונים / שואל מחיר, מיקום או משך.
 */
export function shouldOfferFindClassBeforeFlow(input: {
  route: string | null;
  inbound: string;
  explicitSignup: boolean;
}): boolean {
  if (!inboundHasQuestionBeyondClassInterest(input.inbound)) return false;
  if (input.route === "interest") return true;
  if (input.route === "signup") return input.explicitSignup;
  if (input.route !== "answer") return false;
  const core = coreAsk(input.inbound);
  if (/המנוי שלי|הכרטיסייה שלי|הכרטיסיה שלי|my membership|my (?:class )?card/iu.test(core)) {
    return false;
  }
  if (/מחיר|עלות|עלויות|עולה|מחירון|pricing|\bprice\b|\bcost\b|how much|איפה|היכן|כתובת|מיקום|כמה זמן|משך|אורך ה(?:שיעור|אימון)|how long|\bduration\b/iu.test(core)) {
    return true;
  }
  return CLASS_INTEREST_RE.test(core);
}
