import assert from "node:assert/strict";
import {
  isKnowledgeGapAssistantText,
  parseMessageUuid,
} from "@/lib/analytics-knowledge-gaps";
import { UNKNOWN_CLASS_SLOT_HANDOFF_MODEL } from "@/lib/wa-unknown-class-slot";
import { UNKNOWN_OFFER_POLICY_HANDOFF_MODEL } from "@/lib/wa-unknown-offer-policy";

assert.equal(parseMessageUuid("73149a89-228e-4e53-b0b7-1a806e4cf3a0"), "73149a89-228e-4e53-b0b7-1a806e4cf3a0");
assert.equal(parseMessageUuid("73149A89-228E-4E53-B0B7-1A806E4CF3A0"), "73149a89-228e-4e53-b0b7-1a806e4cf3a0");
assert.equal(parseMessageUuid(12345), "");
assert.equal(parseMessageUuid("not-a-uuid"), "");
assert.equal(Number("73149a89-228e-4e53-b0b7-1a806e4cf3a0"), NaN);

assert.equal(isKnowledgeGapAssistantText("אין לי את הפרטים על מדיניות הביטול."), true);
assert.equal(
  isKnowledgeGapAssistantText("אין לי כרגע את המידע על מחירי המנויים. מוזמנים לפנות לשירות הלקוחות."),
  true
);
assert.equal(
  isKnowledgeGapAssistantText("I don't have the membership pricing details right now."),
  true
);
assert.equal(isKnowledgeGapAssistantText("אין בעיה אני מעבירה את הבקשה לצוות"), false);
assert.equal(
  isKnowledgeGapAssistantText("אין בעיה אני מעבירה את הבקשה לצוות", UNKNOWN_CLASS_SLOT_HANDOFF_MODEL),
  true
);
assert.equal(
  isKnowledgeGapAssistantText(
    "אני לא בטוחה לגבי זה, אני מעבירה את הבקשה לצוות",
    UNKNOWN_OFFER_POLICY_HANDOFF_MODEL
  ),
  true
);
assert.equal(
  isKnowledgeGapAssistantText("אין לי את הפרטים", "claude_limit_24h"),
  false
);
assert.equal(isKnowledgeGapAssistantText("שלום! אימון ניסיון עולה 30 שח"), false);

console.log("analytics-knowledge-gaps.test.ts: ok");
