import assert from "node:assert/strict";
import { planTrialRegistrationSends } from "@/lib/leads/trial-registration-plan";

const base = {
  isTrialProduct: true,
  freeAlreadySent: false,
  classStarted: false,
  trialBookedRuleCount: 1,
  purchaseRuleCount: 1,
};

assert.deepEqual(
  planTrialRegistrationSends({ ...base, source: "booking", inWindow: true }),
  { freeMessage: true, trialBookedTemplates: 1, purchaseTemplates: 0 },
  "booking in window: template and free message"
);

assert.deepEqual(
  planTrialRegistrationSends({ ...base, source: "booking", inWindow: false }),
  { freeMessage: false, trialBookedTemplates: 1, purchaseTemplates: 0 },
  "booking out of window: template only"
);

const purchaseThenBooking = planTrialRegistrationSends({
  ...base,
  source: "purchase",
  inWindow: true,
});
assert.deepEqual(purchaseThenBooking, {
  freeMessage: true,
  trialBookedTemplates: 0,
  purchaseTemplates: 0,
});
assert.deepEqual(
  planTrialRegistrationSends({
    ...base,
    source: "booking",
    inWindow: true,
    freeAlreadySent: purchaseThenBooking.freeMessage,
  }),
  { freeMessage: false, trialBookedTemplates: 1, purchaseTemplates: 0 },
  "trial purchase then booking: one free message, trial_booked template, no purchase template"
);

assert.deepEqual(
  planTrialRegistrationSends({
    ...base,
    source: "purchase",
    isTrialProduct: false,
    inWindow: true,
  }),
  { freeMessage: false, trialBookedTemplates: 0, purchaseTemplates: 1 },
  "non-trial purchase: its template"
);

assert.deepEqual(
  planTrialRegistrationSends({
    ...base,
    source: "booking",
    inWindow: true,
    trialBookedRuleCount: 2,
  }),
  { freeMessage: true, trialBookedTemplates: 2, purchaseTemplates: 0 },
  "two trial_booked rules: both templates"
);

assert.deepEqual(
  planTrialRegistrationSends({ ...base, source: "booking", inWindow: true, classStarted: true }),
  { freeMessage: false, trialBookedTemplates: 0, purchaseTemplates: 0 },
  "class already started: nothing"
);

assert.deepEqual(
  planTrialRegistrationSends({
    source: "purchase",
    isTrialProduct: true,
    inWindow: true,
    freeAlreadySent: false,
    classStarted: false,
    trialBookedRuleCount: 1,
    purchaseRuleCount: 2,
  }),
  { freeMessage: true, trialBookedTemplates: 0, purchaseTemplates: 0 },
  "trial purchase with no booking yet: free message only"
);

assert.deepEqual(
  planTrialRegistrationSends({
    source: "purchase",
    isTrialProduct: true,
    inWindow: false,
    freeAlreadySent: false,
    classStarted: false,
    trialBookedRuleCount: 1,
    purchaseRuleCount: 2,
  }),
  { freeMessage: false, trialBookedTemplates: 0, purchaseTemplates: 0 },
  "trial purchase out of window and no booking: nothing until a booking"
);

console.log("trial-registration-plan.test.ts: ok");
