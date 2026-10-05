import assert from "node:assert/strict";
import {
  claimInsertAllowsSend,
  simulateConcurrentClaims,
  simulateTrialBookingClaims,
  trialSendCapBlock,
} from "@/lib/leads/trial-booking-send-guard";

const five = simulateTrialBookingClaims(5);
assert.equal(five.templateSends, 1);
assert.equal(five.freeSends, 1);

assert.equal(simulateConcurrentClaims(4), 1);

assert.equal(claimInsertAllowsSend(null), true);
assert.equal(claimInsertAllowsSend({ code: "23505", message: "duplicate" }), false);
assert.equal(claimInsertAllowsSend({ code: "42703", message: "column channel does not exist" }), false);

assert.equal(
  trialSendCapBlock({
    channel: "template",
    sentTemplatesForRule: 1,
    sentFreeForContact: 0,
    trialRelatedLast24h: 1,
  }),
  "template_rule_cap"
);
assert.equal(
  trialSendCapBlock({
    channel: "free",
    sentTemplatesForRule: 0,
    sentFreeForContact: 1,
    trialRelatedLast24h: 1,
  }),
  "free_message_cap"
);
assert.equal(
  trialSendCapBlock({
    channel: "template",
    sentTemplatesForRule: 0,
    sentFreeForContact: 0,
    trialRelatedLast24h: 3,
  }),
  "trial_24h_cap"
);
assert.equal(
  trialSendCapBlock({
    channel: "free",
    sentTemplatesForRule: 0,
    sentFreeForContact: 0,
    trialRelatedLast24h: 0,
  }),
  null
);

console.log("trial-booking-send-guard.test.ts: ok");
