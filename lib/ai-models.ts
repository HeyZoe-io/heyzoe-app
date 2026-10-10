/**
 * Claude Haiku selection for every former Haiku 4.5 call site.
 * Env names are not reused as constants with a different value.
 *
 * CLAUDE_WHATSAPP_MODEL — WhatsApp free-text generation only.
 * CLAUDE_HAIKU_MODEL — every other Haiku call site.
 * Unset → claude-haiku-5-5. claude-haiku-4-5 restores that site's previous params.
 */

export const HAIKU_5_5 = "claude-haiku-5-5";
export const HAIKU_4_5 = "claude-haiku-4-5";

const ALLOWED = new Set<string>([HAIKU_5_5, HAIKU_4_5]);

export type HaikuCallSite =
  | "wa-generation"
  | "conversation-flow-free-question"
  | "marketing-flow-reply"
  | "not-relevant-open-answer"
  | "not-relevant-open-classify"
  | "not-relevant-location"
  | "sales-flow-translate"
  | "product-description"
  | "fetch-site-scan"
  | "fetch-site-scan-fallback"
  | "fetch-site-enrich"
  | "knowledge-update-classify"
  | "knowledge-update-generalize"
  | "knowledge-update-ground"
  | "knowledge-update-rules";

type SiteSpec = {
  env: "CLAUDE_WHATSAPP_MODEL" | "CLAUDE_HAIKU_MODEL";
  /** Params that were sent before the Haiku 5.5 switch. */
  rollback: { max_tokens: number; temperature?: number };
  /** Haiku 5.5. thinkingDisabled is classify/transform only. Reply and extract leave adaptive thinking on. */
  haiku55: { max_tokens: number; thinkingDisabled: boolean };
};

const SITES: Record<HaikuCallSite, SiteSpec> = {
  "wa-generation": {
    env: "CLAUDE_WHATSAPP_MODEL",
    rollback: { max_tokens: 768 },
    haiku55: { max_tokens: 4096, thinkingDisabled: false },
  },
  "conversation-flow-free-question": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 280, temperature: 0.3 },
    haiku55: { max_tokens: 400, thinkingDisabled: true },
  },
  "marketing-flow-reply": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 768 },
    haiku55: { max_tokens: 4096, thinkingDisabled: false },
  },
  "not-relevant-open-answer": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 768 },
    haiku55: { max_tokens: 4096, thinkingDisabled: false },
  },
  "not-relevant-open-classify": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 8, temperature: 0 },
    haiku55: { max_tokens: 64, thinkingDisabled: true },
  },
  "not-relevant-location": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 12, temperature: 0 },
    haiku55: { max_tokens: 64, thinkingDisabled: true },
  },
  "sales-flow-translate": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 3072 },
    haiku55: { max_tokens: 3072, thinkingDisabled: true },
  },
  "product-description": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 768 },
    haiku55: { max_tokens: 768, thinkingDisabled: true },
  },
  "fetch-site-scan": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 4096 },
    haiku55: { max_tokens: 8192, thinkingDisabled: false },
  },
  "fetch-site-scan-fallback": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 1536 },
    haiku55: { max_tokens: 5632, thinkingDisabled: false },
  },
  "fetch-site-enrich": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 2048 },
    haiku55: { max_tokens: 6144, thinkingDisabled: false },
  },
  "knowledge-update-classify": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 800, temperature: 0 },
    haiku55: { max_tokens: 800, thinkingDisabled: true },
  },
  "knowledge-update-generalize": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 300, temperature: 0 },
    haiku55: { max_tokens: 300, thinkingDisabled: true },
  },
  "knowledge-update-ground": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 200, temperature: 0 },
    haiku55: { max_tokens: 200, thinkingDisabled: true },
  },
  "knowledge-update-rules": {
    env: "CLAUDE_HAIKU_MODEL",
    rollback: { max_tokens: 800, temperature: 0 },
    haiku55: { max_tokens: 800, thinkingDisabled: true },
  },
};

export type HaikuRequestParams = {
  model: string;
  max_tokens: number;
  temperature?: number;
  output_config?: { effort: "low" };
  thinking?: { type: "disabled" };
};

export function resolveAllowedHaikuModel(
  envName: "CLAUDE_WHATSAPP_MODEL" | "CLAUDE_HAIKU_MODEL",
  raw: string | undefined = process.env[envName]
): string {
  const model = String(raw ?? "").trim() || HAIKU_5_5;
  if (!ALLOWED.has(model)) {
    throw new Error(`Unsupported ${envName} "${model}". Use claude-haiku-5-5 or claude-haiku-4-5.`);
  }
  return model;
}

export function resolveWhatsAppGenerationModel(raw = process.env.CLAUDE_WHATSAPP_MODEL): string {
  return resolveAllowedHaikuModel("CLAUDE_WHATSAPP_MODEL", raw);
}

/** Params for one call site. Pass modelOverride only in tests. */
export function buildHaikuRequest(site: HaikuCallSite, modelOverride?: string): HaikuRequestParams {
  const spec = SITES[site];
  const model =
    modelOverride !== undefined
      ? resolveAllowedHaikuModel(spec.env, modelOverride)
      : resolveAllowedHaikuModel(spec.env);
  if (model === HAIKU_4_5) {
    return {
      model,
      max_tokens: spec.rollback.max_tokens,
      ...(spec.rollback.temperature != null ? { temperature: spec.rollback.temperature } : {}),
    };
  }
  return {
    model,
    max_tokens: spec.haiku55.max_tokens,
    output_config: { effort: "low" },
    ...(spec.haiku55.thinkingDisabled ? { thinking: { type: "disabled" as const } } : {}),
  };
}

/** Same request as before this module existed. */
export function buildWhatsAppGenerationParams(model = resolveWhatsAppGenerationModel()): HaikuRequestParams {
  return buildHaikuRequest("wa-generation", model);
}

/** Concatenate text blocks only. Thinking blocks are ignored. */
export function claudeTextBlocks(response: { content?: unknown } | null | undefined): string {
  const content = response?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        Boolean(block) &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export type HaikuTextRead = { text: string; truncated: boolean };

/**
 * stop_reason max_tokens is a failure: text may be empty or cut.
 * Callers send this into their existing retry or fallback. The log is `[ai-models] max_tokens`.
 */
/** Log label. answerFreeQuestion keeps its call-site id and a stable log name. */
export function haikuMaxTokensLogSite(site: HaikuCallSite): string {
  return site === "conversation-flow-free-question" ? "answerFreeQuestion" : site;
}

export function readHaikuText(
  site: HaikuCallSite,
  response: { content?: unknown; stop_reason?: string | null } | null | undefined
): HaikuTextRead {
  const text = claudeTextBlocks(response);
  if (response?.stop_reason === "max_tokens") {
    console.error(`[ai-models] max_tokens site=${haikuMaxTokensLogSite(site)}`, { textChars: text.length });
    return { text, truncated: true };
  }
  return { text, truncated: false };
}
