/** בקשת מועד שכבר נקבע / שליחה ליומן — בלי גישה לחשבון; הבהרה קצרה ואז העברה לצוות. */

import { REGISTRATION_INTENT_CLARIFY_QUESTION } from "@/lib/wa-registration-intent";

export const BOOKING_LOOKUP_CLARIFY_QUESTION = REGISTRATION_INTENT_CLARIFY_QUESTION;
export const BOOKING_LOOKUP_CLARIFY_MODEL = "booking_lookup_clarify";
export const BOOKING_LOOKUP_MEMBERSHIP_HANDOFF_MODEL = "booking_lookup_membership_handoff";

export function buildBookingLookupMembershipHandoffReply(customerServicePhone: string): string {
  const phone = String(customerServicePhone ?? "").trim();
  const base = "תודה על הבהרה! 💜 אני מעבירה את הפנייה לצוות ויצרו איתך קשר בקרוב.";
  if (!phone) return base;
  return `${base} ביכולתך גם ליצור קשר טלפונית: ${phone}`;
}

function normalizeBookingLookupText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * הליד מבקש מועד שכבר נקבע / להכניס ליומן — לא «מתי יש אימון» כללי.
 * דוגמת Limitless: «יכולה לשלוח לי למתי קבענו שאכניס לי ליומן».
 */
export function matchesBookingLookupPhrase(raw: string): boolean {
  const t = normalizeBookingLookupText(raw);
  if (!t || t.length > 500) return false;

  if (
    /מתי\s+(?:יש|אפשר|ניתן)\s+(?:להגיע|לבוא|שיעור|אימון)|מערכת\s+ה?שעות|לוח\s+(?:ה)?שיעורים/u.test(t)
  ) {
    return false;
  }

  const alreadyBooked = /קבענו|שנקבע|שנקבעה|שנקבעו|ששיריינו|ששיבצנו/u.test(t);
  const myClassTime =
    /(?:מתי|מה\s+ה?מועד|מה\s+ה?שעה).{0,24}(?:האימון|השיעור|ההרשמ)\s+שלי|(?:האימון|השיעור|ההרשמ)\s+שלי.{0,24}(?:מתי|מועד|שעה)/u.test(
      t
    );
  const toCalendar =
    /(?:ל)?יומן|calendar/iu.test(t) &&
    /(?:מתי|מועד|קבע|רשמ|שעה|שלח|תשלח|תוכל|יכולה|להכניס|שאכניס|להוסיף)/u.test(t);
  const english =
    /when\s+(?:is|did\s+we\s+(?:book|schedule))\s+my\s+(?:class|session|lesson|training)/i.test(t) ||
    /add(?:\s+it)?\s+to\s+(?:my\s+)?calendar/i.test(t) ||
    /send\s+me\s+(?:the\s+)?(?:time|slot|schedule)\s+we\s+(?:booked|scheduled)/i.test(t);

  return alreadyBooked || myClassTime || toCalendar || english;
}

function matchesAdditionalScheduleInquiry(t: string): boolean {
  if (
    /מתי\s+(?:יש|אפשר|ניתן)\s+(?:להגיע|לבוא|שיעור|אימון)|מערכת\s+ה?שעות|לוח\s+(?:ה)?שיעורים/u.test(t)
  ) {
    return false;
  }
  if (/(?:מתי|למתי).{0,16}(?:השיעור|האימון)\s+הבא\s+שלי/u.test(t)) return true;
  if (/לאיזה\s+שיעור\s+נרשמ/u.test(t)) return true;
  if (/(?:מתי|למתי)\s+אני\s+רשומ/u.test(t)) return true;
  if (/שכחתי.{0,24}מתי.{0,20}(?:האימון|השיעור|קבענו)/u.test(t)) return true;
  if (
    /תזכיר(?:י|ו)?\s+לי.{0,24}מתי.{0,20}(?:אני\s+מגיע|האימון|השיעור|קבענו)/u.test(t)
  ) {
    return true;
  }
  if (/יש\s+לי\s+(?:אימון|שיעור)\s+(?:השבוע|היום|מחר)/u.test(t)) return true;
  return false;
}

/** בקשת שיבוץ קיים / «מתי האימון שלי» — כולל matchesBookingLookupPhrase. */
export function isScheduleInquiryIntent(raw: string): boolean {
  if (matchesBookingLookupPhrase(raw)) return true;
  const t = normalizeBookingLookupText(raw);
  if (!t || t.length > 500) return false;
  return matchesAdditionalScheduleInquiry(t);
}

/** זואי (גם קלוד) שאלה מנוי קיים מול אימון ניסיון. */
export function assistantAskedMembershipOrTrialClarify(raw: string): boolean {
  const t = normalizeBookingLookupText(raw);
  if (!t) return false;
  if (t.includes(BOOKING_LOOKUP_CLARIFY_QUESTION)) return true;
  const hasMember = /מנוי קיים/u.test(t);
  const hasTrial = /אימון ניסיון/u.test(t);
  const asks = /[?؟]|או שיש|או שמדובר|אתה מתכוון|את מתכוונת|האם יש/u.test(t);
  return hasMember && hasTrial && asks;
}

/**
 * קלוד אמרה שאין גישה למנוי/יומן ושלחה את הליד להתקשר בעצמו — במקום העברה לצוות.
 */
export function assistantReplyDumpsAccountAccessToSelfServeCall(raw: string): boolean {
  const t = normalizeBookingLookupText(raw);
  if (!t) return false;
  if (/מעביר(?:ה|ים) את הפנייה|יצרו איתך קשר בקרוב|נציג אנושי יחז/u.test(t)) return false;
  const noAccess =
    /(?:לא יכול(?:ה)? לגשת|אין לי גישה)/u.test(t) && /מנוי|יומן|לוח האימונים|הרשמ/u.test(t);
  const selfServe =
    /(?:אתה יכול|את יכולה|תוכל(?:י)?|ניתן)\s+ליצור קשר|ליצור קשר בטלפון|התקשר(?:י|ו)?\s+ל/u.test(t);
  return noAccess && selfServe;
}
