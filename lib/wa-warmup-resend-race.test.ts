import assert from "node:assert/strict";
import { decideWarmupExtraResendAction } from "@/lib/wa-warmup-extra-resend";

/**
 * Cross-handler race: pick already advanced (live idx=3 / Q4) while resend still
 * resolves stale snapshot (event idx=2 / Q3). PR3 guard must skip; until then send.
 */
const staleResendDecision = decideWarmupExtraResendAction({
  contactFlowStep: 3,
  lastIdxFromEvent: 2,
  lastAssistModel: "sales_flow_warmup_extra",
  hasWarmupQ1: true,
  cleanStepsCount: 5,
  liveAwaitingExtraIdx: 3,
});

assert.equal(
  staleResendDecision.action,
  "skip",
  `resend must skip when live awaiting idx (3) != resend target (2); got ${JSON.stringify(staleResendDecision)}`
);

/** Legit resend on same step — must keep working before and after PR3. */
const legitResendDecision = decideWarmupExtraResendAction({
  contactFlowStep: 3,
  lastIdxFromEvent: 2,
  lastAssistModel: "sales_flow_warmup_extra",
  hasWarmupQ1: true,
  cleanStepsCount: 5,
  liveAwaitingExtraIdx: 2,
});

assert.equal(legitResendDecision.action, "send", JSON.stringify(legitResendDecision));
assert.equal(
  legitResendDecision.action === "send" ? legitResendDecision.targetExtraIdx : null,
  2
);

console.log("wa-warmup-resend-race: all assertions passed");
