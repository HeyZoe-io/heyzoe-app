/**
 * Warmup extra resend: resolve which extra step to resend + send/skip decision.
 * Extracted from resendUnansweredSalesFlowPrompt (webhook route) — behavior unchanged on extract.
 */

const WARMUP_EXTRA_MENU_MODELS = new Set([
  "sales_flow_warmup_extra",
  "flow_continuation_warmup_extra",
]);

export function isWarmupExtraMenuModel(model: string | null | undefined): boolean {
  return WARMUP_EXTRA_MENU_MODELS.has(String(model ?? "").trim());
}

export function inferWarmupExtraStepIndex(input: {
  flowStep: number;
  hasWarmupQ1: boolean;
  cleanStepsCount: number;
  lastIdxFromEvent: number | null;
  lastAssistModel: string | null;
  sessionPhase?: "opening" | "warmup" | "schedule_date" | "schedule_time" | "cta" | "registered";
}): number | null {
  if (input.lastIdxFromEvent != null) return input.lastIdxFromEvent;
  const canInferFromFlowStep =
    isWarmupExtraMenuModel(input.lastAssistModel) || input.sessionPhase === "warmup";
  if (!canInferFromFlowStep || input.cleanStepsCount < 1) return null;
  const base = input.hasWarmupQ1 ? 1 : 0;
  const bumpedIdx = input.flowStep - base - 1;
  if (bumpedIdx >= 0 && bumpedIdx < input.cleanStepsCount) return bumpedIdx;
  const unbumpedIdx = input.flowStep - base;
  if (unbumpedIdx >= 0 && unbumpedIdx < input.cleanStepsCount) return unbumpedIdx;
  return input.cleanStepsCount === 1 ? 0 : null;
}

/** Mirrors resendUnansweredSalesFlowPrompt warmup branch (extraIdx resolution). */
export function resolveWarmupResendExtraIdx(input: {
  contactFlowStep: number;
  lastIdxFromEvent: number | null;
  lastAssistModel: string | null;
  hasWarmupQ1: boolean;
  cleanStepsCount: number;
}): number | null {
  let extraIdx = inferWarmupExtraStepIndex({
    flowStep: input.contactFlowStep,
    hasWarmupQ1: input.hasWarmupQ1,
    cleanStepsCount: input.cleanStepsCount,
    lastIdxFromEvent: input.lastIdxFromEvent,
    lastAssistModel: input.lastAssistModel,
    sessionPhase: "warmup",
  });
  if (extraIdx == null && input.cleanStepsCount > 0) {
    const fromStep = input.hasWarmupQ1 ? input.contactFlowStep - 1 : input.contactFlowStep;
    if (fromStep >= 0 && fromStep < input.cleanStepsCount) extraIdx = fromStep;
  }
  return extraIdx;
}

export type WarmupExtraResendDecision =
  | { action: "send"; targetExtraIdx: number }
  | { action: "skip"; reason: string; targetExtraIdx?: number | null };

export type DecideWarmupExtraResendInput = {
  contactFlowStep: number;
  /** Snapshot from handler start / early fetch — may be stale under parallel pick advance. */
  lastIdxFromEvent: number | null;
  lastAssistModel: string | null;
  hasWarmupQ1: boolean;
  cleanStepsCount: number;
  /**
   * Current awaiting extra index in DB (warmup_extra_awaiting_idx in PR3+).
   * Ignored until PR3 wires the live guard — production omits this field today.
   */
  liveAwaitingExtraIdx?: number | null;
};

/**
 * Whether to send a warmup-extra menu resend (free-text / Claude continuation path).
 * Resolves targetExtraIdx exactly like resendUnansweredSalesFlowPrompt did before extract
 * (resolveActiveWarmupExtraMenuIndex + fromStep fallback). Step content / min-options gate
 * stays in the route (`st?.question && options.length >= 2`). PR3 will honor liveAwaitingExtraIdx.
 */
export function decideWarmupExtraResendAction(input: DecideWarmupExtraResendInput): WarmupExtraResendDecision {
  const targetExtraIdx = resolveWarmupResendExtraIdx({
    contactFlowStep: input.contactFlowStep,
    lastIdxFromEvent: input.lastIdxFromEvent,
    lastAssistModel: input.lastAssistModel,
    hasWarmupQ1: input.hasWarmupQ1,
    cleanStepsCount: input.cleanStepsCount,
  });

  if (targetExtraIdx == null) {
    return { action: "skip", reason: "no_resend_target", targetExtraIdx };
  }

  void input.liveAwaitingExtraIdx;

  return { action: "send", targetExtraIdx };
}
