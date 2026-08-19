import assert from "node:assert/strict";
import {
  matchesComposableTrialSignupIntent,
  TRIAL_SIGNUP_REGEX_SUMMARY,
} from "@/lib/wa-trial-signup-intent";
import { isJoinSignupIntentText, isWarmupSkipIntentText } from "@/lib/wa-warmup-skip-intent";
import { matchesTrialTopicAdvanceIntent, matchesTrialTopicIntent } from "@/lib/wa-trial-topic-intent";
import { normalizeSalesFlowGreetingToken } from "@/lib/sales-flow-start-triggers";

/** Document exported regex building blocks (for review / PR). */
assert.ok(TRIAL_SIGNUP_REGEX_SUMMARY.TRIAL_NOUN.includes("ני?סיון"));
assert.ok(TRIAL_SIGNUP_REGEX_SUMMARY.DESIRE_CUE.includes("אשמח"));

/** Case 1 — info questions: topic yes, no skip/advance (Claude + warmup resend). */
const infoNegatives = [
  "מה זה אימון היכרות?",
  "מה כולל שיעור ניסיון?",
];
for (const phrase of infoNegatives) {
  assert.equal(matchesTrialTopicIntent(phrase), true, `topic: ${phrase}`);
  assert.equal(matchesTrialTopicAdvanceIntent(phrase), false, `no advance: ${phrase}`);
  assert.equal(isWarmupSkipIntentText(phrase, "warmup"), false, `no warmup skip: ${phrase}`);
  assert.equal(isJoinSignupIntentText(phrase), false, `no join signup: ${phrase}`);
}

/** Case 3 — price + trial noun: info trap, no jump. */
assert.equal(isWarmupSkipIntentText("כמה עולה שיעור ניסיון?", "warmup"), false);
assert.equal(isJoinSignupIntentText("כמה עולה שיעור ניסיון?"), false);
assert.equal(matchesTrialTopicAdvanceIntent("כמה עולה שיעור ניסיון?"), false);
assert.equal(matchesTrialTopicIntent("כמה עולה שיעור ניסיון?"), true);

/** Case 2 + approved phrasing list — desire cue + trial noun → signup path. */
const mustSignup = [
  "אשמח לשיעור ניסיון",
  "אשמח לשיעור נסיון",
  "מעוניין בשיעור ניסיון",
  "מעוניינת בשיעור ניסיון",
  "מתעניין בשיעור ניסיון",
  "מתעניינת בשיעור ניסיון",
  "אשמח לנסות קודם",
  "אשמח לאימון ניסיון",
  "אפשר לבוא לשיעור ניסיון",
  "אפשר שיעור ניסיון",
  "רוצה שיעור ניסיון",
  "שיעור ניסיון",
  "רוצה אימון היכרות",
  "אשמח לשיעור הכרות",
  "אימון ניסיון",
  "אימון היכרות",
  "שיעור הכרות",
  "אימון נסיון",
  "אשמח לאימון היכרות",
];
for (const phrase of mustSignup) {
  const t = normalizeSalesFlowGreetingToken(phrase);
  assert.equal(matchesComposableTrialSignupIntent(t), true, `composable: ${phrase}`);
  assert.equal(
    isWarmupSkipIntentText(phrase, "warmup") || isJoinSignupIntentText(phrase),
    true,
    `signup path: ${phrase}`
  );
}

/** Legacy traps unchanged. */
assert.equal(isWarmupSkipIntentText("רוצה להתחיל", "opening"), false);
assert.equal(isWarmupSkipIntentText("כמה עולה להירשם?", "warmup"), false);
assert.equal(isJoinSignupIntentText("אני רוצה לבטל את ההרשמה"), false);

console.log("wa-trial-signup-intent.test.ts: ok");
console.log(JSON.stringify(TRIAL_SIGNUP_REGEX_SUMMARY, null, 2));
