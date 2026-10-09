import assert from "node:assert/strict";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import {
  decideScheduledDrainDispatch,
  isDuePendingScheduledSend,
} from "@/lib/scheduled-template-sends";
import {
  decideShabbatTriggerSend,
  isSaturdayEveningHoldCatchUp,
  shabbatPolicyKind,
  shouldSkipDailyHoldSteps,
  shouldSkipEveningHoldSteps,
} from "@/lib/shabbat-send-policy";
import { postTrialSeedAction } from "@/lib/leads/arbox-post-trial-followup";
import { isLostLeadImmediateDue, LOST_LEAD_LOOKBACK_DAYS } from "@/lib/leads/arbox-lost-lead";
import {
  CREDIT_REFUSAL_MIN_LOOKBACK_DAYS,
  resolveCreditRefusalDateRange,
} from "@/lib/leads/arbox-credit-refusal";
import { classCancelQuietHoursDecision } from "@/lib/leads/arbox-class-cancelled-customer";

const fri1500 = israelWallTimeToUtc("2026-10-09", "15:00");
const fri1700 = israelWallTimeToUtc("2026-10-09", "17:00");
const sat0900 = israelWallTimeToUtc("2026-10-10", "09:00");
const sat1800 = israelWallTimeToUtc("2026-10-10", "18:00");
const sat2000 = israelWallTimeToUtc("2026-10-10", "20:00");
const sun0900 = israelWallTimeToUtc("2026-10-11", "09:00");
const thu1400 = israelWallTimeToUtc("2026-10-08", "14:00");
const thu0200 = israelWallTimeToUtc("2026-10-08", "02:00");

const SEND_TYPES = [
  "class_cancelled_customer",
  "class_cancelled_staff",
  "trial_reminder",
  "trainer_trial_heads_up",
  "trial_booked",
  "purchase",
  "first_paid_purchase",
  "membership_cancelled",
  "freeze_created",
  "incoming_lead",
  "site_lead",
  "arbox_new_lead",
] as const;

const HOLD_TYPES = [
  "missed_class",
  "missed_trial",
  "attendance_gap",
  "lost_lead",
  "no_response",
  "birthday",
  "birthday_former",
  "nth_workout",
  "days_in_club",
  "milestones",
  "sessions_expiring",
  "membership_expiring",
  "freeze_ending_unbooked",
  "freeze_ending_booked",
  "not_registered_after_trial",
  "credit_refusal",
  "lead_status_changed",
] as const;

for (const type of SEND_TYPES) {
  assert.equal(shabbatPolicyKind({ triggerType: type }), "send", type);
  assert.equal(decideShabbatTriggerSend(sat0900, { triggerType: type }).action, "send", type);
  assert.equal(decideShabbatTriggerSend(thu1400, { triggerType: type }).action, "send", type);
}

for (const type of HOLD_TYPES) {
  assert.equal(shabbatPolicyKind({ triggerType: type }), "hold", type);
  assert.equal(decideShabbatTriggerSend(sat0900, { triggerType: type }).action, "hold", type);
  assert.equal(decideShabbatTriggerSend(fri1700, { triggerType: type }).action, "hold", type);
  assert.equal(decideShabbatTriggerSend(sat2000, { triggerType: type }).action, "send", `${type} after window`);
  assert.equal(decideShabbatTriggerSend(thu1400, { triggerType: type }).action, "send", `${type} weekday`);
}

assert.equal(shabbatPolicyKind({ triggerType: "registered_after_trial", delayDays: 0 }), "send");
assert.equal(shabbatPolicyKind({ triggerType: "registered_after_trial", delayDays: 3 }), "hold");
assert.equal(
  decideShabbatTriggerSend(sat0900, { triggerType: "registered_after_trial", delayDays: 0 }).action,
  "send"
);
assert.equal(
  decideShabbatTriggerSend(sat0900, { triggerType: "registered_after_trial", delayDays: 3 }).action,
  "hold"
);

assert.equal(shouldSkipDailyHoldSteps(sat0900, "morning"), true);
assert.equal(shouldSkipDailyHoldSteps(fri1500, "morning"), false);
assert.equal(shouldSkipDailyHoldSteps(sun0900, "morning"), false);
assert.equal(shouldSkipDailyHoldSteps(sat2000, "evening"), false);

assert.equal(shouldSkipEveningHoldSteps(fri1700), true);
assert.equal(shouldSkipEveningHoldSteps(sat2000), false);

assert.equal(isSaturdayEveningHoldCatchUp(sat2000, "evening"), true);
assert.equal(isSaturdayEveningHoldCatchUp(sat0900, "morning"), false);
assert.equal(isSaturdayEveningHoldCatchUp(fri1700, "evening"), false);
assert.equal(isSaturdayEveningHoldCatchUp(sun0900, "evening"), false);

/** Saturday 09:00-due post-trial is still send at Saturday 20:00, never history. */
assert.equal(
  postTrialSeedAction({ classDateYmd: "2026-10-09", delayDays: 1, todayYmd: "2026-10-10" }),
  "send"
);
assert.equal(
  postTrialSeedAction({ classDateYmd: "2026-10-09", delayDays: 1, todayYmd: "2026-10-11" }),
  "seed"
);

/** lost_lead delay 0: Friday mark is still due Saturday 19:00+ (today/yesterday). */
assert.equal(isLostLeadImmediateDue("2026-10-09", "2026-10-10"), true);
assert.equal(isLostLeadImmediateDue("2026-10-10", "2026-10-10"), true);
assert.equal(LOST_LEAD_LOOKBACK_DAYS >= 3, true);

/** credit_refusal lookback stays at least 3 days after the shared cursor advanced. */
{
  const afterWindow = israelWallTimeToUtc("2026-10-10", "19:15");
  const range = resolveCreditRefusalDateRange({
    arboxLastSyncAt: afterWindow.toISOString(),
    now: afterWindow,
  });
  assert.equal(CREDIT_REFUSAL_MIN_LOOKBACK_DAYS, 3);
  assert.ok(range.fromDate <= "2026-10-07", range.fromDate);
  assert.ok(range.fromDate <= "2026-10-09", "covers Friday refusals");
}

/** Queue: retention holds on Saturday morning; class cancel / confirmations dispatch. */
assert.equal(decideScheduledDrainDispatch(sat0900).action, "hold");
assert.equal(decideScheduledDrainDispatch(sat0900, { triggerType: "birthday" }).action, "hold");
assert.equal(
  decideScheduledDrainDispatch(sat0900, { triggerType: "class_cancelled_customer" }).action,
  "dispatch"
);
assert.equal(decideScheduledDrainDispatch(sat0900, { triggerType: "trial_booked" }).action, "dispatch");
assert.equal(decideScheduledDrainDispatch(sat0900, { triggerType: "purchase" }).action, "dispatch");
assert.equal(classCancelQuietHoursDecision(sat0900), "send");
assert.equal(classCancelQuietHoursDecision(sat1800), "send");
assert.equal(classCancelQuietHoursDecision(thu0200), "hold");
assert.equal(decideScheduledDrainDispatch(thu0200, { triggerType: "purchase" }).action, "hold");
assert.equal(decideScheduledDrainDispatch(sat2000, { triggerType: "birthday" }).action, "dispatch");

/** 15-min drain lookback: a Friday-window due row is still due at Saturday 19:15. */
{
  const fri1630 = israelWallTimeToUtc("2026-10-09", "16:30");
  const sat1915 = israelWallTimeToUtc("2026-10-10", "19:15");
  const row = { status: "pending", due_at: fri1630.toISOString() };
  assert.equal(isDuePendingScheduledSend(row, sat0900), true);
  assert.equal(isDuePendingScheduledSend(row, sat1915), true);
  assert.equal(decideScheduledDrainDispatch(sat1915, { triggerType: "birthday" }).action, "dispatch");
}

/** Override hook: a later per-business row can flip one type. */
assert.equal(
  shabbatPolicyKind({
    triggerType: "birthday",
    override: { sendTypes: ["birthday"] },
  }),
  "send"
);

console.log("shabbat-send-policy.test.ts: ok");
