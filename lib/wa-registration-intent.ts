/** שאלת הבהרה לכוונת הרשמה מעורפלת — לפני standalone-help / Claude. */
export const REGISTRATION_INTENT_CLARIFY_QUESTION = "האם יש לך מנוי קיים אצלנו?";
export const REGISTRATION_INTENT_HAS_MEMBERSHIP_REPLY =
  "אם כך, אפשר להירשם ישירות באפליקציה! האם נדרשת עזרה עם הרישום?";
export const REGISTRATION_INTENT_NO_MEMBERSHIP_REPLY =
  "אין בעיה, אז בוא נבחר עבורך אימון מהרשימה";

export const REGISTRATION_INTENT_CLARIFY_MODEL = "registration_intent_clarify";
export const REGISTRATION_INTENT_HAS_MEMBER_MODEL = "registration_intent_has_membership";
/** גם סמן פתיחת פלואו מכירה (כמו greeting) — כדי ש-sendFlowContinuation לא יידלג. */
export const REGISTRATION_INTENT_NO_MEMBER_MODEL = "registration_intent_no_member";

function normalizeRegistrationIntentText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * כוונת הרשמה/הצטרפות מעורפלת — דטרמיניסטי, בלי Claude.
 * כולל את דוגמת Limitless: «רוצה להצטרף בשבת לפוואר אנד הייט».
 */
export function matchesRegistrationIntentPhrase(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t || t.length > 400) return false;

  if (/(?:רוצה|רוצים|מעוניין|מעוניינת).{0,40}(?:להצטרף|להירשם|להרשם)/u.test(t)) return true;
  if (/אשמח\s+להחליף\s+שיעור/u.test(t)) return true;
  if (/(?:אני\s+)?מנסה\s+להירשם(?:\s+לשיעור)?/u.test(t)) return true;
  if (/(?:אני\s+)?מנסים\s+להירשם(?:\s+לשיעור)?/u.test(t)) return true;
  return false;
}

export type RegistrationIntentMembershipReply = "yes" | "no" | "unclear";

/** תשובת כן/לא לשאלת «האם יש לך מנוי קיים» — לא לולאה על מעורפל. */
export function classifyRegistrationIntentMembershipReply(raw: string): RegistrationIntentMembershipReply {
  const t = normalizeRegistrationIntentText(raw);
  if (!t) return "unclear";

  if (/אין(?:\s+לי|\s+לנו)?\s+מנוי/u.test(t)) return "no";
  if (/יש(?:\s+לי|\s+לנו)?\s+מנוי/u.test(t)) return "yes";

  if (/^(לא|אין לי|אין לנו|no|nope)(?:\b|[.!,?\s]|$)/iu.test(t)) return "no";
  if (/^(כן|יש לי|יש לנו|בטח|yes|yep|yeah)(?:\b|[.!,?\s]|$)/iu.test(t)) return "yes";

  return "unclear";
}
