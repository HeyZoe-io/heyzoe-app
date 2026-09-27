import assert from "node:assert/strict";
import {
  trialPurchaseTemplateBlockedByZoe,
  zoeRegistrationConfirmBlockedByTrialTemplate,
} from "@/lib/trial-signup-notice";

assert.equal(trialPurchaseTemplateBlockedByZoe("zoe"), true);
assert.equal(trialPurchaseTemplateBlockedByZoe("template"), false);
assert.equal(trialPurchaseTemplateBlockedByZoe(null), false);
assert.equal(zoeRegistrationConfirmBlockedByTrialTemplate("template"), true);
assert.equal(zoeRegistrationConfirmBlockedByTrialTemplate("zoe"), false);
assert.equal(zoeRegistrationConfirmBlockedByTrialTemplate(null), false);

console.log("trial-signup-notice.test.ts: ok");
