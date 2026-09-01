import type { BusinessKnowledgePack } from "@/lib/business-context";
import { detectMessageLanguage, type DetectedMessageLanguage } from "@/lib/language-detect";
import {
  resolveBusinessContentLanguageFromKnowledge,
  type BusinessContentLanguage,
} from "@/lib/business-content-lang";
import {
  normalizeSalesFlowGreetingToken,
  stripLeadingCasualGreeting,
} from "@/lib/sales-flow-start-triggers";

export function parseWaUiLang(raw: unknown): BusinessContentLanguage | "" {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "he" || t === "en" || t === "ru") return t;
  return "";
}

export function detectedToContentLang(
  detected: DetectedMessageLanguage
): BusinessContentLanguage | null {
  if (detected === "he" || detected === "en" || detected === "ru") return detected;
  return null;
}

const SWITCH_TO_RU_MAX_LEN = 64;

const HE_POLITE = String.raw`(?:אפשר(?:\s+בבקשה)?|בבקשה|רוצה|אשמח)`;
const HE_VERB = String.raw`(?:ל(?:כתוב|דבר|המשיך|ענות|עבור)|כתבי(?:\s+לי)?|תכתבי(?:\s+לי)?|תכתוב(?:\s+לי)?|דברי(?:\s+איתי)?|תדברי(?:\s+איתי)?|תעני|נמשיך|בואי\s+נמשיך)`;
const HE_LANG = String.raw`(?:ב)?רוסית`;
const SWITCH_TO_RU_HE: RegExp[] = [
  new RegExp(`^${HE_LANG}(?:\\s+בבקשה)?$`, "u"),
  new RegExp(`^${HE_POLITE}\\s+${HE_LANG}(?:\\s+בבקשה)?$`, "u"),
  new RegExp(`^${HE_POLITE}\\s+${HE_VERB}\\s+${HE_LANG}(?:\\s+בבקשה)?$`, "u"),
  new RegExp(`^${HE_VERB}\\s+${HE_LANG}(?:\\s+בבקשה)?$`, "u"),
];

/** After hyphen strip: «по-русски» → «порусски». */
const RU_LANG = String.raw`(?:порусски|на русском(?:\s+языке)?|русск(?:ий|ая|ое|ие|и)?)`;
const RU_POLITE = String.raw`(?:можно(?:\s+ли)?|давайте|хочу)`;
const RU_VERB = String.raw`(?:писать|говорить|продолжить|отвечать)`;
const SWITCH_TO_RU_RU: RegExp[] = [
  new RegExp(`^${RU_LANG}(?:\\s+пожалуйста)?$`, "iu"),
  new RegExp(`^${RU_POLITE}\\s+${RU_LANG}(?:\\s+пожалуйста)?$`, "iu"),
  new RegExp(`^${RU_POLITE}\\s+${RU_VERB}\\s+${RU_LANG}(?:\\s+пожалуйста)?$`, "iu"),
  new RegExp(`^${RU_VERB}\\s+${RU_LANG}(?:\\s+пожалуйста)?$`, "iu"),
];

const SWITCH_TO_RU_EN =
  /^(?:(?:in\s+)?russian(?:\s+please)?|can we (?:speak|write|do)(?: this)? in russian(?:\s+please)?)$/i;

/** «יש שיעורים ברוסית?» — שאלה על תוכן, לא בקשת מעבר שפה. */
const SWITCH_TO_RU_CLASS_QUESTION =
  /(?:שיעור|שיעורים|אימון|אימונים|חוג|חוגים|class(?:es)?|lesson(?:s)?|заняти\w*).{0,28}(?:רוסית|русск)|(?:רוסית|русск).{0,28}(?:שיעור|שיעורים|אימון|אימונים|חוג|חוגים|class(?:es)?|lesson(?:s)?|заняти\w*)/iu;

/**
 * ליד שכבר בפלואו (לרוב בעברית) מבקש לעבור לרוסית:
 * «רוסית?» / «אפשר ברוסית?» / «אפשר לכתוב ברוסית» / «можно на русском?»
 */
export function matchesSwitchToRussianIntent(raw: string): boolean {
  const normalized = normalizeSalesFlowGreetingToken(raw);
  const t = stripLeadingCasualGreeting(normalized);
  if (!t || t.length > SWITCH_TO_RU_MAX_LEN) return false;
  if (SWITCH_TO_RU_CLASS_QUESTION.test(t)) return false;
  if (SWITCH_TO_RU_HE.some((re) => re.test(t))) return true;
  if (SWITCH_TO_RU_RU.some((re) => re.test(t))) return true;
  return SWITCH_TO_RU_EN.test(t);
}

/**
 * Language for this lead's WhatsApp UI (flow copy + buttons).
 * Latest inbound script wins; otherwise persisted; otherwise the studio default.
 * Explicit «אפשר ברוסית?» wins over Hebrew script detection.
 */
export function resolveLeadContentLanguage(input: {
  inboundText?: string;
  persisted?: string | null;
  knowledge?: BusinessKnowledgePack | null;
}): BusinessContentLanguage {
  if (matchesSwitchToRussianIntent(input.inboundText ?? "")) return "ru";
  const fromInbound = detectedToContentLang(detectMessageLanguage(input.inboundText ?? ""));
  if (fromInbound) return fromInbound;
  const persisted = parseWaUiLang(input.persisted);
  if (persisted) return persisted;
  return resolveBusinessContentLanguageFromKnowledge(input.knowledge);
}
