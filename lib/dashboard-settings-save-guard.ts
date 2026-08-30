/** Guards for dashboard settings POST — extras preservation + optimistic concurrency. */

const EXTRA_STEP_KEYS = ["greeting_extra_steps", "cta_extra_steps"] as const;

function salesFlowExtraStepsPayloadIsEmpty(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length === 0) return true;
  return !raw.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (String(row.question ?? "").trim()) return true;
    const options = Array.isArray(row.options) ? row.options : [];
    return options.some((opt) => String(opt ?? "").trim());
  });
}

/**
 * Keep greeting_extra_steps / cta_extra_steps from the stored sales_flow when the
 * incoming payload omitted or emptied them (the editor does not expose those fields).
 * Non-empty incoming arrays win — that is an explicit edit.
 */
export function preserveSalesFlowExtraSteps(
  incoming: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const prev =
    previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  const next = { ...incoming };
  for (const key of EXTRA_STEP_KEYS) {
    if (!salesFlowExtraStepsPayloadIsEmpty(next[key])) continue;
    if (!salesFlowExtraStepsPayloadIsEmpty(prev[key])) {
      next[key] = prev[key];
    }
  }
  return next;
}

export function preserveSalesFlowExtraStepsInSocial(
  mergedSocial: Record<string, unknown>,
  previousSocial: Record<string, unknown>
): Record<string, unknown> {
  const incomingSf = mergedSocial.sales_flow;
  if (!incomingSf || typeof incomingSf !== "object" || Array.isArray(incomingSf)) {
    return mergedSocial;
  }
  const prevSf = previousSocial.sales_flow;
  const previous =
    prevSf && typeof prevSf === "object" && !Array.isArray(prevSf)
      ? (prevSf as Record<string, unknown>)
      : null;
  return {
    ...mergedSocial,
    sales_flow: preserveSalesFlowExtraSteps(incomingSf as Record<string, unknown>, previous),
  };
}

/**
 * Any businesses.updated_at change since load is a conflict (acceptable, safe side —
 * CRM stamps, Arbox sync, or another settings save all bump the same column).
 */
export function settingsUpdatedAtConflicts(expected: unknown, current: unknown): boolean {
  const currentToken = String(current ?? "").trim();
  if (!currentToken) return false;
  const expectedToken = String(expected ?? "").trim();
  if (!expectedToken) return true;
  if (expectedToken === currentToken) return false;
  const expectedMs = Date.parse(expectedToken);
  const currentMs = Date.parse(currentToken);
  if (Number.isFinite(expectedMs) && Number.isFinite(currentMs)) {
    return expectedMs !== currentMs;
  }
  return true;
}
