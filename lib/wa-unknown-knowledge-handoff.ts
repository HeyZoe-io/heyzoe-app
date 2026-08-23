import type { DetectedMessageLanguage } from "@/lib/language-detect";

/** כשאין לזואי מענה בידע — מעבירים לצוות, בלי «אין לי את הפרטים» ובלי ניחוש. */
export const UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY =
  "אני לא בטוחה שיש לי את המידע הרלוונטי, אבל אני מעבירה את הפניה לצוות ויצרו איתך קשר ממש בקרוב!";

export const UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_EN =
  "I'm not sure I have the relevant information, but I'm passing this to the team and they'll contact you very soon!";

export const UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_MODEL = "unknown_knowledge_team_handoff";

/** ניסוח ישן למועד חסר. */
export const UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_LEGACY_SLOT =
  "אין בעיה אני מעבירה את הבקשה לצוות";

/** ניסוח ישן לחריג חבילה/מחיר. */
export const UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_LEGACY_OFFER =
  "אני לא בטוחה לגבי זה, אני מעבירה את הבקשה לצוות";

const GAP_NEEDLES = [
  "אין לי את הפרטים",
  "אין לי כרגע מידע",
  "אין לי כרגע את המידע",
  "אין לי מידע",
  "אין לי את המידע",
  "לא מצאתי את המידע",
  "לא מצאתי מידע",
  "אני מתנצלת, אין לי",
  "i don't have the details",
  "i don't currently have information",
  "i don't have information",
  "i don't have the membership pricing details",
  "i couldn't find the information",
  "i could not find the information",
] as const;

function foldReply(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function matchesExactOrPrefix(text: string, needle: string): boolean {
  const t = foldReply(text);
  const n = foldReply(needle);
  return t === n || t.startsWith(n);
}

export function pickUnknownKnowledgeHandoffReply(lang: DetectedMessageLanguage): string {
  return lang === "en" ? UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_EN : UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY;
}

/** המשפט הקבוע (חדש או ישן) — כולל שיחות קיימות. */
export function assistantReplyIsUnknownKnowledgeHandoff(text: string): boolean {
  return (
    matchesExactOrPrefix(text, UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY) ||
    matchesExactOrPrefix(text, UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_EN) ||
    matchesExactOrPrefix(text, UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_LEGACY_SLOT) ||
    matchesExactOrPrefix(text, UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_LEGACY_OFFER)
  );
}

/** תשובת מודל שאומרת שאין מידע — כולל «אין לי את הפרטים» הישן. */
export function assistantReplyLooksLikeUnknownKnowledge(text: string): boolean {
  if (assistantReplyIsUnknownKnowledgeHandoff(text)) return true;
  const t = foldReply(text);
  if (!t) return false;
  const lower = t.toLowerCase();
  return GAP_NEEDLES.some((n) => lower.includes(n.toLowerCase()));
}

export function unknownKnowledgeHandoffPromptRule(): string {
  return `חוסר ידע (ברור מה שואלים ואין מידע בידע): עני רק «${UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY}» (באנגלית: «${UNKNOWN_KNOWLEDGE_TEAM_HANDOFF_REPLY_EN}»). בלי תוספת, בלי ניחוש, בלי «אין לי את הפרטים». המערכת מעבירה לצוות.`;
}
