import {
  normalizeSalesFlowGreetingToken,
  stripLeadingCasualGreeting,
} from "@/lib/sales-flow-start-triggers";
import {
  matchesComposableTrialSignupIntent,
  normalizeTrialSignupIntentText,
  TRIAL_NOUN,
} from "@/lib/wa-trial-signup-intent";

function normalizeTrialTopicText(raw: string): string {
  return normalizeSalesFlowGreetingToken(raw);
}

/** Common Hebrew typo: הכרות (without י) vs היכרות */
const TRIAL_TOPIC_MARKERS =
  /(?:ניסיון|נסיון|היכרות|הכרות|\btrial\b|\bintro\b|taster|first\s+class)/iu;

const TRIAL_CLASS_PHRASE = new RegExp(String.raw`${TRIAL_NOUN}`, "u");

/**
 * Already signed up for a trial (or comparing a friend's signup) — not asking to buy one.
 * Limitless: «נרשמנו ביחד לאימוני ניסיון ולה לא הייתה את הבעיה הזאת של להירשם».
 */
export function isExistingTrialEnrollmentMention(raw: string): boolean {
  const t = stripLeadingCasualGreeting(normalizeTrialTopicText(raw));
  if (!t) return false;
  if (
    /(?:נרשמ(?:תי|נו|ה|ת|ים)|נרשמתם).{0,48}(?:אימוני|אימון|שיעור(?:י)?).{0,20}(?:ניסיון|נסיון|היכרות|הכרות)/u.test(
      t
    )
  ) {
    return true;
  }
  if (
    /(?:כבר\s+)?(?:יש\s+לי|יש\s+לנו)\s+(?:אימון|שיעור|אימוני)\s*(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)
  ) {
    return true;
  }
  return false;
}

/** Lead asks about or wants trial / intro training — incl. «אימון הכרות» typo. */
export function matchesTrialTopicIntent(raw: string): boolean {
  const normalized = normalizeTrialTopicText(raw);
  const t = stripLeadingCasualGreeting(normalized);
  if (!t || t.length > 400) return false;
  if (isExistingTrialEnrollmentMention(raw)) return false;
  if (!TRIAL_TOPIC_MARKERS.test(t)) return false;
  if (TRIAL_CLASS_PHRASE.test(t)) return true;
  if (/אימוני\s+(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)) return true;
  if (/שיעור(?:י)?\s+(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)) return true;
  if (/(?:ניסיון|נסיון|היכרות|הכרות).{0,20}(?:אימון|שיעור)/u.test(t)) return true;
  if (/(?:מה|איך|כמה|יש|אפשר|ספר(?:י|ו)?|מידע|פרטים).{0,48}(?:ניסיון|נסיון|היכרות|הכרות)/u.test(t)) {
    return true;
  }
  if (matchesComposableTrialSignupIntent(t)) return true;
  return false;
}

/** Wants to start trial flow — skip warmup / open product pick (not pure price/info FAQ). */
export function matchesTrialTopicAdvanceIntent(raw: string): boolean {
  const t = normalizeTrialSignupIntentText(raw);
  if (!t || !matchesTrialTopicIntent(raw)) return false;
  if (/^(?:כמה|מה\s+המחיר|מה\s+עולה|עולה|מחיר)/u.test(t) && !/(?:רוצ|אשמח|נשמח|להירשם|להצטרף|לנסות)/u.test(t)) {
    return false;
  }
  if (/^(?:מה|איך)\s+(?:זה|עובד|כולל)/u.test(t)) return false;
  if (matchesComposableTrialSignupIntent(t)) return true;
  if (
    /^(?:רוצ(?:ה|ים|ה)|אשמח|נשמח|אפשר)\s+(?:אימון|שיעור)\s*(?:ה)?(?:ני?סיון|(?:ה)?(?:י?כרות))/u.test(
      t
    )
  ) {
    return true;
  }
  if (/^(?:איך|איפה)\s+(?:נרשמ|מצטרפ|קונים|רוכשים)/u.test(t)) return true;
  if (/^(?:יש|אפשר)\s+(?:אימון|שיעור)/u.test(t)) return true;
  return false;
}

export const TRIAL_TOPIC_FLOW_ENTRY_MODEL = "trial_topic_flow_entry";
export const TRIAL_TOPIC_QA_REPLY_MODEL = "trial_topic_qa_reply";
