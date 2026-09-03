import { pickByDetectedLanguage, type DetectedMessageLanguage } from "@/lib/language-detect";

/** שיחה על הגדרות/חוקיות/פלואו — זואי לא משתפת פעולה; מפנה לענייני הסטודיו. */
export const WA_STUDIO_SCOPE_REDIRECT_HE =
  "אני כאן כדי לעזור לגבי השירותים שלנו. במה אפשר לעזור?";
export const WA_STUDIO_SCOPE_REDIRECT_EN =
  "I'm here to help with our studio services. How can I help?";
export const WA_STUDIO_SCOPE_REDIRECT_RU =
  "Я здесь, чтобы помочь по вопросам студии. Чем могу помочь?";
export const WA_BOT_CONFIG_META_MODEL = "wa_bot_config_meta_redirect";

export function buildStudioScopeRedirectReply(lang?: DetectedMessageLanguage): string {
  return pickByDetectedLanguage(lang, {
    he: WA_STUDIO_SCOPE_REDIRECT_HE,
    en: WA_STUDIO_SCOPE_REDIRECT_EN,
    ru: WA_STUDIO_SCOPE_REDIRECT_RU,
  });
}

function normalizeMetaText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[״""«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const SALES_FLOW_PRODUCT_RE = /פלואו(?:\s+ה)?מכירה/u;
const LEGALITY_CHANGE_RE =
  /(?:נשנה|לשנות|שנה|תשני|תשנה|נעדכן|תעדכני|להחליף|נחליף)\s+.{0,48}חוקיות|לחוקיות\s+הרגילה|החוקיות\s+הרגילה|חוקיות\s+רגילה/u;
const SALES_FLOW_CHANGE_RE =
  /(?:נשנה|לשנות|שנה|תשני|הגדרות|ייפתח|יפתח|נפתח|תפתח|לכל הודעה|אוטומט)/u;
const ZOE_SENDS_FLOW_RE = /זואי.{0,80}(?:תשלח|תפתח|יכולה לשלוח)/u;
const OWNER_UI_RE =
  /heyzoe|דף\s*השיחות|(?:כיבוי(?:ים)?|לכבות|מכבים?|תכבי)\s+(?:את\s+)?(?:של\s+)?(?:ה)?בוט|כיבוי\s+זואי|הגדרות\s+(?:של\s+)?(?:ה)?בוט/iu;
const EN_CONFIG_RE =
  /change (?:the )?(?:sales flow|bot (?:settings|rules|logic))|sales flow.{0,48}every message|don['’]?t open (?:the )?sales flow/i;

/**
 * בעל עסק / מישהו שמדבר אל זואי כאל מוצר: לשנות חוקיות, פלואו מכירה, כיבוי בוט.
 * לא «אשמח לפרטים», לא מדיניות ביטול של הסטודיו, לא «מסלול מכירה» ללקוח.
 */
export function matchesBotConfigMetaTalk(raw: string): boolean {
  const t = normalizeMetaText(raw);
  if (!t || t.length > 2000) return false;
  if (OWNER_UI_RE.test(t)) return true;
  if (LEGALITY_CHANGE_RE.test(t)) return true;
  if (EN_CONFIG_RE.test(t)) return true;
  if (SALES_FLOW_PRODUCT_RE.test(t) && (SALES_FLOW_CHANGE_RE.test(t) || ZOE_SENDS_FLOW_RE.test(t))) {
    return true;
  }
  return false;
}

const META_REPLY_RE =
  /פעולה מוצעת|חוקיות\s+רגילה|לחוקיות|פלואו(?:\s+ה)?מכירה|ניישם|אני מוכן(?:ה)? לשנות|שנה את ההגדרות/u;

/** תשובת מודל שנכנסה לייעוץ מוצר במקום נציגת סטודיו. */
export function looksLikeBotConfigMetaReply(raw: string): boolean {
  const t = normalizeMetaText(raw);
  if (!t) return false;
  return META_REPLY_RE.test(t);
}
