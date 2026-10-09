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

/** WA free-text generation only. Other Haiku call sites keep CLAUDE_WHATSAPP_MODEL. */
export const CLAUDE_WHATSAPP_GENERATION_MODEL_DEFAULT = "claude-haiku-5-5" as const;
/** Eval haiku55-low cap. Thinking tokens count toward this and are billed as output. */
export const CLAUDE_WHATSAPP_HAIKU_55_MAX_TOKENS = 4096 as const;

const WHATSAPP_GENERATION_MODELS = new Set<string>([
  CLAUDE_WHATSAPP_GENERATION_MODEL_DEFAULT,
  CLAUDE_WHATSAPP_MODEL,
]);

/**
 * Env CLAUDE_WHATSAPP_MODEL overrides generation only.
 * Unset → claude-haiku-5-5. claude-haiku-4-5 restores the previous request.
 */
export function resolveWhatsAppGenerationModel(raw = process.env.CLAUDE_WHATSAPP_MODEL): string {
  const model = String(raw ?? "").trim() || CLAUDE_WHATSAPP_GENERATION_MODEL_DEFAULT;
  if (!WHATSAPP_GENERATION_MODELS.has(model)) {
    throw new Error(
      `Unsupported CLAUDE_WHATSAPP_MODEL "${model}". Use claude-haiku-5-5 or claude-haiku-4-5.`
    );
  }
  return model;
}

export type WhatsAppGenerationParams = {
  model: string;
  max_tokens: number;
  output_config?: { effort: "low" };
};

/**
 * haiku-5-5 matches the eval haiku55-low call: effort low, max_tokens 4096,
 * no temperature/top_p/top_k, and no thinking field (adaptive thinking stays on).
 * haiku-4-5 is the previous call: max_tokens 768, no effort, no thinking.
 */
export function buildWhatsAppGenerationParams(model = resolveWhatsAppGenerationModel()): WhatsAppGenerationParams {
  if (model === CLAUDE_WHATSAPP_GENERATION_MODEL_DEFAULT) {
    return {
      model,
      max_tokens: CLAUDE_WHATSAPP_HAIKU_55_MAX_TOKENS,
      output_config: { effort: "low" },
    };
  }
  if (model === CLAUDE_WHATSAPP_MODEL) {
    return { model, max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS };
  }
  throw new Error(
    `Unsupported CLAUDE_WHATSAPP_MODEL "${model}". Use claude-haiku-5-5 or claude-haiku-4-5.`
  );
}

/** סריקת אתר בדשבורד — Haiku מהיר וזול מספיק לחילוץ JSON מובנה */
export const CLAUDE_FETCH_SITE_MODEL = CLAUDE_WHATSAPP_MODEL;
/** JSON ארוך (מוצרים + traits) — מניעת קטיעה שגורמת ל־ai_parse_failed */
export const CLAUDE_FETCH_SITE_MAX_TOKENS = 4096 as const;
export const CLAUDE_FETCH_SITE_FALLBACK_MAX_TOKENS = 1536 as const;
