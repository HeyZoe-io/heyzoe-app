import { pickByDetectedLanguage, type DetectedMessageLanguage } from "@/lib/language-detect";

/** שיחה על הגדרות/חוקיות/פלואו/פיתוח — לא קשור לסטודיו. השרת לא שולח מענה. */
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

/** «מכניסה לפיתוח» — לא «פיתוח גוף» / «פיתוח אישי». */
const DEVELOPMENT_BACKLOG_RE =
  /(?:מכניס(?:ה|ים|ות)?|להכניס|נכנס(?:ה|ים|ות|תי)?|הכנסתי|תכניס(?:י|ו)?|הכנס(?:י|ו)?)\s+(?:את\s+\S+(?:\s+\S+){0,6}\s+)?לפיתוח(?!\s+(?:גוף|אישי|ילד|ילדים|מוטורי|שפה|רגשי|גופני))/u;
const LOST_LEAD_PRODUCT_RE = /ליד\s+אבוד(?!ה)/u;
const DASHBOARD_LEADS_LIST_RE = /רשימ(?:ה|ת)\s+של\s+אוטומט|אוטומט.{0,40}לידים|לידים.{0,40}אוטומט/u;
const EN_BACKLOG_RE =
  /(?:put|add(?:ing)?|move)\s+(?:it|them|this|the rest|everything else).{0,32}(?:into|to)\s+(?:development|the backlog)|\binto development\b|\bto the backlog\b/i;

/**
 * בעל עסק / מישהו שמדבר אל זואי כאל מוצר: לשנות חוקיות, פלואו מכירה, כיבוי בוט,
 * או לעדכן באקלוג («ליד אבוד», «מכניסה לפיתוח», רשימת אוטומטי ללידים).
 * לא «אשמח לפרטים», לא מדיניות ביטול של הסטודיו, לא «מסלול מכירה» ללקוח.
 */
export function matchesBotConfigMetaTalk(raw: string): boolean {
  const t = normalizeMetaText(raw);
  if (!t || t.length > 2000) return false;
  if (OWNER_UI_RE.test(t)) return true;
  if (LEGALITY_CHANGE_RE.test(t)) return true;
  if (EN_CONFIG_RE.test(t)) return true;
  if (DEVELOPMENT_BACKLOG_RE.test(t)) return true;
  if (LOST_LEAD_PRODUCT_RE.test(t)) return true;
  if (DASHBOARD_LEADS_LIST_RE.test(t)) return true;
  if (EN_BACKLOG_RE.test(t)) return true;
  if (SALES_FLOW_PRODUCT_RE.test(t) && (SALES_FLOW_CHANGE_RE.test(t) || ZOE_SENDS_FLOW_RE.test(t))) {
    return true;
  }
  return false;
}

const META_REPLY_RE =
  /פעולה מוצעת|חוקיות\s+רגילה|לחוקיות|פלואו(?:\s+ה)?מכירה|ניישם|אני מוכן(?:ה)? לשנות|שנה את ההגדרות|הכנסתי\s+לפיתוח|כשיהיו מוכנים\s+נעדכן|ליד\s+אבוד(?!ה)/u;

/** תשובת מודל שנכנסה לייעוץ מוצר במקום נציגת סטודיו. */
export function looksLikeBotConfigMetaReply(raw: string): boolean {
  const t = normalizeMetaText(raw);
  if (!t) return false;
  return META_REPLY_RE.test(t);
}
