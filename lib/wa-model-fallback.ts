import type { AiUsageTokens } from "@/lib/ai-usage";
import { isAnthropicCreditExhausted, isRetryableClaudeError, sleepMs } from "@/lib/claude";

export type ModelAttempt = { text: string; usage?: AiUsageTokens };

export type WhatsAppModelReply =
  | {
      ok: true;
      text: string;
      provider: "anthropic" | "google";
      usage: AiUsageTokens;
      billing: boolean;
    }
  | { ok: false; billing: boolean; errorType: string };

export function whatsAppClaudeReplyText(response: { content?: unknown } | null | undefined): string {
  const content = response?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        Boolean(b) &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string"
    )
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Short label for the admin alert. Billing wins over the HTTP status. */
export function claudeErrorType(error: unknown): string {
  if (isAnthropicCreditExhausted(error)) return "billing";
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  if (status === 401 || status === 403 || status === 400 || status === 429 || status === 408) {
    return `http_${status}`;
  }
  if (Number.isFinite(status) && status >= 500) return `http_${status}`;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout|timed out|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(msg)) {
    return "network";
  }
  return "claude_failed";
}

/**
 * One Claude call, then Gemini on any non-success.
 * A retryable non-billing error gets one short Claude retry first.
 * Billing still tries Gemini. Neither success returns no lead text.
 */
export async function resolveWhatsAppModelReply(input: {
  runClaude: () => Promise<{ content?: unknown; usage?: AiUsageTokens; stop_reason?: string | null }>;
  runGemini: () => Promise<{ text: string; usageMetadata?: AiUsageTokens }>;
}): Promise<WhatsAppModelReply> {
  let billing = false;
  let claudeError: unknown = null;

  const attemptClaude = async (): Promise<ModelAttempt | null> => {
    const response = await input.runClaude();
    const text = whatsAppClaudeReplyText(response);
    if (response.stop_reason === "max_tokens") {
      console.error("[wa-model-fallback] Claude hit max_tokens", { textChars: text.length });
      return null;
    }
    if (!text) return null;
    return { text, usage: response.usage };
  };

  let claude: ModelAttempt | null = null;
  try {
    claude = await attemptClaude();
    if (!claude) {
      await sleepMs(700);
      claude = await attemptClaude();
    }
  } catch (error) {
    claudeError = error;
    billing = isAnthropicCreditExhausted(error);
    if (!billing && isRetryableClaudeError(error)) {
      try {
        await sleepMs(900);
        claude = await attemptClaude();
        claudeError = null;
      } catch (retryError) {
        claudeError = retryError;
        billing = isAnthropicCreditExhausted(retryError);
      }
    }
  }

  if (claude?.text) {
    return {
      ok: true,
      text: claude.text,
      provider: "anthropic",
      usage: claude.usage,
      billing: false,
    };
  }

  try {
    const gemini = await input.runGemini();
    const text = String(gemini.text ?? "").trim();
    if (!text) throw new Error("empty response");
    return {
      ok: true,
      text,
      provider: "google",
      usage: gemini.usageMetadata,
      billing,
    };
  } catch (geminiError) {
    console.error("[wa-model-fallback] Gemini failed after Claude", {
      claude: claudeErrorType(claudeError),
      gemini: geminiError instanceof Error ? geminiError.message : String(geminiError),
    });
    return {
      ok: false,
      billing,
      errorType: claudeError ? claudeErrorType(claudeError) : "claude_failed",
    };
  }
}
