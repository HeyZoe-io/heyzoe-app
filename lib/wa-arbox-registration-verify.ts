/**
 * Arbox lead who already booked and only wants to check the booking.
 * Zoe does not confirm the class herself — the app does.
 */

export const ARBOX_REGISTRATION_VERIFY_REPLY = "אפשר לוודא את ההרשמה דרך האפליקציה";
export const ARBOX_REGISTRATION_VERIFY_MODEL = "arbox_registration_verify";

function normalizeVerifyText(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** «מתי יש» / «מה יש היום» נשאר שאלת לוח, לא אימות הרשמה. */
function isScheduleQuestion(t: string): boolean {
  return /מתי|מה\s+יש|איזה\s+(?:שיעור|אימון|שיעורים|אימונים)|מערכת\s+שעות|לוח/.test(t);
}

export function matchesArboxRegistrationVerifyAsk(raw: string): boolean {
  const t = normalizeVerifyText(raw);
  if (!t || t.length > 400) return false;
  if (isScheduleQuestion(t)) return false;
  if (/לוודא/.test(t) && /הרשמ|רשומ|אימון|שיעור|הגעה|שריונ/.test(t)) return true;
  if (/רק\s+רציתי\s+לוודא/.test(t) || t === "רציתי לוודא") return true;
  if (/(?:אני|אנחנו|חברה).{0,30}רשומ/.test(t)) return true;
  if (/מודא|מוודא/.test(t) && /יש\s+לנו|אימון|שיעור|הרשמ|רשומ/.test(t)) return true;
  if (/יש\s+לנו\s+(?:אימון|שיעור)/.test(t)) return true;
  return false;
}
