import assert from "node:assert/strict";
import { WA_UNCLEAR_CLARIFY_HE } from "@/lib/wa-unclear-intent";
import {
  LEGACY_UNKNOWN_KNOWLEDGE_HANDOFF_REPLIES,
  ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY,
  assistantReplyIsUnknownKnowledgeHandoff,
  assistantReplyNeedsUnknownKnowledgeTeamHandoff,
} from "@/lib/wa-unknown-knowledge-handoff";

assert.match(ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY, /אין לי מידע מדויק/);
assert.match(ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY, /מעבירה את הבקשה לצוות/);

assert.equal(assistantReplyIsUnknownKnowledgeHandoff(ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY), true);
for (const legacy of LEGACY_UNKNOWN_KNOWLEDGE_HANDOFF_REPLIES) {
  assert.equal(assistantReplyIsUnknownKnowledgeHandoff(legacy), true, legacy);
}
assert.equal(assistantReplyIsUnknownKnowledgeHandoff("כן, יש שיעור ביום שלישי"), false);

assert.equal(
  assistantReplyNeedsUnknownKnowledgeTeamHandoff(
    "אין לי את הפרטים על מדיניות הביטול. יש עוד משהו שאני יכולה לעזור לך איתו?"
  ),
  true
);
assert.equal(assistantReplyNeedsUnknownKnowledgeTeamHandoff(WA_UNCLEAR_CLARIFY_HE), false);
assert.equal(assistantReplyNeedsUnknownKnowledgeTeamHandoff("כן, יש שיעור ביום שלישי"), false);

console.log("wa-unknown-knowledge-handoff.test.ts: ok");
