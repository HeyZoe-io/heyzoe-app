import assert from "node:assert/strict";
import {
  matchesComposableTrialSignupIntent,
  trialSignupAckForInbound,
  TRIAL_SIGNUP_INTENT_ACK_HE,
  TRIAL_SIGNUP_REGEX_SUMMARY,
} from "@/lib/wa-trial-signup-intent";
import { isJoinSignupIntentText, isWarmupSkipIntentText, shouldStartSalesFlowFromOutOfFlowSignup } from "@/lib/wa-warmup-skip-intent";
import { matchesTrialTopicAdvanceIntent, matchesTrialTopicIntent } from "@/lib/wa-trial-topic-intent";

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

/** Case 2 — wrapped phrasing (greeting / emoji / trailing polite word). */
const wrappedSignup = [
  "היי, אשמח לשיעור ניסיון",
  "היי אשמח לשיעור ניסיון 🙏",
  "שלום, רוצה שיעור ניסיון בבקשה",
  "היי, יש אימון ניסיון?",
];
for (const phrase of wrappedSignup) {
  assert.equal(matchesComposableTrialSignupIntent(phrase), true, `wrapped composable: ${phrase}`);
  assert.equal(isWarmupSkipIntentText(phrase, "warmup"), true, `wrapped warmup: ${phrase}`);
  assert.equal(isJoinSignupIntentText(phrase), true, `wrapped join: ${phrase}`);
}

/** Wrapped negatives — info/price must stay false. */
const wrappedNegatives = [
  "היי, מה זה אימון היכרות?",
  "היי כמה עולה שיעור ניסיון?",
];
for (const phrase of wrappedNegatives) {
  assert.equal(matchesComposableTrialSignupIntent(phrase), false, `wrapped neg composable: ${phrase}`);
  assert.equal(isWarmupSkipIntentText(phrase, "warmup"), false, `wrapped neg warmup: ${phrase}`);
  assert.equal(isJoinSignupIntentText(phrase), false, `wrapped neg join: ${phrase}`);
}

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
  "יש אימון ניסיון",
  "יש שיעור ניסיון",
];
for (const phrase of mustSignup) {
  assert.equal(matchesComposableTrialSignupIntent(phrase), true, `composable: ${phrase}`);
  assert.equal(
    isWarmupSkipIntentText(phrase, "warmup") || isJoinSignupIntentText(phrase),
    true,
    `signup path: ${phrase}`
  );
}

/** Class interest (no trial noun) — start product pick, not Claude chat. */
const sangaClassInterest = "היי\nאני מתעניינת בשיעורי יוגה למתחילות";
assert.equal(isJoinSignupIntentText(sangaClassInterest), true, "sanga class interest is join-signup");
assert.equal(isWarmupSkipIntentText(sangaClassInterest, "warmup"), true, "sanga class interest skips warmup");
assert.equal(
  shouldStartSalesFlowFromOutOfFlowSignup({
    inbound: sangaClassInterest,
    salesFlowStarted: false,
    trialRegistered: false,
    sessionPhase: null,
  }),
  true,
  "sanga class interest must enter product pick"
);
assert.equal(isJoinSignupIntentText("מחפשת שיעור יוגה"), true);
assert.equal(isJoinSignupIntentText("כמה עולה שיעור יוגה למתחילות?"), false);
assert.equal(isJoinSignupIntentText("מתי יש שיעורי יוגה?"), false);

/** Limitless: book a named trial class — not a price FAQ. */
const noaBookPilates =
  "היי אני אשמח לתאם שיעור נסיון פילאטיס מכשירים בשישי בעשר  :)";
assert.equal(matchesComposableTrialSignupIntent(noaBookPilates), true, "noa composable");
assert.equal(matchesTrialTopicAdvanceIntent(noaBookPilates), true, "noa advance");
assert.equal(matchesTrialTopicIntent(noaBookPilates), true, "noa topic");

/** Limitless: want to come to a trial — not the trial-price FAQ. */
const limitlessComeSaturday =
  "היי🌸 קיבלתי את המספר שלכן מאחת המתאמנות, הייתי רוצה להגיע לאימון ניסיון במוצ״ש, האם זאת אפשרות?";
assert.equal(
  matchesComposableTrialSignupIntent(limitlessComeSaturday),
  true,
  "come-to-trial is signup, not price FAQ"
);
assert.equal(isJoinSignupIntentText(limitlessComeSaturday), true, "come-to-trial is join-signup");
assert.equal(
  matchesTrialTopicAdvanceIntent(limitlessComeSaturday),
  true,
  "come-to-trial advances past warmup/FAQ"
);
assert.equal(
  shouldStartSalesFlowFromOutOfFlowSignup({
    inbound: limitlessComeSaturday,
    salesFlowStarted: false,
    trialRegistered: false,
    sessionPhase: null,
  }),
  true,
  "come-to-trial must enter product pick"
);
assert.equal(trialSignupAckForInbound(limitlessComeSaturday), TRIAL_SIGNUP_INTENT_ACK_HE);
assert.equal(isWarmupSkipIntentText(limitlessComeSaturday, "opening"), true);
assert.equal(isWarmupSkipIntentText(limitlessComeSaturday, "warmup"), true);
assert.equal(matchesComposableTrialSignupIntent("הייתי רוצה להגיע לאימון ניסיון"), true);
assert.equal(matchesComposableTrialSignupIntent("רוצה להגיע לשיעור ניסיון"), true);
assert.equal(matchesComposableTrialSignupIntent("רוצה להירשם לשיעור ניסיון"), true);
assert.equal(matchesComposableTrialSignupIntent("האם אפשר להגיע לאימון ניסיון במוצ״ש?"), true);
assert.equal(trialSignupAckForInbound("כמה עולה שיעור ניסיון?"), null);
assert.equal(trialSignupAckForInbound("מה זה אימון ניסיון?"), null);

/** Legacy traps unchanged. */
assert.equal(isWarmupSkipIntentText("רוצה להתחיל", "opening"), false);
assert.equal(isWarmupSkipIntentText("כמה עולה להירשם?", "warmup"), false);
assert.equal(isJoinSignupIntentText("אני רוצה לבטל את ההרשמה"), false);

console.log("wa-trial-signup-intent.test.ts: ok");
console.log(JSON.stringify(TRIAL_SIGNUP_REGEX_SUMMARY, null, 2));
