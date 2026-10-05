import assert from "node:assert/strict";
import {
  formatTrialBookingConfirmDate,
  formatTrialBookingConfirmTime,
  trialBookingAlreadyHandled,
  trialBookingConfirmEnabled,
  trialBookingConfirmIsTerminalSkip,
  trialBookingInWindowChannel,
  trialBookingTemplateFollowUp,
} from "@/lib/leads/arbox-trial-booking-confirm";
import { trialPurchaseTemplateBlockedByZoe } from "@/lib/trial-signup-notice";

assert.equal(trialBookingConfirmEnabled(false), false);
assert.equal(trialBookingConfirmEnabled(true), true);

assert.equal(trialBookingAlreadyHandled("sent"), true);
assert.equal(trialBookingAlreadyHandled("skipped"), true);
assert.equal(trialBookingAlreadyHandled("pending"), false);
assert.equal(trialBookingAlreadyHandled(undefined), false);

assert.equal(trialPurchaseTemplateBlockedByZoe("zoe"), true);
assert.equal(trialPurchaseTemplateBlockedByZoe(null), false);

assert.equal(
  trialBookingInWindowChannel({ resolvedBodyEmpty: false, templateApproved: true }),
  "free"
);
assert.equal(
  trialBookingInWindowChannel({ resolvedBodyEmpty: false, templateApproved: false }),
  "free"
);
assert.equal(
  trialBookingInWindowChannel({ resolvedBodyEmpty: true, templateApproved: true }),
  "template"
);
assert.equal(
  trialBookingInWindowChannel({ resolvedBodyEmpty: true, templateApproved: false }),
  "nothing"
);

assert.deepEqual(
  trialBookingTemplateFollowUp({
    confirmStatus: "sent",
    freeBlocked: false,
    templateNameConfigured: true,
    templateApproved: true,
  }),
  "skip"
);
assert.deepEqual(
  trialBookingTemplateFollowUp({
    confirmStatus: "skipped",
    freeBlocked: false,
    templateNameConfigured: true,
    templateApproved: true,
  }),
  "send"
);
assert.deepEqual(
  trialBookingTemplateFollowUp({
    confirmStatus: "skipped",
    freeBlocked: false,
    templateNameConfigured: true,
    templateApproved: false,
  }),
  "wait"
);
assert.deepEqual(
  trialBookingTemplateFollowUp({
    confirmStatus: "skipped",
    freeBlocked: false,
    templateNameConfigured: false,
    templateApproved: false,
  }),
  "skip"
);
assert.deepEqual(
  trialBookingTemplateFollowUp({
    confirmStatus: "skipped",
    freeBlocked: true,
    templateNameConfigured: true,
    templateApproved: true,
  }),
  "skip"
);

assert.equal(formatTrialBookingConfirmDate("2026-10-07"), "07/10/2026");
assert.equal(formatTrialBookingConfirmTime("08:30"), "8:30");
assert.equal(formatTrialBookingConfirmTime("19:00"), "19:00");

assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "outside_24h_window" }), true);
assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "no_user_session" }), true);
assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "send_failed" }), false);
assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "empty_body" }), false);

console.log("arbox-trial-booking-confirm.test.ts: ok");
