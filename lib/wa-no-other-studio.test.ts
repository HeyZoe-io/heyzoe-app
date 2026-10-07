import assert from "node:assert/strict";
import { KNOWLEDGE_GAP_NO_DETAILS_HE } from "@/lib/analytics-knowledge-gaps";
import { applyKnownAssistantReplyFixes } from "@/lib/wa-assistant-reply-fixes";
import { assistantReplyRecommendsAnotherStudio } from "@/lib/wa-no-other-studio";

assert.equal(
  assistantReplyRecommendsAnotherStudio("אולי תנסי בסטודיו אחר בשכונה"),
  true
);
assert.equal(
  assistantReplyRecommendsAnotherStudio("אני ממליצה על סטודיו פילאטיס ברחוב הרצל"),
  true
);
assert.equal(
  assistantReplyRecommendsAnotherStudio("יש סטודיו בשם תנועה שנמצא קרוב אלייך"),
  true
);
assert.equal(
  assistantReplyRecommendsAnotherStudio("You could try another studio nearby"),
  true
);
assert.equal(
  assistantReplyRecommendsAnotherStudio("אין לנו סטודיו אחר, רק הסניף הזה"),
  false
);
assert.equal(
  assistantReplyRecommendsAnotherStudio("אני ממליצה על הסטודיו שלנו, יש יוגה ומזרן"),
  false
);
assert.equal(
  assistantReplyRecommendsAnotherStudio("הסטודיו שלנו ברחוב הרצל 12"),
  false
);
assert.equal(
  assistantReplyRecommendsAnotherStudio("כדאי להגיע לסטודיו ביום ראשון בשמונה"),
  false
);
assert.equal(
  assistantReplyRecommendsAnotherStudio("אני ממליצה על הסטודיו שלנו", "סטודיו תנועה"),
  false
);

const rewritten = applyKnownAssistantReplyFixes("אולי תנסי בסטודיו אחר", {
  knowledge: null,
});
assert.equal(rewritten, KNOWLEDGE_GAP_NO_DETAILS_HE);

const kept = applyKnownAssistantReplyFixes("הסטודיו שלנו ברחוב הרצל.", {
  knowledge: null,
});
assert.match(kept, /הרצל/);

console.log("wa-no-other-studio.test.ts: ok");
