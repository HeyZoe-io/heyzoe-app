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
  String.raw`(?:אשמח|נשמח|מעוניין|מעוניינת|מתעניין|מתעניינת|רוצ(?:ה|ים|ה)|אפשר(?:\s+לבוא\s+ל)?)`;

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
 * Composable trial-signup intent.
 * Does NOT apply price/address traps — callers add those via hasInfoQuestionBlock.
 */
export function matchesComposableTrialSignupIntent(raw: string): boolean {
  const s = normalizeTrialSignupIntentText(raw);
  if (!s) return false;
  if (INFO_QUESTION_OPENER.test(s)) return false;
  if (ANCHORED_PATTERNS.some((re) => re.test(s))) return true;
  return RELAXED_DESIRE_TRIAL.test(s);
}

export const TRIAL_SIGNUP_REGEX_SUMMARY = {
  TRIAL_NOUN,
  DESIRE_CUE,
  TRY_FIRST_PATTERN,
  RELAXED_DESIRE_TRIAL: RELAXED_DESIRE_TRIAL.source,
  INFO_QUESTION_OPENER: INFO_QUESTION_OPENER.source,
  ANCHORED_COUNT: ANCHORED_PATTERNS.length,
} as const;
