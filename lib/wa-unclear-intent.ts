import { pickByDetectedLanguage, type DetectedMessageLanguage } from "@/lib/language-detect";

export const WA_UNCLEAR_CLARIFY_MODEL = "wa_unclear_clarify";
export const WA_UNCLEAR_HANDOFF_MODEL = "wa_unclear_team_handoff";

export const WA_UNCLEAR_CLARIFY_HE =
  "לא בטוחה שהבנתי עד הסוף, יש מצב לנסות לנסח לי שוב?";
export const WA_UNCLEAR_HANDOFF_HE =
  "אוקיי אני לא בטוחה שאני יכולה לעזור אבל הצוות בטוח יוכל לסייע. אני אעביר את הפנייה שיצרו איתך קשר סבבה?";

export const WA_UNCLEAR_CLARIFY_EN =
  "I'm not sure I fully understood — could you try phrasing that again?";
export const WA_UNCLEAR_HANDOFF_EN =
  "Okay, I'm not sure I can help, but the team definitely can. I'll pass this along so they can get in touch, sound good?";

export const WA_UNCLEAR_CLARIFY_RU =
  "Не уверена, что полностью поняла — можно сформулировать ещё раз?";
export const WA_UNCLEAR_HANDOFF_RU =
  "Окей, не уверена, что смогу помочь, но команда точно сможет. Передам обращение, чтобы с вами связались, хорошо?";

function normalizeUnclearText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** בקשת ניסוח מחדש (שלב 1) — כולל נוסח ישן של «לא הבנתי». */
export function isUnclearClarifyAsk(raw: string): boolean {
  const t = normalizeUnclearText(raw);
  if (!t) return false;
  if (t.includes(normalizeUnclearText(WA_UNCLEAR_CLARIFY_HE))) return true;
  if (t.includes(normalizeUnclearText(WA_UNCLEAR_CLARIFY_EN))) return true;
  if (t.includes(normalizeUnclearText(WA_UNCLEAR_CLARIFY_RU))) return true;
  return (
    /לא בטוחה שהבנתי/.test(t) &&
    /לנסח/.test(t) &&
    !/הצוות|אעביר את הפני/.test(t)
  );
}

export function isUnclearHandoffAsk(raw: string): boolean {
  const t = normalizeUnclearText(raw);
  if (!t) return false;
  if (t.includes(normalizeUnclearText(WA_UNCLEAR_HANDOFF_HE))) return true;
  if (t.includes(normalizeUnclearText(WA_UNCLEAR_HANDOFF_EN))) return true;
  if (t.includes(normalizeUnclearText(WA_UNCLEAR_HANDOFF_RU))) return true;
  return /אעביר את הפני/.test(t) && /הצוות/.test(t);
}

export function sessionHasUnclearClarifyAsk(
  history: Array<{ role?: string; content?: string }>
): boolean {
  return history.some(
    (m) => String(m.role ?? "") === "assistant" && isUnclearClarifyAsk(String(m.content ?? ""))
  );
}

/**
 * תשובת מודל שאומרת שלא הבינה את כוונת הליד — לא חוסר ידע («אין לי את הפרטים»).
 */
export function looksLikeUnclearIntentReply(raw: string): boolean {
  const original = String(raw ?? "").trim();
  if (!original) return false;
  if (original.length > 320) return false;
  if (isUnclearClarifyAsk(original) || isUnclearHandoffAsk(original)) return true;

  const t = normalizeUnclearText(original);
  if (/אין לי את הפרטים|אין לי כרגע מידע/.test(t) && !/לא בטוחה שהבנתי|לא הבנתי/.test(t)) {
    return false;
  }

  const chunks = original.split(/[.!?؟\n]+/u).map((s) => s.trim()).filter((s) => s.length > 8);
  if (chunks.length > 2) return false;

  return (
    /לא בטוחה שהבנתי|לא הבנתי עד הסוף|לא הבנתי למה התכוונ|לא ברור לי למה/.test(t) ||
    /נסח(?:י|ו)?\s+לי\s+(?:שוב|מחדש)|לנסח(?:ת)?\s+לי\s+(?:שוב|מחדש)/.test(t) ||
    /not sure i (?:fully )?understood|didn['’]?t (?:quite |fully )?understand|try (?:re)?phras/i.test(
      t
    ) ||
    /не уверена.*понял|сформулировать ещё раз|передам обращение/i.test(t)
  );
}

export function pickUnclearIntentReply(
  kind: "clarify" | "handoff",
  lang: DetectedMessageLanguage
): string {
  if (kind === "handoff") {
    return pickByDetectedLanguage(lang, {
      he: WA_UNCLEAR_HANDOFF_HE,
      en: WA_UNCLEAR_HANDOFF_EN,
      ru: WA_UNCLEAR_HANDOFF_RU,
    });
  }
  return pickByDetectedLanguage(lang, {
    he: WA_UNCLEAR_CLARIFY_HE,
    en: WA_UNCLEAR_CLARIFY_EN,
    ru: WA_UNCLEAR_CLARIFY_RU,
  });
}

export function resolveUnclearIntentAction(
  reply: string,
  history: Array<{ role?: string; content?: string }>
): "clarify" | "handoff" | null {
  if (!looksLikeUnclearIntentReply(reply)) return null;
  return sessionHasUnclearClarifyAsk(history) ? "handoff" : "clarify";
}

const CLEAR_KNOWLEDGE_DOMAIN_RE =
  /שיעור|אימון|מנוי|כרטיסי|חבילה|הקפא|ביטול|מחיר|יומן|הרשמ|lesson|class|membership|punch\s*card|заняти|абонемент|расписан|запис/iu;
const CLEAR_KNOWLEDGE_QUESTION_RE =
  /[?؟]|יש מצב|אפשר |ניתן |האם |מה |איך |מתי |למה |כמה |\bcan i\b|\bis there\b|\bhow (?:do|can|much)\b|сколько|когда |как |можно /iu;

/**
 * שאלה ברורה על הסטודיו — לא «לא הבנתי». חוסר מידע בידע זה «אין לי את הפרטים».
 */
export function inboundLooksLikeClearKnowledgeQuestion(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (t.length < 12 || t.length > 500) return false;
  if (/^\[(?:media|heyzoe:|reaction)\]/i.test(t)) return false;
  return CLEAR_KNOWLEDGE_DOMAIN_RE.test(t) && CLEAR_KNOWLEDGE_QUESTION_RE.test(t);
}

export function buildUnclearIntentPromptRule(alreadyAsked: boolean): string {
  if (alreadyAsked) {
    return `- כבר ביקשת ניסוח מחדש בשיחה הזו. אם עדיין לא ברור למה הליד מתכוון — עני רק: «${WA_UNCLEAR_HANDOFF_HE}» (EN: «${WA_UNCLEAR_HANDOFF_EN}»; RU: «${WA_UNCLEAR_HANDOFF_RU}»). אל תבקשי ניסוח שוב. אל תוסיפי שאלת «יש עוד משהו».`;
  }
  return `- אם לא הבנת עד הסוף למה הליד מתכוון (הודעה מעורפלת, חסרה, או לא ברורה) — עני רק: «${WA_UNCLEAR_CLARIFY_HE}» (EN: «${WA_UNCLEAR_CLARIFY_EN}»; RU: «${WA_UNCLEAR_CLARIFY_RU}»). פעם אחת בלבד בשיחה. זה לא חוסר ידע: אם ברור מה שואלים ואין מידע בידע — «אין לי את הפרטים», לא המשפט הזה. ברכת חולין («היי מה קורה», «מה נשמע», «מה המצב», «מה הולך», «מה העניינים») זה לא חוסר הבנה — עני בחביבות: «היי! מעולה, איך אפשר לעזור?». אל תבקשי לנסח מחדש.`;
}
