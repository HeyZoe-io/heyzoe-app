import assert from "node:assert/strict";
import {
  UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY,
  UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_EN,
  UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_LEGACY_OFFER,
  UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_LEGACY_SLOT,
  assistantReplyIsUnknownKnowledgeHandoff,
  assistantReplyLooksLikeUnknownKnowledge,
  pickUnknownKnowledgeHandoffReply,
} from "@/lib/wa-unknown-knowledge-handoff";

assert.equal(
  UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY,
  "אני לא בטוחה שיש לי את המידע הרלוונטי, אבל אני מעבירה את הפניה לצוות ויצרו איתך קשר ממש בקרוב!"
);

assert.equal(pickUnknownKnowledgeHandoffReply("he"), UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY);
assert.equal(pickUnknownKnowledgeHandoffReply("en"), UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_EN);
assert.equal(pickUnknownKnowledgeHandoffReply("unknown"), UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY);

assert.equal(assistantReplyIsUnknownKnowledgeHandoff(UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY), true);
assert.equal(assistantReplyIsUnknownKnowledgeHandoff(UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_EN), true);
assert.equal(assistantReplyIsUnknownKnowledgeHandoff(UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_LEGACY_SLOT), true);
assert.equal(assistantReplyIsUnknownKnowledgeHandoff(UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_LEGACY_OFFER), true);
assert.equal(assistantReplyIsUnknownKnowledgeHandoff("אין לי את הפרטים"), false);

assert.equal(assistantReplyLooksLikeUnknownKnowledge("אין לי את הפרטים על מדיניות הביטול."), true);
assert.equal(assistantReplyLooksLikeUnknownKnowledge(UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY), true);
assert.equal(assistantReplyLooksLikeUnknownKnowledge("שלום! אימון ניסיון עולה 30 שח"), false);

console.log("wa-unknown-knowledge-handoff.test.ts: ok");
