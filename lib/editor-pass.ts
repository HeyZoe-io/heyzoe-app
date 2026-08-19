import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_WHATSAPP_MODEL, CLAUDE_WHATSAPP_MAX_TOKENS, resolveClaudeApiKey } from "@/lib/claude";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const CLAUDE_EDITOR_MODEL = CLAUDE_WHATSAPP_MODEL;
export const EDITOR_SHADOW_ENV = "EDITOR_SHADOW_ENABLED";

const EDITOR_SYSTEM_PROMPT = `אתה עורך לשוני לעברית. המשימה שלך: לקבל טקסט ולתקן בו אך ורק טעויות דקדוק, שגיאות כתיב ומילים שאינן קיימות בעברית.

כללים מחייבים:
- תקן רק טעויות אמיתיות: התאמת מין/מספר, סמיכות, זמני פועל, שגיאות כתיב, ומילים מומצאות שאינן קיימות בעברית - החלף אותן במילה התקינה הקרובה ביותר לפי ההקשר.
- אל תשנה את המשמעות, הטון או הסגנון.
- אל תוסיף, תסיר או תסדר מחדש תוכן. אל תשנה אמוג'ים, שמות, מספרים, קישורים או פרטים.
- אם הטקסט תקין - החזר אותו כמו שהוא, ללא שינוי.
- אל תסביר, אל תוסיף הערות, אל תשתמש במרכאות. החזר אך ורק את הטקסט הסופי.`;

export function isEditorShadowEnabled(): boolean {
  const raw = process.env.EDITOR_SHADOW_ENABLED?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "yes";
}

function extractText(res: { content?: unknown[] } | null | undefined): string {
  const content = res?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b) =>
        b &&
        typeof b === "object" &&
        (b as { type?: string }).type === "text" &&
        typeof (b as { text?: string }).text === "string"
    )
    .map((b) => String((b as { text?: string }).text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Shadow-mode editor: Haiku grammar pass, log only, never sent.
 * Safe to later await inline for live mode — do not restructure.
 */
export async function runEditorPassShadow(input: {
  businessId: number;
  contactId: string | null;
  originalText: string;
}): Promise<void> {
  if (!isEditorShadowEnabled()) return;
  const originalText = String(input.originalText ?? "").trim();
  if (!originalText || !Number.isFinite(input.businessId) || input.businessId <= 0) return;

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) {
    console.warn("[editor-shadow] skipped: missing ANTHROPIC_API_KEY");
    return;
  }

  let correctedText = "";
  try {
    const client = new Anthropic({ apiKey, timeout: 8_000 });
    const response = await client.messages.create({
      model: CLAUDE_EDITOR_MODEL,
      max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
      temperature: 0.2,
      system: EDITOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: originalText }],
    });
    correctedText = extractText(response);
  } catch (e) {
    console.warn("[editor-shadow] editor call failed (not sent, not logged):", e);
    return;
  }

  if (!correctedText) {
    console.warn("[editor-shadow] empty editor response (not logged)");
    return;
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("editor_corrections").insert({
      business_id: input.businessId,
      contact_id: input.contactId,
      original_text: originalText,
      corrected_text: correctedText,
      changed: correctedText.trim() !== originalText.trim(),
      model_used: CLAUDE_EDITOR_MODEL,
    });
    if (error) {
      console.warn("[editor-shadow] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[editor-shadow] insert threw:", e);
  }
}
