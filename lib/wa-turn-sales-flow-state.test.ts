import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  findClassOfferGateOpen,
  interestRouteOpensFlow,
  memberMayEnterHintedSignupFlow,
  memoizeTurnLoad,
  salesFlowOpenForTurn,
} from "@/lib/wa-turn-sales-flow-state";

const lead = { arboxIsMember: null, trialRegistered: false, sessionPhase: "opening" } as const;
const offerBase = { isText: true, hasBusiness: true, hasSalesFlowConfig: true, routeTagOk: true, ...lead };

// Free text from a lead already in the flow: no find-class offer, no flow re-entry.
{
  const flowOpen = salesFlowOpenForTurn({ salesFlowStarted: true, inboundReopenedAfterDormancy: false });
  assert.equal(flowOpen, true);
  assert.equal(findClassOfferGateOpen({ ...offerBase, flowOpen }), false);
  assert.equal(interestRouteOpensFlow({ ...lead, explicitSignup: true, flowOpen, heldForQuestion: false }), false);
}

// Lead not in a flow: unchanged.
{
  const flowOpen = salesFlowOpenForTurn({ salesFlowStarted: false, inboundReopenedAfterDormancy: false });
  assert.equal(flowOpen, false);
  assert.equal(findClassOfferGateOpen({ ...offerBase, flowOpen }), true);
  assert.equal(interestRouteOpensFlow({ ...lead, explicitSignup: true, flowOpen, heldForQuestion: false }), true);
  assert.equal(interestRouteOpensFlow({ ...lead, explicitSignup: true, flowOpen, heldForQuestion: true }), false);
  assert.equal(interestRouteOpensFlow({ ...lead, explicitSignup: false, flowOpen, heldForQuestion: false }), false);
}

// Dormant lead reactivated: the old flow counts as closed, as before.
{
  const flowOpen = salesFlowOpenForTurn({ salesFlowStarted: true, inboundReopenedAfterDormancy: true });
  assert.equal(flowOpen, false);
  assert.equal(findClassOfferGateOpen({ ...offerBase, flowOpen }), true);
  assert.equal(interestRouteOpensFlow({ ...lead, explicitSignup: true, flowOpen, heldForQuestion: false }), true);
}

// Registered or member leads never get the offer or a new flow.
for (const blocked of [
  { ...lead, arboxIsMember: true },
  { ...lead, trialRegistered: true },
  { ...lead, sessionPhase: "registered" },
]) {
  assert.equal(findClassOfferGateOpen({ ...offerBase, ...blocked, flowOpen: false }), false);
  assert.equal(interestRouteOpensFlow({ ...blocked, explicitSignup: true, flowOpen: false, heldForQuestion: false }), false);
}

// Member check: a known member gets no new flow; a flow she is already in is not cut.
assert.equal(memberMayEnterHintedSignupFlow({ arboxIsMember: true, salesFlowStarted: false }), false);
assert.equal(memberMayEnterHintedSignupFlow({ arboxIsMember: true, salesFlowStarted: true }), true);
assert.equal(memberMayEnterHintedSignupFlow({ arboxIsMember: false, salesFlowStarted: false }), true);
assert.equal(memberMayEnterHintedSignupFlow({ arboxIsMember: null, salesFlowStarted: false }), true);

// The getter loads at most once per message, including concurrent callers.
async function getterLoadsOnce(): Promise<void> {
  let calls = 0;
  const get = memoizeTurnLoad(async () => {
    calls += 1;
    return true;
  });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(await get(), true);
  assert.equal(a && b, true);
  assert.equal(calls, 1);
}

// Webhook: after the pre-Claude block, flow state is read only through the turn getters.
{
  const src = readFileSync(path.join(process.cwd(), "app/api/whatsapp/webhook/route.ts"), "utf8");
  const blockEnd = src.indexOf("} // customerPreClaude");
  assert.ok(blockEnd > 0);
  const after = src.slice(blockEnd);
  const getterLine = after.indexOf("const salesFlowStartedThisTurn = await ensureSalesFlowStarted();");
  assert.ok(getterLine > 0, "turn getter must run after the pre-Claude block");
  assert.ok(after.includes("const lastAssistAtTurnStart = await ensureLastAssistForWarmupPriority();"));
  const reads = after
    .split("\n")
    .filter((line) => /\b(?:salesFlowStarted|lastAssistForWarmupPriority)\b(?!\s*:)/.test(line));
  assert.deepEqual(reads, [], "stale per-turn state read after customerPreClaude");
}

getterLoadsOnce().then(
  () => console.log("wa-turn-sales-flow-state.test.ts: ok"),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
