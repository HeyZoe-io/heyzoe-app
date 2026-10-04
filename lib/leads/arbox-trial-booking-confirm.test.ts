import assert from "node:assert/strict";
import {
  formatTrialBookingConfirmDate,
  formatTrialBookingConfirmTime,
  trialBookingConfirmEnabled,
  trialBookingConfirmIsTerminalSkip,
} from "@/lib/leads/arbox-trial-booking-confirm";

assert.equal(trialBookingConfirmEnabled("tights"), true);
assert.equal(trialBookingConfirmEnabled("Tights"), true);
assert.equal(trialBookingConfirmEnabled("other"), false);

assert.equal(formatTrialBookingConfirmDate("2026-10-07"), "07/10/2026");
assert.equal(formatTrialBookingConfirmTime("08:30"), "8:30");
assert.equal(formatTrialBookingConfirmTime("19:00"), "19:00");

assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "outside_24h_window" }), true);
assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "no_user_session" }), true);
assert.equal(trialBookingConfirmIsTerminalSkip({ sent: false, reason: "send_failed" }), false);

console.log("arbox-trial-booking-confirm.test.ts: ok");
