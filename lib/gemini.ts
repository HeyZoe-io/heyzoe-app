import { stripMarkdownDecorations } from "@/lib/zoe-shared";

/** * רשימת המודלים לצ'אט בסדר עדיפות.
 * הוספנו את הקידומת models/ כדי לפתור את שגיאת ה-404 ב-v1beta.
 */
export const GEMINI_CHAT_MODELS = [
  "models/gemini-1.5-flash",
  "models/gemini-1.5-pro",
  "models/gemini-2.0-flash-exp"
] as const;

/** סדר המודלים לטעינת נתוני העסק (Bootstrap) */
export const GEMINI_BOOTSTRAP_MODELS = [
  "models/gemini-1.5-flash",
  "models/gemini-1.5-pro",
  "models/gemini-2.0-flash-exp"
] as const;

/** זמני המתנה בין ניסיונות חוזרים במקרה של עומס (במילישניות) */
export const GEMINI_RETRY_DELAYS_MS = [800, 2000, 4500] as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** בודק אם השגיאה קשורה למכסה או עומס של גוגל */
export function isGeminiQuotaOrRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|RESOURCE_EXHAUSTED|Too Many Requests|quota exceeded|exceeded your current quota|rate limit/i.test(
    msg
  );
}

/** פונקציית עזר להרצת מודל עם מנגנון גיבוי (Fallback) */
export async function generateWithModelFallback(
  models: readonly string[],
  run: (modelName: string) => Promise<{ text: () => string }>
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < models.length; i++) {
    const name = models[i];
    try {
      const responseLike = await run(name);
      return stripMarkdownDecorations(responseLike.text().trim());
    } catch (e) {
      lastErr = e;
      const canRetry = isGeminiQuotaOrRateLimitError(e) && i < models.length - 1;
      if (canRetry) {
        console.warn(`[HeyZoe Gemini] ${name} נכשל (מכסה/קצב?), מנסה את המודל הבא: ${models[i + 1]}…`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** הודעת שגיאה ידידותית למשתמש במקרה של כשל סופי */
export function friendlyGeminiErrorMessage(e: unknown): string {
  if (isGeminiQuotaOrRateLimitError(e)) {
    return "רגע קצר — יש עומס על שירות ה-AI. נסו שוב בעוד דקה.";
  }
  return "משהו השתבש בזמן התשובה. נסו שוב בעוד רגע.";
}

/** גרסה של Fallback ששומרת על הטקסט הגולמי (חשוב ל-JSON) */
export async function generateRawWithModelFallback(
  models: readonly string[],
  run: (modelName: string) => Promise<{ text: () => string }>
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < models.length; i++) {
    const name = models[i];
    try {
      const responseLike = await run(name);
      return responseLike.text().trim();
    } catch (e) {
      lastErr = e;
      const canRetry = isGeminiQuotaOrRateLimitError(e) && i < models.length - 1;
      if (canRetry) {
        console.warn(`[HeyZoe Gemini] ${name} נכשל, מנסה את המודל הבא…`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}