import assert from "node:assert/strict";
import {
  WA_UNCLEAR_CLARIFY_EN,
  WA_UNCLEAR_CLARIFY_HE,
  WA_UNCLEAR_HANDOFF_HE,
} from "@/lib/wa-unclear-intent";
import {
  buildOffTopicStudioFallbackReply,
  buildOffTopicStudioFallbackReplyEn,
  buildOffTopicStudioPromptRule,
} from "@/lib/wa-off-topic-fallback";

assert.equal(buildOffTopicStudioFallbackReply("03-1234567"), WA_UNCLEAR_CLARIFY_HE);
assert.equal(buildOffTopicStudioFallbackReply(""), WA_UNCLEAR_CLARIFY_HE);
assert.equal(buildOffTopicStudioFallbackReplyEn("03-1234567"), WA_UNCLEAR_CLARIFY_EN);

const rule = buildOffTopicStudioPromptRule("050-1111111");
assert.match(rule, /קודם כל/);
assert.match(rule, /על העסק/);
assert.match(rule, /חוסר ידע רגיל/);
assert.match(rule, /אל תשתפי פעולה/);
assert.match(rule, /סימולציה/);
assert.match(rule, new RegExp(WA_UNCLEAR_CLARIFY_HE.replace(/[?]/g, "\\?")));
assert.match(rule, new RegExp(WA_UNCLEAR_HANDOFF_HE.replace(/[?]/g, "\\?")));
assert.doesNotMatch(rule, /עני רק על נושאים/);

console.log("wa-off-topic-fallback.test.ts: ok");
