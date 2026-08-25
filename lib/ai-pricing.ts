/**
 * Per-model USD rates (price per 1M tokens).
 * Fill from current Anthropic / Google pricing pages — values are config, not logic.
 */
// Rates verified Aug 2026; claude-sonnet-5 is introductory $2/$10 (re-check after Aug 31 2026); gemini-2.5-flash retires Oct 16 2026.
export const AI_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
};

/**
 * Estimate USD cost from token counts. Unknown model → 0 (debug warn, never throws).
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  try {
    const key = String(model ?? "").trim();
    const rates = key ? AI_PRICING[key] : undefined;
    if (!rates) {
      console.debug("[ai-pricing] unknown model:", key || "(empty)");
      return 0;
    }
    const inn = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
    const out = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
    return (inn / 1e6) * rates.inputPerMTok + (out / 1e6) * rates.outputPerMTok;
  } catch (e) {
    console.debug("[ai-pricing] estimateCostUsd threw:", e);
    return 0;
  }
}
