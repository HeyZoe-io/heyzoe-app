import assert from "node:assert/strict";
import {
  formatTrialBookingConfirmDate,
  formatTrialBookingConfirmTime,
  trialBookingAlreadyHandled,
  trialBookingClassHasStarted,
  trialBookingConfirmEnabled,
  trialBookingConfirmIsTerminalSkip,
  trialBookingTemplateFollowUp,
} from "@/lib/leads/arbox-trial-booking-confirm";
import { trialBookedSendsEnabled } from "@/lib/leads/trial-booked-kill-switch";
import { trialPurchaseTemplateBlockedByZoe } from "@/lib/trial-signup-notice";

assert.equal(trialBookedSendsEnabled(), true);
assert.equal(trialBookingConfirmEnabled(false), false);
assert.equal(trialBookingConfirmEnabled(true), true);

assert.equal(trialBookingAlreadyHandled("sent"), true);
assert.equal(trialBookingAlreadyHandled("skipped"), true);
assert.equal(trialBookingAlreadyHandled("pending"), true);
assert.equal(trialBookingAlreadyHandled("failed"), true);
assert.equal(trialBookingAlreadyHandled(undefined), false);

const tenJerusalem = new Date("2026-10-05T07:00:00.000Z");
const tenOhOneJerusalem = new Date("2026-10-05T07:01:00.000Z");
assert.equal(trialBookingClassHasStarted("2026-10-05", "10:00", tenJerusalem), false);
assert.equal(trialBookingClassHasStarted("2026-10-05", "10:00", tenOhOneJerusalem), true);
assert.equal(trialBookingClassHasStarted("2026-10-04", "23:00", tenJerusalem), true);
assert.equal(trialBookingClassHasStarted("2026-10-06", "08:00", tenJerusalem), false);

assert.equal(trialPurchaseTemplateBlockedByZoe("zoe"), true);
assert.equal(trialPurchaseTemplateBlockedByZoe(null), false);

assert.deepEqual(
  trialBookingTemplateFollowUp({
    confirmStatus: "sent",
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
  "send"
);
assert.equal(
  trialBookingTemplateFollowUp({
    confirmStatus: "sent",
    freeBlocked: false,
    templateNameConfigured: true,
    templateApproved: true,
    templateBesidesFreeMessage: true,
  }),
  "send"
);
assert.equal(
  trialBookingTemplateFollowUp({
    confirmStatus: "sent",
    freeBlocked: true,
    templateNameConfigured: true,
    templateApproved: true,
    templateBesidesFreeMessage: true,
  }),
  "send"
);

assert.equal(formatTrialBookingConfirmDate("2026-10-07"), "07/10/2026");
assert.equal(formatTrialBookingConfirmTime("08:30"), "8:30");
assert.equal(formatTrialBookingConfirmTime("19:00"), "19:00");

assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "outside_24h_window" }), true);
assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "no_user_session" }), true);
assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "send_failed" }), false);

console.log("arbox-trial-booking-confirm.test.ts: ok");
