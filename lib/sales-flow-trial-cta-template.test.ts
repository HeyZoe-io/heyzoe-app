import assert from "node:assert/strict";
import {
  resolveTrialCtaBodyTemplate,
  shouldUseTrialAfterScheduleCta,
  type SalesFlowConfig,
} from "@/lib/sales-flow";

const cfg = {
  cta_body: "על האימון ניסיון - {price} ₪",
  cta_body_after_schedule: "על המפגש - {price} ₪",
} as SalesFlowConfig;

assert.equal(shouldUseTrialAfterScheduleCta({ offerKind: "trial", scheduleDirectRegistration: false }), true);
assert.equal(shouldUseTrialAfterScheduleCta({ offerKind: "trial", scheduleDirectRegistration: true }), false);
assert.equal(shouldUseTrialAfterScheduleCta({ offerKind: "workshop", scheduleDirectRegistration: false }), false);

assert.equal(
  resolveTrialCtaBodyTemplate(cfg, shouldUseTrialAfterScheduleCta({
    offerKind: "trial",
    scheduleDirectRegistration: false,
  })),
  "על המפגש - {price} ₪"
);
assert.equal(
  resolveTrialCtaBodyTemplate(cfg, shouldUseTrialAfterScheduleCta({
    offerKind: "trial",
    scheduleDirectRegistration: true,
  })),
  "על האימון ניסיון - {price} ₪"
);

console.log("sales-flow-trial-cta-template: assertions passed");
