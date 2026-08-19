/**
 * Composable trial-signup intent matching — shared by warmup-skip group C,
 * join-signup recovery, and trial-topic advance detection.
 */

/** Class word with optional ב/ל prefix (attached or spaced): בשיעור, לאימון, שיעור, אימון. */
const CLASS_OR_PREP =
  String.raw`(?:(?:[בל])?(?:שיעור(?:י)?|אימון(?:י)?|אימוני)|\bclass\b)`;

/** Trial marker: ניסיון / נסיון / היכרות / הכרות (+ class prefix). */
export const TRIAL_NOUN = String.raw`${CLASS_OR_PREP}\s*(?:ה)?(?:ני?סיון|(?:ה)?(?:י?כרות))`;

/** Desire / request cues. */
export const DESIRE_CUE =
  String.raw`(?:אשמח|נשמח|מעוניין|מעוניינת|מתעניין|מתעניינת|רוצ(?:ה|ים|ה)|אפשר(?:\s+לבוא\s+ל)?)`;

/** Standalone «לנסות קודם» — no trial noun. */
export const TRY_FIRST_PATTERN = String.raw`^(?:אשמח|נשמח|רוצ(?:ה|ים|ה))\s+לנסות\s+קודם$`;

/** Info-question openers — trial noun present but no signup intent. */
const INFO_QUESTION_OPENER =
  /^(?:מה\s+(?:זה|כולל|עובד|ה)?|איך\s+(?:זה|עובד|כולל)|מה\s+ה(?:מחיר|עלות)|כמה\s+(?:עולה|זה|ה)?|מתי\s+(?:יש|אפשר)|איפה\s+(?:אתם|ה)?|האם\s+(?:יש|אפשר))/u;

const COMPOSABLE_PATTERNS: RegExp[] = [
  new RegExp(TRY_FIRST_PATTERN, "u"),
  new RegExp(String.raw`^${TRIAL_NOUN}$`, "u"),
  new RegExp(String.raw`^אפשר\s+(?:לבוא\s+ל\s*)?${TRIAL_NOUN}$`, "u"),
  new RegExp(String.raw`^${DESIRE_CUE}\s+(?:מאוד\s+)?${TRIAL_NOUN}$`, "u"),
  new RegExp(
    String.raw`^${DESIRE_CUE}\s+(?:ל|ב\s*)?(?:נסות|להירשם|להצטרף|${TRIAL_NOUN})$`,
    "u"
  ),
];

/**
 * Composable trial-signup intent on normalized text (already lowercased, punctuation stripped).
 * Does NOT apply price/address traps — callers add those via hasInfoQuestionBlock.
 */
export function matchesComposableTrialSignupIntent(t: string): boolean {
  const s = String(t ?? "").trim();
  if (!s) return false;
  if (INFO_QUESTION_OPENER.test(s)) return false;
  return COMPOSABLE_PATTERNS.some((re) => re.test(s));
}

export const TRIAL_SIGNUP_REGEX_SUMMARY = {
  TRIAL_NOUN,
  DESIRE_CUE,
  TRY_FIRST_PATTERN,
  INFO_QUESTION_OPENER: INFO_QUESTION_OPENER.source,
  COMPOSABLE_COUNT: COMPOSABLE_PATTERNS.length,
} as const;
