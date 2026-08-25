import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type CallType =
  | "generation"
  | "classifier"
  | "opt_out"
  | "start_intent"
  | "editor"
  | "dashboard_gen"
  | "other";

export type AiUsageProvider = "anthropic" | "google";

/** Accepts Anthropic `usage`, Gemini `usageMetadata`, or a pre-mapped object. */
export type AiUsageTokens = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
} | null | undefined;

function envFlagOn(raw: string | undefined): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isAiUsageTrackingEnabled(): boolean {
  return envFlagOn(process.env.AI_USAGE_TRACKING_ENABLED);
}

function coerceNonNegInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Normalize Anthropic or Gemini usage shapes; missing fields → 0. */
export function normalizeAiUsageTokens(usage: AiUsageTokens): {
  inputTokens: number;
  outputTokens: number;
} {
  const u = usage && typeof usage === "object" ? usage : null;
  if (!u) return { inputTokens: 0, outputTokens: 0 };

  const inputTokens = coerceNonNegInt(
    u.input_tokens !== undefined && u.input_tokens !== null
      ? u.input_tokens
      : u.promptTokenCount
  );
  const outputTokens = coerceNonNegInt(
    u.output_tokens !== undefined && u.output_tokens !== null
      ? u.output_tokens
      : u.candidatesTokenCount
  );
  return { inputTokens, outputTokens };
}

/**
 * Fire-and-forget append of one LLM usage row. Never throws.
 * Early-exits when AI_USAGE_TRACKING_ENABLED is off or businessId is missing.
 */
export async function recordAiUsage(input: {
  businessId: number | null | undefined;
  contactId?: string | null;
  provider: AiUsageProvider;
  model: string;
  callType: CallType;
  usage: AiUsageTokens;
}): Promise<void> {
  try {
    if (!isAiUsageTrackingEnabled()) return;

    const businessId = Number(input.businessId);
    if (!Number.isFinite(businessId) || businessId <= 0) return;

    const model = String(input.model ?? "").trim();
    if (!model) return;

    const { inputTokens, outputTokens } = normalizeAiUsageTokens(input.usage);
    const contactId =
      typeof input.contactId === "string" && input.contactId.trim()
        ? input.contactId.trim()
        : null;

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("ai_usage").insert({
      business_id: businessId,
      contact_id: contactId,
      provider: input.provider,
      model,
      call_type: input.callType,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
    if (error) {
      console.debug("[ai-usage] insert failed:", error.message);
    }
  } catch (e) {
    console.debug("[ai-usage] record threw:", e);
  }
}
