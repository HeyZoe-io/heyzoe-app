import assert from "node:assert/strict";
import { lookupKnowledgeQaAnswerForInbound, relatedPhrasingsForQuestion } from "@/lib/knowledge-qa";
import {
  isExistingTrialEnrollmentMention,
  matchesTrialTopicAdvanceIntent,
  matchesTrialTopicIntent,
} from "@/lib/wa-trial-topic-intent";
import { isJoinSignupIntentText, isWarmupSkipIntentText } from "@/lib/wa-warmup-skip-intent";

assert.equal(matchesTrialTopicIntent("רוצה אימון הכרות"), true);
assert.equal(matchesTrialTopicIntent("רוצה אימון היכרות"), true);
assert.equal(matchesTrialTopicIntent("מה זה אימון הכרות?"), true);
assert.equal(matchesTrialTopicIntent("יש אימוני ניסיון?"), true);
assert.equal(matchesTrialTopicIntent("אפשר אימון ניסיון?"), true);
assert.equal(matchesTrialTopicIntent("כמה עולה השיעור?"), false);

const liahExistingTrial =
  "כן פשוט אני ומיה אלקיים נרשמנו ביחד לאימוני ניסיון ולה לא הייתה את הבעיה הזאת של להירשם";
assert.equal(isExistingTrialEnrollmentMention(liahExistingTrial), true);
assert.equal(matchesTrialTopicIntent(liahExistingTrial), false);
assert.equal(matchesTrialTopicAdvanceIntent(liahExistingTrial), false);
assert.equal(matchesTrialTopicIntent("נרשמתי לאימון ניסיון ולא נותן לי להירשם"), false);

assert.equal(matchesTrialTopicAdvanceIntent("רוצה אימון הכרות"), true);
assert.equal(matchesTrialTopicAdvanceIntent("מה זה אימון היכרות"), false);
assert.equal(matchesTrialTopicAdvanceIntent("כמה עולה אימון היכרות"), false);

assert.equal(isWarmupSkipIntentText("רוצה אימון היכרות", "opening"), true);
assert.equal(isWarmupSkipIntentText("רוצה אימון הכרות", "warmup"), true);
assert.equal(isWarmupSkipIntentText("אפשר אימון היכרות", "opening"), true);
assert.equal(isJoinSignupIntentText("רוצה אימון היכרות"), true);
assert.equal(isJoinSignupIntentText("רוצה אימון הכרות"), true);

const hkVariants = relatedPhrasingsForQuestion("אימון ניסיון");
assert.ok(hkVariants.includes("אימון הכרות"), `expected הכרות synonym, got ${hkVariants.join(", ")}`);

const qaHit = lookupKnowledgeQaAnswerForInbound(
  [{ question: "אימון ניסיון", answer: '״80 ₪ לשני אימוני היכרות״' }],
  "מה זה אימון הכרות?"
);
assert.equal(qaHit?.question, "אימון ניסיון");

console.log("wa-trial-topic-intent.test.ts: ok");
