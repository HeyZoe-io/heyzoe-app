export const GEMINI_CHAT_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"] as const;

export const GEMINI_BOOTSTRAP_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"] as const;

export const GEMINI_RETRY_DELAYS_MS = [700, 1600] as const;

/** ה-SDK מוסיף "models/" בעצמו; מנרמלים כדי למנוע models/models/... */
export function normalizeModelName(modelName: string): string {
  return modelName.replace(/^models\//, "").trim();
}

export function isRetryableGeminiError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|Too Many Requests|quota|rate limit/i.test(msg);
}

/** הודעה קצרה וידידותית למשתמש — בלי פרטי שגיאה גולמיים ששוברים עיצוב */
export function formatUserFacingGeminiError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/429|RESOURCE_EXHAUSTED|quota|rate limit|Too Many Requests/i.test(msg)) {
    return "יש עומס רגעי על השירות. נסו שוב בעוד דקה — זואי תשמח לענות.";
  }
  if (/503|UNAVAILABLE|overloaded|deadline|timeout/i.test(msg)) {
    return "השירות זמנית לא זמין. נסו שוב בעוד רגע.";
  }
  return "משהו השתבש בחיבור. נסו שוב בעוד רגע — אנחנו כאן.";
}

/** תגובת HTTP מה-API שלנו (לא סטרים) */
export function friendlyHttpErrorMessage(status: number): string {
  if (status === 429) {
    return "יש עומס רגעי. נסו שוב בעוד דקה — זואי תשמח לעזור.";
  }
  if (status >= 500) {
    return "השרת עמוס זמנית. נסו שוב בעוד רגע.";
  }
  if (status === 408) {
    return "הבקשה ארכה יותר מדי. נסו שוב.";
  }
  if (status >= 400) {
    return "לא הצלחנו לשלוח את ההודעה. בדקו את החיבור ונסו שוב.";
  }
  return "משהו השתבש. נסו שוב בעוד רגע.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** פונקציית עזר שמנסה מודלים ברצף עם retry בסיסי לשגיאות עומס */
export async function generateRawWithModelFallback<T>(
  modelNames: readonly string[],
  handler: (modelName: string) => Promise<T>
): Promise<T> {
  let lastError: unknown = null;

  for (const rawModelName of modelNames) {
    const modelName = normalizeModelName(rawModelName);
    for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
      try {
        console.log(`[Gemini] Attempting model: ${modelName} (try ${attempt + 1})`);
        return await handler(modelName);
      } catch (err) {
        lastError = err;
        const canRetry = isRetryableGeminiError(err) && attempt < GEMINI_RETRY_DELAYS_MS.length;
        if (canRetry) {
          await sleep(GEMINI_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        break;
      }
    }
  }

  throw (lastError ?? new Error("All Gemini models failed"));
}