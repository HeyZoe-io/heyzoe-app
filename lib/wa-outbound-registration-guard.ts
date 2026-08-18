/** מונע הודעת «נרשמת בהצלחה» יחד עם לינק הרשמה, ומוסיף שאלת מועד כשמפרטים שעות. */

export const SCHEDULE_WHEN_CONVENIENT_QUESTION = "מתי נוח לך להגיע?";

const AFTER_REG_START_RE = /כל הכבוד!\s*נרשמת(?:ם)?\s+בהצלחה|נרשמת(?:ם)?\s+בהצלחה\s*🎉/u;

const SIGNUP_CTA_PHRASE_RE =
  /לינק מאובטח|הרישום והתשלום|לשמור לך מקום|לשריין את מקומ|נרשום אתכ[םן]|בואו נרשום/iu;

const BOOKING_URL_RE =
  /https?:\/\/[^\s]*?(?:plando|arbox|icount|checkout|embed_store|self_services)/i;

const AFTER_REG_TEMPLATE_BODY_RE =
  /זה קורה בכתובת|ככה מגיעים אלינו|מוזמנים לבקר באינסטגרם/u;

const DAY_TIME_RE =
  /יום\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)\s+\d{1,2}:\d{2}/gu;

const WHEN_CONVENIENT_RE = /מתי נוח ל(?:ך|כם) להגיע/u;

function looksLikeSignupCta(chunk: string): boolean {
  return SIGNUP_CTA_PHRASE_RE.test(chunk) || BOOKING_URL_RE.test(chunk);
}

/** חותך תבנית אחרי-הרשמה מתשובת AI לפני שהליד באמת נרשם. */
export function stripPrematureAfterRegistration(text: string): string {
  const s = String(text ?? "");
  const m = s.match(AFTER_REG_START_RE);
  if (!m || m.index == null) return s;
  const before = s.slice(0, m.index).trim();
  const after = s.slice(m.index);
  if (looksLikeSignupCta(before)) return before;
  if (!before && AFTER_REG_TEMPLATE_BODY_RE.test(after)) return "";
  return s;
}

/** אם מפרטים לפחות שני מועדים (יום+שעה) בלי שאלת נוחות — מוסיפים אותה בסוף. */
export function ensureScheduleWhenConvenientQuestion(text: string): string {
  const s = String(text ?? "").trim();
  if (!s) return s;
  if (WHEN_CONVENIENT_RE.test(s)) return s;
  const matches = s.match(DAY_TIME_RE);
  if (!matches || matches.length < 2) return s;
  return `${s}\n\n${SCHEDULE_WHEN_CONVENIENT_QUESTION}`;
}
