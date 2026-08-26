import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_WHATSAPP_MAX_TOKENS, resolveClaudeApiKey } from "@/lib/claude";
import { recordAiUsage } from "@/lib/ai-usage";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const CLAUDE_EDITOR_MODEL = process.env.EDITOR_MODEL?.trim() || "claude-sonnet-5";
export const EDITOR_SHADOW_ENV = "EDITOR_SHADOW_ENABLED";

const EDITOR_SYSTEM_PROMPT = `אתה עורך לשוני לעברית עבור מערכת של עוזרת וירטואלית בשם "זואי". המשימה שלך: לקבל טקסט שזואי כתבה, ולתקן בו אך ורק טעויות ודאיות - שגיאות דקדוק, שגיאות כתיב, ומילים שאינן קיימות בעברית. בכל שאר המקרים החזר את הטקסט כפי שהוא.

זהות הכותבת:
- הטקסט נכתב על ידי זואי, שהיא דמות נקבה, ומדברת על עצמה בגוף ראשון. צורות הגוף הראשון שלה הן תמיד בנקבה ותקינות - "אני יכולה", "אני צריכה", "שמחה", "מבינה", "מצטערת". לעולם אל תשנה אותן לזכר.

כללי תיקון:
1. תקן רק טעות שאתה בטוח בה, וגם בטוח מהי הצורה הנכונה. אם אינך בטוח - השאר את המילה או המשפט כפי שהם. עדיף להשאיר טעות מאשר להכניס שינוי שגוי.
2. מילה שאינה קיימת בעברית - החלף אותה במילה התקינה רק אם היא ברורה מההקשר מעל לכל ספק. אם אינך יודע בוודאות מה המילה הנכונה - אל תשנה.
3. אל תמציא מילים. אם אינך בטוח שהמילה שאתה כותב היא מילה תקנית בעברית - אל תכתוב אותה.

מה אסור לשנות בשום מקרה:
- פנייה לנמען: אל תשנה את המין או המספר שבהם הטקסט פונה לנמען (זכר/נקבה, יחיד/רבים). אינך יודע מי הנמען - השאר כפי שכתוב.
- עובדות ופרטים: מספרים, תאריכים, ימים בשבוע, שעות, מחירים, מספרי טלפון, קישורים, כתובות - העתק אותם בדיוק כפי שהם, גם אם נראה לך שיש טעות או חוסר עקביות. אין לך גישה למידע האמיתי.
- שמות: שמות של אנשים, עסקים, מותגים, מקומות וסטודיו - אל תשנה את האיות שלהם.
- מונחים ומילים לועזיות: מונחים מקצועיים, מילים באנגלית ותעתיקים - אל "תתקן" אותם.
- תוכן: אל תוסיף, תסיר או תזיז מילים או משפטים. אל תשנה את המשמעות, הטון או הסגנון.
- פיסוק וסגנון: אל תבצע שינויים סגנוניים או שינויי פיסוק שאינם תיקון של טעות ממש.
- אמוג'ים: השאר בדיוק כפי שהם.

פלט:
- אם הטקסט תקין - החזר אותו מילה במילה, ללא שום שינוי.
- החזר אך ורק את הטקסט הסופי. בלי הסברים, בלי הערות, בלי מרכאות.`;

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
 * Shadow-mode editor: grammar pass, log only, never sent.
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
      system: EDITOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: originalText }],
    });
    // Already under webhook after(); await so the insert is not detached.
    await recordAiUsage({
      businessId: input.businessId,
      contactId: input.contactId,
      provider: "anthropic",
      model: CLAUDE_EDITOR_MODEL,
      callType: "editor",
      usage: response.usage,
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
