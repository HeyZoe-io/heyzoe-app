import { isKnowledgeGapAssistantText } from "@/lib/analytics-knowledge-gaps";
import { looksLikeUnclearIntentReply } from "@/lib/wa-unclear-intent";

/** נוסח מוסכם — חוסר מידע + העברה לצוות (לא «אין בעיה» שמרמז שכבר יודעים). */
export const ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY =
  "אין לי מידע מדויק לגבי זה, אבל אני מעבירה את הבקשה לצוות שידברו איתך, סבבה?";

export const UNKNOWN_KNOWLEDGE_HANDOFF_MODEL = "unknown_knowledge_team_handoff";

/** ניסוחים ישנים — לזיהוי תשובות Claude / לוגים. */
export const LEGACY_UNKNOWN_KNOWLEDGE_HANDOFF_REPLIES = [
  "אין בעיה אני מעבירה את הבקשה לצוות",
  "אני לא בטוחה לגבי זה, אני מעבירה את הבקשה לצוות",
] as const;

export function assistantReplyIsUnknownKnowledgeHandoff(text: string): boolean {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t === ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY || t.startsWith(ZOE_UNKNOWN_KNOWLEDGE_HANDOFF_REPLY)) {
    return true;
  }
  return LEGACY_UNKNOWN_KNOWLEDGE_HANDOFF_REPLIES.some((reply) => t === reply || t.startsWith(reply));
}

/** Claude ענה חוסר ידע (כולל «אין לי את הפרטים») — להחליף לנוסח המוסכם + התראת צוות. */
export function assistantReplyNeedsUnknownKnowledgeTeamHandoff(text: string): boolean {
  if (looksLikeUnclearIntentReply(text)) return false;
  if (assistantReplyIsUnknownKnowledgeHandoff(text)) return true;
  return isKnowledgeGapAssistantText(text);
}
