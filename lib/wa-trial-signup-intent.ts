/**
 * Composable trial-signup intent matching — shared by warmup-skip group C,
 * join-signup recovery, and trial-topic advance detection.
 */

import {
  normalizeSalesFlowGreetingToken,
  stripLeadingCasualGreeting,
} from "@/lib/sales-flow-start-triggers";

/** Class word with optional ב/ל prefix (attached or spaced): בשיעור, לאימון, שיעור, אימון. */
const CLASS_OR_PREP =
  String.raw`(?:(?:[בל])?(?:שיעור(?:י)?|אימון(?:י)?|אימוני)|\bclass\b)`;

/** Trial marker: ניסיון / נסיון / היכרות / הכרות (+ class prefix). */
export const TRIAL_NOUN = String.raw`${CLASS_OR_PREP}\s*(?:ה)?(?:ני?סיון|(?:ה)?(?:י?כרות))`;

/** Desire / request cues. */
export const DESIRE_CUE =
  String.raw`(?:אשמח|נשמח|מעוניין|מעוניינת|מתעניין|מתעניינת|רוצ(?:ה|ים|ה)|בא\s+לי|אפשר(?:\s+לבוא\s+ל)?)`;

/** Come / book / register verbs between desire and trial noun. */
const COME_OR_BOOK_VERB =
  String.raw`(?:לתאם|לקבוע|לשריין|לשבץ|להגיע|לבוא|לבקר|להירשם|להצטרף)`;

/** Standalone «לנסות קודם» — no trial noun. */
export const TRY_FIRST_PATTERN = String.raw`^(?:אשמח|נשמח|רוצ(?:ה|ים|ה))\s+לנסות\s+קודם$`;

/** Info-question openers at message start — trial noun present but no signup intent. */
const INFO_QUESTION_OPENER =
  /^(?:מה\s+(?:זה|כולל|עובד|ה)?|איך\s+(?:זה|עובד|כולל)|מה\s+ה(?:מחיר|עלות)|כמה\s+(?:עולה|זה|ה)?|מתי\s+(?:יש|אפשר)|איפה\s+(?:אתם|ה)?|האם\s+(?:יש|אפשר))/u;

/** Strip greeting prefix, punctuation, trailing emoji — before intent match. */
export function normalizeTrialSignupIntentText(raw: string): string {
  const stripped = stripLeadingCasualGreeting(normalizeSalesFlowGreetingToken(raw));
  return stripped
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Full-message patterns — bare / try-first / יש / אפשר (stay strict). */
const ANCHORED_PATTERNS: RegExp[] = [
  new RegExp(TRY_FIRST_PATTERN, "u"),
  new RegExp(String.raw`^${TRIAL_NOUN}$`, "u"),
  new RegExp(String.raw`^יש\s+${TRIAL_NOUN}$`, "u"),
  new RegExp(String.raw`^אפשר\s+(?:לבוא\s+ל\s*)?${TRIAL_NOUN}$`, "u"),
  new RegExp(String.raw`^${DESIRE_CUE}\s+(?:מאוד\s+)?(?:ל\s*)?${TRIAL_NOUN}$`, "u"),
  new RegExp(
    String.raw`^${DESIRE_CUE}\s+(?:ל|ב\s*)?(?:נסות|להירשם|להצטרף|${TRIAL_NOUN})$`,
    "u"
  ),
];

/**
 * Desire + trial noun anywhere after normalize — specific enough for trailing words / emoji.
 * Bare «שיעור ניסיון» stays anchored only (ANCHORED_PATTERNS).
 */
const RELAXED_DESIRE_TRIAL = new RegExp(
  String.raw`${DESIRE_CUE}\s*(?:מאוד\s+)?(?:(?:ל|ב)\s*)?${TRIAL_NOUN}`,
  "u"
);

/**
 * «אשמח לתאם שיעור ניסיון…» / «הייתי רוצה להגיע לאימון ניסיון במוצ״ש»
 * — desire + come/book/register verb + trial noun (words may follow).
 */
const DESIRE_SCHEDULE_TRIAL = new RegExp(
  String.raw`${DESIRE_CUE}\s+${COME_OR_BOOK_VERB}\s+(?:ל\s*)?${TRIAL_NOUN}`,
  "u"
);

/** מתעניינת/מחפשת שיעור או יוגה — כוונת אימון, בלי חובת «ניסיון». */
const SEEKING_CLASS_RE =
  /(?:מתעניינ(?:ת|ים)|מעוניינ(?:ת|ים)|מחפש(?:ת)?)\s+(?:ב|ל)?(?:שיעור(?:י)?|אימון(?:י)?|יוגה)/u;

/**
 * «אני מתעניינת בשיעורי יוגה למתחילות» — התנעת פלואו לבחירת מוצר.
 * שאלות מחיר/שעות נחסמות אצל הקורא (hasInfoQuestionBlock / INFO_QUESTION_OPENER).
 */
export function matchesClassInterestFlowStart(raw: string): boolean {
  const s = normalizeTrialSignupIntentText(raw);
  if (!s) return false;
  if (INFO_QUESTION_OPENER.test(s)) return false;
  return SEEKING_CLASS_RE.test(s);
}

/**
 * Composable trial-signup intent.
 * Does NOT apply price/address traps — callers add those via hasInfoQuestionBlock.
 * Come/book/register + trial wins even when the message starts with «האם אפשר…».
 */
export function matchesComposableTrialSignupIntent(raw: string): boolean {
  const s = normalizeTrialSignupIntentText(raw);
  if (!s) return false;
  if (ANCHORED_PATTERNS.some((re) => re.test(s))) return true;
  if (DESIRE_SCHEDULE_TRIAL.test(s)) return true;
  if (INFO_QUESTION_OPENER.test(s)) return false;
  return RELAXED_DESIRE_TRIAL.test(s);
}

/** Shown before product-pick when Zoe detects trial-class signup intent. */
export const TRIAL_SIGNUP_INTENT_ACK_HE = "אני מבינה שבא לך להירשם לשיעור ניסיון!";
export const TRIAL_SIGNUP_INTENT_ACK_MODEL = "trial_signup_intent_ack";

export function trialSignupAckForInbound(raw: string): string | null {
  return matchesComposableTrialSignupIntent(raw) ? TRIAL_SIGNUP_INTENT_ACK_HE : null;
}

export const TRIAL_SIGNUP_REGEX_SUMMARY = {
  TRIAL_NOUN,
  DESIRE_CUE,
  TRY_FIRST_PATTERN,
  RELAXED_DESIRE_TRIAL: RELAXED_DESIRE_TRIAL.source,
  INFO_QUESTION_OPENER: INFO_QUESTION_OPENER.source,
  ANCHORED_COUNT: ANCHORED_PATTERNS.length,
} as const;
