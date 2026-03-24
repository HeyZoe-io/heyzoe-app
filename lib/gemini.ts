import { GoogleGenerativeAIFetchError } from "@google/generative-ai";

/**
 * מזהים יציבים — בלי קידומת `models/` (ה-SDK מוסיף אותה).
 * Primary: gemini-1.5-flash (Tier 1). Fallbacks: pro, then experimental 2.0.
 * Order matters: try each model once per "failure to advance" except transient retries (429/503).
 */
export const GEMINI_CHAT_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-2.0-flash-exp",
] as const;

/** Same ordered list for bootstrap / one-shot generation callers */
export const GEMINI_BOOTSTRAP_MODELS = GEMINI_CHAT_MODELS;

/** forced v1beta for current project model availability */
export const GEMINI_API_VERSION = "v1beta" as const;

/** ארגומנט שני ל-getGenerativeModel — אותה גרסת API בכל המודלים */
export const GEMINI_MODEL_INIT_OPTIONS = { apiVersion: GEMINI_API_VERSION } as const;
export const GEMINI_API_VERSION_FALLBACKS = ["v1beta"] as const;

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

/**
 * Hard quota exhaustion (e.g. daily/project limit = 0) where retries are pointless.
 */
export function isHardQuotaExhaustedError(error: unknown): boolean {
  if (error instanceof GoogleGenerativeAIFetchError && error.status === 429) {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /limit:\s*0|GenerateRequestsPerDayPerProjectPerModel-FreeTier|generate_content_free_tier_requests|check your plan and billing details|Too Many Requests/i.test(
    msg
  );
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

/**
 * Resolve Gemini API key from multiple env names.
 * Priority order:
 * 1) GOOGLE_GENERATIVE_AI_API_KEY
 * 2) GEMINI_API_KEY
 * 3) GOOGLE_API_KEY
 */
export function resolveGeminiApiKeyFromEnv(): string {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    ""
  );
}

export function resolveGeminiApiKeyWithSource(): { key: string; source: string } {
  const fromGoogleGenerative = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (fromGoogleGenerative) return { key: fromGoogleGenerative, source: "GOOGLE_GENERATIVE_AI_API_KEY" };
  const fromGemini = process.env.GEMINI_API_KEY?.trim();
  if (fromGemini) return { key: fromGemini, source: "GEMINI_API_KEY" };
  const fromGoogleApi = process.env.GOOGLE_API_KEY?.trim();
  if (fromGoogleApi) return { key: fromGoogleApi, source: "GOOGLE_API_KEY" };
  return { key: "", source: "MISSING" };
}

/** פונקציית עזר שמנסה מודלים ברצף; אחרי כשל שאינו retry-able עוברים למודל הבא (לא חוזרים על אותו מודל). */
export async function generateRawWithModelFallback<T>(
  modelNames: readonly string[],
  handler: (modelName: string) => Promise<T>,
  retryDelays: readonly number[] = GEMINI_RETRY_DELAYS_MS
): Promise<T> {
  let lastError: unknown = null;
  const total = modelNames.length;

  for (let mi = 0; mi < modelNames.length; mi++) {
    const modelName = normalizeModelName(modelNames[mi]!);
    const nextLabel =
      mi + 1 < modelNames.length
        ? normalizeModelName(modelNames[mi + 1]!)
        : "(end of list)";

    console.info(
      `[Gemini] Attempting model ${mi + 1}/${total}: "${modelName}" (apiVersion=${GEMINI_API_VERSION})`
    );

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        if (attempt > 0) {
          console.info(
            `[Gemini] Same-model retry ${attempt}/${retryDelays.length} for "${modelName}" (transient/quota only)`
          );
        }
        return await handler(modelName);
      } catch (err) {
        lastError = err;
        if (isImmediateModelSwitchError(err)) {
          console.info(
            `[Gemini] Model unavailable for "${modelName}" (e.g. 404); advancing to next: ${nextLabel}`,
            err instanceof Error ? err.message : err
          );
          break;
        }
        const canRetrySameModel = isRetryableGeminiError(err) && attempt < retryDelays.length;
        if (canRetrySameModel) {
          await sleepMs(retryDelays[attempt]);
          continue;
        }
        console.info(
          `[Gemini] Non-retryable or retries exhausted for "${modelName}"; advancing to next: ${nextLabel}`,
          err instanceof Error ? err.message : err
        );
        break;
      }
    }
  }

  throw (lastError ?? new Error("All Gemini models failed"));
}