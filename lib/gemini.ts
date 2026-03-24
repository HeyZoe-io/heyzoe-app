import { GoogleGenerativeAIFetchError } from "@google/generative-ai";

/**
 * מזהים יציבים — בלי קידומת `models/` (ה-SDK מוסיף אותה).
 * סדר: 1.5-latest ראשון, אז 1.5, אז 2.0 (ללא gemini-2.5).
 */
export const GEMINI_CHAT_MODELS = [
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash",
  "gemini-2.0-flash",
] as const;

export const GEMINI_BOOTSTRAP_MODELS = [
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash",
  "gemini-2.0-flash",
] as const;

/** חובה v1 — לא v1beta (ברירת מחדל SDK); מפחית 404/חוסר עקביות בשמות מודל */
export const GEMINI_API_VERSION = "v1" as const;

/** ארגומנט שני ל-getGenerativeModel — אותה גרסת API בכל המודלים */
export const GEMINI_MODEL_INIT_OPTIONS = { apiVersion: GEMINI_API_VERSION } as const;

/** timeout ל-generateContent (bootstrap) — לא לסטרים ארוכים ב-chat */
export const GEMINI_BOOTSTRAP_GENERATE_TIMEOUT_MS = 55_000 as const;

export const GEMINI_RETRY_DELAYS_MS = [700, 1600] as const;

/** צ'אט: המתנה ארוכה יותר אחרי 429 / RESOURCE_EXHAUSTED לפני ניסיון חוזר */
export const GEMINI_CHAT_QUOTA_RETRY_DELAYS_MS = [2500, 8000] as const;

/** צ'אט: הפסקה בין מודלים אחרי כשל retry-able (למנוע רצף בקשות שמחמיר quota) */
export const GEMINI_CHAT_COOLDOWN_BETWEEN_MODELS_MS = 2000 as const;

export const GEMINI_BOOTSTRAP_RETRY_DELAYS_MS = [400, 1000] as const;

/** ה-SDK מוסיף "models/" בעצמו; מנרמלים כדי למנוע models/models/... */
export function normalizeModelName(modelName: string): string {
  return modelName.replace(/^models\//, "").trim();
}

export function isRetryableGeminiError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|Too Many Requests|quota|rate limit/i.test(msg);
}

/** עומס מכסה / RPM — backoff חזק יותר מ-503 כללי */
export function isQuotaOrRateLimitError(error: unknown): boolean {
  if (error instanceof GoogleGenerativeAIFetchError && error.status === 429) {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /429|RESOURCE_EXHAUSTED|quota|rate limit|Too Many Requests/i.test(msg);
}

/** מודל לא קיים / לא זמין ב-endpoint — לא לבזבז backoff, לעבור למודל הבא */
export function isImmediateModelSwitchError(error: unknown): boolean {
  if (error instanceof GoogleGenerativeAIFetchError) {
    if (error.status === 404) return true;
    if (error.status === 400 && /model|not found|invalid|unsupported/i.test(error.message)) {
      return true;
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/\[404 Not Found\]|404 Not Found|\b404\b.*model|models\/.*not found/i.test(msg)) {
    return true;
  }
  return false;
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

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** פונקציית עזר שמנסה מודלים ברצף עם retry בסיסי לשגיאות עומס */
export async function generateRawWithModelFallback<T>(
  modelNames: readonly string[],
  handler: (modelName: string) => Promise<T>,
  retryDelays: readonly number[] = GEMINI_RETRY_DELAYS_MS
): Promise<T> {
  let lastError: unknown = null;

  for (const rawModelName of modelNames) {
    const modelName = normalizeModelName(rawModelName);
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        console.log(`[Gemini] Attempting model: ${modelName} (try ${attempt + 1})`);
        return await handler(modelName);
      } catch (err) {
        lastError = err;
        if (isImmediateModelSwitchError(err)) {
          console.warn(
            `[Gemini] Model unavailable, trying next (no retry backoff): ${modelName}`,
            err instanceof Error ? err.message : err
          );
          break;
        }
        const canRetry = isRetryableGeminiError(err) && attempt < retryDelays.length;
        if (canRetry) {
          await sleepMs(retryDelays[attempt]);
          continue;
        }
        break;
      }
    }
  }

  throw (lastError ?? new Error("All Gemini models failed"));
}