export const CLAUDE_CHAT_MODEL = "claude-sonnet-4-6" as const;

/** מענה + שאלה + 2–4 אפשרויות ממוספרות — דורש מעט יותר מקום */
export const CLAUDE_MAX_TOKENS = 1536 as const;

export function resolveClaudeApiKey(): string {
  return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
}

export function isRetryableClaudeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /429|529|overloaded|rate.?limit|too.?many.?requests/i.test(msg);
}

/** יתרת Anthropic נגמרה. במקרה הזה לא עונים ללקוח ולא שולחים שום טקסט. */
export function isAnthropicCreditExhausted(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (status === 402) return true;
  return /credit balance is too low|plans?\s*&\s*billing|purchase credits/i.test(msg);
}

/** Leads are not sent a connection-error sentence. A model failure sends nothing. */
export function formatUserFacingClaudeError(error: unknown): string {
  void error;
  return "";
}

export function friendlyHttpErrorMessage(status: number): string {
  if (status === 429) return "יש עומס רגעי. נסו שוב בעוד דקה — זואי תשמח לעזור.";
  if (status >= 500) return "השרת עמוס זמנית. נסו שוב בעוד רגע.";
  if (status === 408) return "הבקשה ארכה יותר מדי. נסו שוב.";
  if (status >= 400) return "לא הצלחנו לשלוח את ההודעה. בדקו את החיבור ונסו שוב.";
  return "משהו השתבש. נסו שוב בעוד רגע.";
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const CLAUDE_WHATSAPP_MODEL = "claude-haiku-4-5" as const;
export const CLAUDE_WHATSAPP_MAX_TOKENS = 768 as const;

/** סריקת אתר בדשבורד — Haiku מהיר וזול מספיק לחילוץ JSON מובנה */
export const CLAUDE_FETCH_SITE_MODEL = CLAUDE_WHATSAPP_MODEL;
/** JSON ארוך (מוצרים + traits) — מניעת קטיעה שגורמת ל־ai_parse_failed */
export const CLAUDE_FETCH_SITE_MAX_TOKENS = 4096 as const;
export const CLAUDE_FETCH_SITE_FALLBACK_MAX_TOKENS = 1536 as const;
