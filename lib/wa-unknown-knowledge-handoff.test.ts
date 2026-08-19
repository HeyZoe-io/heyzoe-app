import assert from "node:assert/strict";
import {
  ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY,
  assistantReplyIsUnknownKnowledgeHandoff,
} from "@/lib/wa-unknown-knowledge-handoff";

assert.match(ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY, /אין לי מידע מדויק/);
assert.match(ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY, /מעבירה את הבקשה לצוות/);

assert.equal(assistantReplyIsUnknownKnowledgeHandoff(ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY), true);
assert.equal(
  assistantReplyIsUnknownKnowledgeHandoff("אין בעיה אני מעבירה את הבקשה לצוות"),
  true
);
assert.equal(
  assistantReplyIsUnknownKnowledgeHandoff("אני לא בטוחה לגבי זה, אני מעבירה את הבקשה לצוות"),
  true
);
assert.equal(assistantReplyIsUnknownKnowledgeHandoff("כן, יש שיעור ביום שלישי"), false);

console.log("wa-unknown-knowledge-handoff.test.ts: ok");
