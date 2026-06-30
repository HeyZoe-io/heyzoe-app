/**
 * warmup_extra_awaiting_idx on contacts — PR1: reset-only (not read for routing yet).
 * -2 = off (outside warmup extras); -1 = Q1 experience pending (PR3+); 0+ = extra k awaiting answer.
 */

export const WARMUP_EXTRA_AWAITING_OFF = -2;

/** Merge warmup counter reset into any contacts update that clears sales-flow phase/step. */
export function withWarmupExtraAwaitingOff<T extends Record<string, unknown>>(
  patch: T
): T & { warmup_extra_awaiting_idx: typeof WARMUP_EXTRA_AWAITING_OFF } {
  return { ...patch, warmup_extra_awaiting_idx: WARMUP_EXTRA_AWAITING_OFF };
}

/** Standard patch: back to opening service pick (clears schedule + warmup counter). */
export function salesFlowOpeningResetPatch() {
  return withWarmupExtraAwaitingOff({
    session_phase: "opening" as const,
    flow_step: 0,
    sf_requested_date: null,
    sf_requested_time: null,
  });
}
