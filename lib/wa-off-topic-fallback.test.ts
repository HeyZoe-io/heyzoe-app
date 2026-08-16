import assert from "node:assert/strict";
import {
  buildOffTopicStudioFallbackReply,
  buildOffTopicStudioFallbackReplyEn,
  buildOffTopicStudioPromptRule,
} from "@/lib/wa-off-topic-fallback";

assert.equal(
  buildOffTopicStudioFallbackReply("03-1234567"),
  "אני לא בטוחה שהבנתי. אפשר לנסות לנסח לי מחדש, או ליצור קשר עם שירות הלקוחות שלנו 03-1234567"
);
assert.equal(buildOffTopicStudioFallbackReply(""), "אני לא בטוחה שהבנתי. אפשר לנסות לנסח לי מחדש.");
assert.equal(
  buildOffTopicStudioFallbackReplyEn("03-1234567"),
  "I'm not sure I understood. You can try rephrasing, or contact our customer service at 03-1234567"
);

const rule = buildOffTopicStudioPromptRule("050-1111111");
assert.match(rule, /קודם כל/);
assert.match(rule, /על העסק/);
assert.match(rule, /חוסר ידע רגיל/);
assert.match(rule, /אל תשתפי פעולה/);
assert.match(rule, /050-1111111/);
assert.match(rule, /סימולציה/);
assert.doesNotMatch(rule, /עני רק על נושאים/);

console.log("wa-off-topic-fallback.test.ts: ok");
