/**
 * Per-inbound sales-flow state for the WhatsApp webhook.
 * Loaded once at turn start, whether or not the pre-Claude block ran.
 */

/** One load per inbound message. Concurrent callers share the same promise. */
export function memoizeTurnLoad<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) pending = load();
    return pending;
  };
}

/** A flow that went quiet long enough to reactivate counts as closed for this turn. */
export function salesFlowOpenForTurn(input: {
  salesFlowStarted: boolean;
  inboundReopenedAfterDormancy: boolean;
}): boolean {
  return input.salesFlowStarted && !input.inboundReopenedAfterDormancy;
}

type LeadFlowBlockers = {
  arboxIsMember: boolean | null;
  trialRegistered: boolean | null;
  sessionPhase: string;
};

function leadMayEnterFlow(input: LeadFlowBlockers): boolean {
  return input.arboxIsMember !== true && input.trialRegistered !== true && input.sessionPhase !== "registered";
}

/** «רוצה שנמצא את השיעור…» is only for a lead who is not already in a flow. */
export function findClassOfferGateOpen(
  input: LeadFlowBlockers & {
    flowOpen: boolean;
    isText: boolean;
    hasBusiness: boolean;
    hasSalesFlowConfig: boolean;
    routeTagOk: boolean;
  }
): boolean {
  return (
    input.isText &&
    input.hasBusiness &&
    input.hasSalesFlowConfig &&
    input.routeTagOk &&
    !input.flowOpen &&
    leadMayEnterFlow(input)
  );
}

/** Claude's interest/signup tag opens product pick only when no flow is running. */
export function interestRouteOpensFlow(
  input: LeadFlowBlockers & {
    explicitSignup: boolean;
    flowOpen: boolean;
    heldForQuestion: boolean;
  }
): boolean {
  return input.explicitSignup && !input.flowOpen && !input.heldForQuestion && leadMayEnterFlow(input);
}

/** A known member never gets a new flow, but a flow she is already in is not cut. */
export function memberMayEnterHintedSignupFlow(input: {
  arboxIsMember: boolean | null;
  salesFlowStarted: boolean;
}): boolean {
  return !(input.arboxIsMember === true && !input.salesFlowStarted);
}
