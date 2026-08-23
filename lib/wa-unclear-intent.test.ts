import assert from "node:assert/strict";
import {
  WA_UNCLEAR_CLARIFY_HE,
  WA_UNCLEAR_HANDOFF_HE,
  inboundLooksLikeClearKnowledgeQuestion,
  isUnclearClarifyAsk,
  isUnclearHandoffAsk,
  looksLikeUnclearIntentReply,
  pickUnclearIntentReply,
  resolveUnclearIntentAction,
  sessionHasUnclearClarifyAsk,
} from "@/lib/wa-unclear-intent";

assert.equal(isUnclearClarifyAsk(WA_UNCLEAR_CLARIFY_HE), true);
assert.equal(isUnclearClarifyAsk("לא בטוחה שהבנתי. אפשר לנסות לנסח לי מחדש."), true);
assert.equal(isUnclearClarifyAsk(WA_UNCLEAR_HANDOFF_HE), false);
assert.equal(isUnclearHandoffAsk(WA_UNCLEAR_HANDOFF_HE), true);

assert.equal(looksLikeUnclearIntentReply(WA_UNCLEAR_CLARIFY_HE), true);
assert.equal(looksLikeUnclearIntentReply("אין לי את הפרטים על מדיניות הביטול."), false);
assert.equal(
  looksLikeUnclearIntentReply("לא הבנתי נכון? המחיר הוא 200 שח ורוצים להירשם לניסיון עכשיו?"),
  false
);

assert.equal(resolveUnclearIntentAction(WA_UNCLEAR_CLARIFY_HE, []), "clarify");
assert.equal(
  resolveUnclearIntentAction(WA_UNCLEAR_CLARIFY_HE, [
    { role: "assistant", content: WA_UNCLEAR_CLARIFY_HE },
    { role: "user", content: "asdfg" },
  ]),
  "handoff"
);
assert.equal(sessionHasUnclearClarifyAsk([{ role: "user", content: "היי" }]), false);
assert.equal(pickUnclearIntentReply("clarify", "he"), WA_UNCLEAR_CLARIFY_HE);
assert.equal(pickUnclearIntentReply("handoff", "he"), WA_UNCLEAR_HANDOFF_HE);

assert.equal(
  inboundLooksLikeClearKnowledgeQuestion(
    "הי, יש מצב שאני אעביר קצת שיעורים מחודש הבא לחודש הזה?"
  ),
  true
);
assert.equal(inboundLooksLikeClearKnowledgeQuestion("היי"), false);
assert.equal(inboundLooksLikeClearKnowledgeQuestion("asdfghjklqwerty"), false);
assert.equal(inboundLooksLikeClearKnowledgeQuestion("יש מצב שנדבר מחר?"), false);

console.log("wa-unclear-intent.test.ts: ok");
