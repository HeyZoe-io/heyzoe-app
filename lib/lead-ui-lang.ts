import type { BusinessKnowledgePack } from "@/lib/business-context";
import { detectMessageLanguage, type DetectedMessageLanguage } from "@/lib/language-detect";
import {
  resolveBusinessContentLanguageFromKnowledge,
  type BusinessContentLanguage,
} from "@/lib/business-content-lang";
import {
  isOmersPlaceHebrewIcebreaker,
  normalizeSalesFlowGreetingToken,
  stripLeadingCasualGreeting,
} from "@/lib/sales-flow-start-triggers";
import { truncateWaButtonLabel } from "@/lib/wa-button-label";

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

function catalogServiceNames(knowledge: BusinessKnowledgePack | null | undefined): string[] {
  if (!knowledge) return [];
  const names = [
    ...(knowledge.serviceNamesForOpening ?? []),
    ...(knowledge.openingServices ?? []).map((s) => s.name),
    ...(knowledge.salesFlowServices ?? []).map((s) => String(s.name ?? "")),
    ...(knowledge.knowledgeCatalogServices ?? []).map((s) => String(s.name ?? "")),
  ];
  return names.map((n) => String(n ?? "").trim()).filter(Boolean);
}

function normCatalogToken(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[׳״"']/g, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** הודעה שהיא רק שם אימון מהקטלוג (כולל תווית כפתור חתוכה) — לא אות לשפת שיחה. */
export function inboundIsCatalogServiceName(
  inboundText: string,
  knowledge?: BusinessKnowledgePack | null
): boolean {
  const incoming = normCatalogToken(inboundText);
  if (!incoming) return false;
  for (const name of catalogServiceNames(knowledge)) {
    const full = normCatalogToken(name);
    if (full && incoming === full) return true;
    const truncated = normCatalogToken(truncateWaButtonLabel(name));
    if (truncated && incoming === truncated) return true;
  }
  return false;
}

/**
 * שפת ההודעה הנכנסת. שם אימון לבדו (BODY PUMP וכו') לא נספר — נשארת השפה השמורה.
 */
export function detectLeadInboundLanguage(
  inboundText: string,
  knowledge?: BusinessKnowledgePack | null,
  slug?: string | null
): DetectedMessageLanguage {
  if (isOmersPlaceHebrewIcebreaker(inboundText, slug)) return "he";
  if (matchesSwitchToRussianIntent(inboundText)) return "ru";
  if (inboundIsCatalogServiceName(inboundText, knowledge)) return "unknown";
  return detectMessageLanguage(inboundText);
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
 * A catalog class name alone (e.g. BODY PUMP) does not switch language.
 */
export function resolveLeadContentLanguage(input: {
  inboundText?: string;
  persisted?: string | null;
  knowledge?: BusinessKnowledgePack | null;
  slug?: string | null;
}): BusinessContentLanguage {
  const fromInbound = detectedToContentLang(
    detectLeadInboundLanguage(input.inboundText ?? "", input.knowledge, input.slug)
  );
  if (fromInbound) return fromInbound;
  const persisted = parseWaUiLang(input.persisted);
  if (persisted) return persisted;
  return resolveBusinessContentLanguageFromKnowledge(input.knowledge);
}
