import { isExistingTrialEnrollmentMention, matchesTrialTopicIntent } from "@/lib/wa-trial-topic-intent";

/** שאלת הבהרה לכוונת הרשמה מעורפלת — לפני standalone-help / Claude. */
export const REGISTRATION_INTENT_CLARIFY_QUESTION =
  "היי! 👋 יש לך מנוי קיים אצלנו או שמדובר באימון ניסיון?";
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
 * כולל בקשה שזואי תרשום: «אשמח שתרשמי אותי לאימון כוח».
 */
export function matchesRegistrationIntentPhrase(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t || t.length > 400) return false;

  if (/(?:רוצה|רוצים|מעוניין|מעוניינת).{0,40}(?:להצטרף|להירשם|להרשם)/u.test(t)) return true;
  if (/(?:הייתי|היינו)\s+שמח(?:ה|ים)?\s+(?:מאוד\s+)?לה[יי]?רשם/u.test(t)) return true;
  if (/(?:אשמח|נשמח)\s+(?:מאוד\s+)?לה[יי]?רשם/u.test(t)) return true;
  if (/(?:אני\s+)?מנסה\s+להירשם(?:\s+לשיעור)?/u.test(t)) return true;
  if (/(?:אני\s+)?מנסים\s+להירשם(?:\s+לשיעור)?/u.test(t)) return true;
  // «תרשמי/תרשמו/תירשמי אותי» / «תרשום אותי» / «רשמי אותי»
  if (/ת[יי]?רשמ(?:י|ו)\s+אות(?:י|נו)/u.test(t)) return true;
  if (/תרשום\s+אות(?:י|נו)/u.test(t)) return true;
  if (/(?:^|[^\p{L}])רשמ(?:י|ו)\s+אות(?:י|נו)/u.test(t)) return true;
  if (/(?:אפשר|אשמח|נשמח|רוצה|תוכל(?:י|ו)?).{0,24}לרשום\s+אות(?:י|נו)/u.test(t)) return true;
  if (/(?:please\s+)?(?:register|sign)\s+me\s+up\b/i.test(t)) return true;
  if (/(?:can you|could you|please)\s+register\s+me\b/i.test(t)) return true;
  return false;
}

const EXISTING_BOOKING_CUE =
  /(?:אני|אנחנו)\s+(?:כבר\s+)?רשו[םמ]|נרשמ(?:תי|נו|ה|ת)|יש\s+לי\s+(?:שיעור|אימון)|רשומ(?:ה|ים|ות)\s+ל(?:שיעור|אימון)/u;

const MOVE_SLOT_CUE =
  /יום\s+אחר|מועד\s+אחר|שבוע\s+אחר|לתאם\s+(?:מחדש|ל(?:יום|מועד))|לקבוע\s+מחדש|לדחות|להעביר|להחליף|לשנות\s+(?:את\s+)?(?:ה)?(?:מועד|שיעור|אימון)|another\s+day|reschedule|postpone/iu;

const EXPLICIT_CLASS_MOVE =
  /(?:להחליף|לדחות|להעביר)\s+(?:את\s+)?ה?(?:שיעור|אימון)|לשנות\s+(?:את\s+)?ה?מועד|לתאם\s+ל(?:יום|מועד)\s+אחר|(?:אשמח|נשמח|רוצה|אפשר)\s+להחליף\s+שיעור/u;

/**
 * Already booked + wants another slot (or explicit swap/postpone).
 * Not «תבטלי» (Zoe do-it → playbook) and not a fresh «לתאם שיעור ניסיון».
 */
export function matchesBookedClassMoveIntent(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t || t.length > 500) return false;
  if (/תבטל(?:י|ו)?/u.test(t) || /\bplease\s+cancel\b/i.test(t)) return false;
  if (EXPLICIT_CLASS_MOVE.test(t)) return true;
  if (EXISTING_BOOKING_CUE.test(t) && MOVE_SLOT_CUE.test(t)) return true;
  if (isExistingTrialEnrollmentMention(raw) && MOVE_SLOT_CUE.test(t)) return true;
  return false;
}

export const BOOKED_CLASS_MOVE_APP_REPLY =
  "אפשר להחליף שיעור ישירות מהאפליקציה: נכנסים, מבטלים את ההרשמה ונרשמים למועד אחר. אם יש בעיה או שצריך עזרה — אני כאן!";
export const BOOKED_CLASS_MOVE_APP_MODEL = "booked_class_move_app";

export function buildBookedClassMoveAppReply(raw: string): string {
  const t = normalizeRegistrationIntentText(raw);
  const illness =
    /לא\s+מרגיש(?:ה|ים)?\s+טוב/u.test(t) ||
    /לא\s+בטוב/u.test(t) ||
    /(?:^|\s)חולה(?:\s|$|[.,!?])/u.test(t);
  return illness ? `מצטערת לשמוע! 💜 ${BOOKED_CLASS_MOVE_APP_REPLY}` : BOOKED_CLASS_MOVE_APP_REPLY;
}

function inboundMentionsExistingPurchase(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t) return false;
  if (isExistingTrialEnrollmentMention(raw)) return true;
  if (EXISTING_BOOKING_CUE.test(t)) return true;
  if (matchesExistingMembershipClaim(raw)) return true;
  if (/כרטיסי[יה]|punch\s*card/iu.test(t)) return true;
  return false;
}

export type BookedClassMoveBranch = "app" | "product_pick";

/**
 * Swap of a purchased/booked class (membership, punch card, or trial) → app.
 * Sales flow with no purchase yet → pick another class. Unknown → app.
 */
export function resolveBookedClassMoveBranch(
  raw: string,
  opts?: {
    trialRegistered?: boolean;
    sessionPhase?: string | null;
    salesFlowStarted?: boolean;
  }
): BookedClassMoveBranch | null {
  if (!matchesBookedClassMoveIntent(raw)) return null;
  const phase = String(opts?.sessionPhase ?? "").trim();
  const purchased =
    opts?.trialRegistered === true ||
    phase === "registered" ||
    inboundMentionsExistingPurchase(raw);
  if (purchased) return "app";
  if (opts?.salesFlowStarted === true && phase !== "registered" && opts?.trialRegistered !== true) {
    return "product_pick";
  }
  return "app";
}

/**
 * הרשמה מעורפלת בלי «ניסיון» — לשאול מנוי מול ניסיון לפני פלואו מכירה.
 * «אשמח להירשם לשיעור ניסיון» נשאר בפלואו ניסיון.
 */
export function shouldAskMembershipVsTrialFirst(raw: string): boolean {
  return matchesRegistrationIntentPhrase(raw) && !matchesTrialTopicIntent(raw);
}

export const EXISTING_MEMBERSHIP_HELP_REPLY = "מעולה! איך אפשר לעזור לך?";
export const EXISTING_MEMBERSHIP_HELP_MODEL = "existing_membership_help";

/**
 * הצהרת מנוי קיים בפלואו מכירה — לא תשובת כן/לא לשאלת הבהרה, ולא «רוצה מנוי».
 */
export function matchesExistingMembershipClaim(raw: string): boolean {
  const t = normalizeRegistrationIntentText(raw);
  if (!t || t.length > 400) return false;
  if (/אין(?:\s+לי|\s+לנו)?\s+מנוי/u.test(t)) return false;
  if (/(?:רוצה|רוצים|מעוניין|מעוניינת).{0,24}מנוי/u.test(t)) return false;
  if (/^(?:מה|איך|כמה|מתי|איפה|האם|למה)\b.{0,40}מנוי/u.test(t)) return false;

  if (/יש(?:\s+לי|\s+לנו)\s+מנוי/u.test(t)) return true;
  if (/(?:אני|אנחנו)\s+(?:כבר\s+)?מנו[יהםות]{1,3}(?:\s|$|[.,!?])/u.test(t)) return true;
  if (/\bi(?:'m|\s+am)\s+(?:already\s+)?a\s+member\b/i.test(t)) return true;
  if (/\bi\s+(?:already\s+)?have\s+a\s+membership\b/i.test(t)) return true;
  return false;
}

export type RegistrationIntentMembershipReply = "yes" | "no" | "unclear";

/** תשובת כן/לא לשאלת מנוי קיים מול אימון ניסיון — לא לולאה על מעורפל. */
export function classifyRegistrationIntentMembershipReply(raw: string): RegistrationIntentMembershipReply {
  const t = normalizeRegistrationIntentText(raw);
  if (!t) return "unclear";

  if (/אין(?:\s+לי|\s+לנו)?\s+מנוי/u.test(t)) return "no";
  if (/מדובר באימון ניסיון|(?:^|\s)אימון ניסיון(?:\s|$|[.,!?])/u.test(t) && !/מנוי/u.test(t)) {
    return "no";
  }
  if (/^(?:אימון\s+)?ניסיון(?:\s|$|[.,!?])/iu.test(t)) return "no";
  if (/מנוי קיים|יש(?:\s+לי|\s+לנו)?\s+מנוי/u.test(t)) return "yes";
  if (/^מנוי(?:\s|$|[.,!?])/u.test(t)) return "yes";

  if (/^(לא|אין לי|אין לנו|no|nope)(?:\b|[.!,?\s]|$)/iu.test(t)) return "no";
  if (/^(כן|יש לי|יש לנו|בטח|yes|yep|yeah)(?:\b|[.!,?\s]|$)/iu.test(t)) return "yes";

  return "unclear";
}
