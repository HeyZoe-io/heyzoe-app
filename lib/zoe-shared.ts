/** ייחוס לוגי ל-UI/דיבוג; ה-API משתמש ב-GEMINI_CHAT_MODELS ב-lib/gemini.ts */
export const MODEL_NAME = "gemini-2.5-flash";

/** סיומת סטרימינג ב-/api/chat — אחריה JSON עם cta_text, cta_link */
export const CHAT_STREAM_META = "\n\n__HEYZOE_META__\n";

export function stripMarkdownDecorations(text: string): string {
  return text
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}
