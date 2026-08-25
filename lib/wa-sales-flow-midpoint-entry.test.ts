import assert from "node:assert/strict";
import {
  salesFlowGreetingMarkerCountsAsStarted,
  sessionCountsAsSalesFlowStarted,
  isOpeningServicePickMenuModel,
} from "@/lib/sales-flow-start-triggers";

/** Mid-flow entries must count as a started sales flow (same as greeting). */
const MIDPOINT_ENTRY_MODELS = [
  "signup_intent_flow_entry",
  "trial_topic_flow_entry",
  "registration_intent_no_member",
  "closed_playbook_catalog_group",
] as const;

for (const modelUsed of MIDPOINT_ENTRY_MODELS) {
  assert.equal(
    salesFlowGreetingMarkerCountsAsStarted({
      modelUsed,
      precedingUserText: "היי רציתי שיעור ניסיון",
    }),
    true,
    `${modelUsed} must count as sales-flow started`
  );
  assert.equal(
    sessionCountsAsSalesFlowStarted({
      greetingMarkerModel: modelUsed,
      precedingUserText: null,
      lastAssistantModel: null,
    }),
    true,
    `sessionCountsAsSalesFlowStarted(${modelUsed})`
  );
}

assert.equal(
  sessionCountsAsSalesFlowStarted({
    greetingMarkerModel: null,
    precedingUserText: null,
    lastAssistantModel: "flow_continuation_opening_service_pick",
  }),
  true,
  "product-pick menu alone keeps flow started"
);

assert.equal(isOpeningServicePickMenuModel("sales_flow_opening_service_pick_resend"), true);

console.log("wa-sales-flow-midpoint-entry.test.ts: ok");
