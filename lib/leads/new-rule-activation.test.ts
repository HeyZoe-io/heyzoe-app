import assert from "node:assert/strict";
import { EVENING_RETRY_SLOT_IL, EVENING_SLOT_IL } from "@/lib/daily-run-slots";
import { attendanceGapDueAction } from "@/lib/leads/arbox-attendance-gap";
import { isDaysInClubDueToday } from "@/lib/leads/arbox-days-in-club";
import { lostLeadNormalSendAt, lostLeadTargetYmd } from "@/lib/leads/arbox-lost-lead";
import {
  isExactDaysAfterEvent,
  membershipCancelledActivationAction,
} from "@/lib/leads/arbox-membership-cancelled";
import { nthWorkoutAfterDueAction } from "@/lib/leads/arbox-nth-workout";
import { postTrialSeedAction } from "@/lib/leads/arbox-post-trial-followup";
import {
  isTrialReminderDue,
  trialReminderNormalSendAt,
} from "@/lib/leads/arbox-trial-reminder";
import {
  addCalendarDaysYmd,
  decideActivationEventAction,
  israelSlotInstant,
} from "@/lib/rule-activation";

const today = "2026-10-08";
const now = new Date("2026-10-08T06:00:00.000Z");

function clockAction(sendAt: Date | null): "seed" | "send" {
  return decideActivationEventAction({ sendAt, now });
}

{
  const earlier = "2026-09-01";
  const dueToday = "2026-09-08";
  const later = "2026-09-09";
  const delay = 30;
  assert.equal(
    clockAction(israelSlotInstant(addCalendarDaysYmd(earlier, delay)!, "09:00")),
    "seed"
  );
  assert.equal(isDaysInClubDueToday({ memberSinceYmd: earlier, todayYmd: today, delayDays: delay }), false);
  assert.equal(
    clockAction(israelSlotInstant(addCalendarDaysYmd(dueToday, delay)!, "09:00")),
    "send"
  );
  assert.equal(isDaysInClubDueToday({ memberSinceYmd: dueToday, todayYmd: today, delayDays: delay }), true);
  assert.equal(
    clockAction(israelSlotInstant(addCalendarDaysYmd(later, delay)!, "09:00")),
    "send"
  );
  assert.equal(isDaysInClubDueToday({ memberSinceYmd: later, todayYmd: today, delayDays: delay }), false);
}

{
  const delay = 45;
  const dueTodayLost = lostLeadTargetYmd(today, delay);
  const earlierLost = addCalendarDaysYmd(dueTodayLost, -1)!;
  const laterLost = addCalendarDaysYmd(dueTodayLost, 1)!;
  assert.equal(clockAction(lostLeadNormalSendAt(earlierLost, delay, today, now)), "seed");
  assert.equal(isExactDaysAfterEvent({ eventYmd: earlierLost, todayYmd: today, delayDays: delay }), false);
  assert.equal(clockAction(lostLeadNormalSendAt(dueTodayLost, delay, today, now)), "send");
  assert.equal(isExactDaysAfterEvent({ eventYmd: dueTodayLost, todayYmd: today, delayDays: delay }), true);
  assert.equal(clockAction(lostLeadNormalSendAt(laterLost, delay, today, now)), "send");
  assert.equal(isExactDaysAfterEvent({ eventYmd: laterLost, todayYmd: today, delayDays: delay }), false);
}

{
  assert.equal(
    membershipCancelledActivationAction({ eventYmd: "2026-10-07", delayDays: 0, todayYmd: today }),
    "seed"
  );
  assert.equal(
    membershipCancelledActivationAction({ eventYmd: today, delayDays: 0, todayYmd: today }),
    "send"
  );
  assert.equal(
    membershipCancelledActivationAction({ eventYmd: today, delayDays: 7, todayYmd: today }),
    "later"
  );
  assert.equal(
    membershipCancelledActivationAction({ eventYmd: "2026-10-01", delayDays: 7, todayYmd: today }),
    "send"
  );
}

{
  const memberSince = "2026-09-01";
  const userId = 7;
  const row = (date: string) => ({
    user_id: userId,
    date,
    time: "18:00",
    check_in: "Yes",
  });
  const earlier = nthWorkoutAfterDueAction({
    bookings: [row("2026-10-01"), row("2026-10-03"), row("2026-10-05")],
    userId,
    memberSinceYmd: memberSince,
    todayYmd: today,
    n: 3,
    now,
  });
  assert.equal(earlier, "seed");
  const dueToday = nthWorkoutAfterDueAction({
    bookings: [row("2026-10-01"), row("2026-10-03"), row("2026-10-07")],
    userId,
    memberSinceYmd: memberSince,
    todayYmd: today,
    n: 3,
    now,
  });
  assert.equal(dueToday, "send");
  const later = nthWorkoutAfterDueAction({
    bookings: [row("2026-10-01"), row("2026-10-07")],
    userId,
    memberSinceYmd: memberSince,
    todayYmd: today,
    n: 3,
    now,
  });
  assert.equal(later, "later");
  const onItsDay = nthWorkoutAfterDueAction({
    bookings: [row("2026-10-01"), row("2026-10-07"), row("2026-10-08")],
    userId,
    memberSinceYmd: memberSince,
    todayYmd: "2026-10-09",
    n: 3,
    now: new Date("2026-10-09T06:00:00.000Z"),
  });
  assert.equal(onItsDay, "send");
}

{
  const earlierAt = trialReminderNormalSendAt({
    classDateYmd: "2026-10-08",
    classTime: "18:00",
    delayDays: 2,
  });
  assert.equal(clockAction(earlierAt), "seed");
  assert.equal(
    isTrialReminderDue({ classDateYmd: "2026-10-08", todayYmd: today, delayDays: 2 }),
    false
  );
  const dueTodayAt = trialReminderNormalSendAt({
    classDateYmd: "2026-10-09",
    classTime: "18:00",
    delayDays: 1,
  });
  assert.equal(clockAction(dueTodayAt), "send");
  assert.equal(
    isTrialReminderDue({ classDateYmd: "2026-10-09", todayYmd: today, delayDays: 1 }),
    true
  );
  const laterAt = trialReminderNormalSendAt({
    classDateYmd: "2026-10-11",
    classTime: "18:00",
    delayDays: 1,
  });
  assert.equal(clockAction(laterAt), "send");
  assert.equal(
    isTrialReminderDue({ classDateYmd: "2026-10-11", todayYmd: today, delayDays: 1 }),
    false
  );
}

{
  assert.equal(
    postTrialSeedAction({
      classDateYmd: "2026-10-06",
      delayDays: 1,
      todayYmd: today,
    }),
    "seed"
  );
  assert.equal(
    postTrialSeedAction({
      classDateYmd: "2026-10-07",
      delayDays: 1,
      todayYmd: today,
    }),
    "send",
    "C6 due today still sends on first soft-seed after 09:00"
  );
  assert.equal(
    postTrialSeedAction({
      classDateYmd: today,
      delayDays: 1,
      todayYmd: today,
    }),
    "later"
  );
}

/** A run reaches a row seconds after its slot: due, not history. */
{
  const morningRun = new Date("2026-10-08T06:00:20.871Z");
  const eveningRun = new Date("2026-10-07T17:00:20.000Z");

  const irenaFreezeEnding = israelSlotInstant("2026-10-08", "09:00");
  assert.equal(
    decideActivationEventAction({ sendAt: irenaFreezeEnding, now: morningRun }),
    "send",
    "Irena: freeze_ending due 09:00, run at 09:00:20"
  );

  assert.equal(
    attendanceGapDueAction({ lastYesYmd: "2026-09-30", tier: 8, now: morningRun }),
    "send",
    "Limitless: attendance_gap first run reaches a tier due today"
  );
  assert.equal(
    attendanceGapDueAction({ lastYesYmd: "2026-09-29", tier: 8, now: morningRun }),
    "seed",
    "Limitless: a tier due yesterday is still history"
  );

  const linoySendAt = trialReminderNormalSendAt({
    classDateYmd: "2026-10-08",
    classTime: "17:00",
    delayDays: 1,
  });
  assert.equal(
    decideActivationEventAction({ sendAt: linoySendAt, now: eveningRun }),
    "send",
    "Linoy: trial_reminder 20:00 the evening before, run at 20:00:20"
  );
  assert.equal(
    decideActivationEventAction({ sendAt: linoySendAt, now: morningRun }),
    "seed",
    "Linoy: the next morning that evening send is an earlier day"
  );

  assert.equal(
    decideActivationEventAction({
      sendAt: israelSlotInstant("2026-10-08", "09:00"),
      now: new Date("2026-10-08T17:00:20.000Z"),
    }),
    "seed",
    "the evening run does not pick up this morning's slot"
  );
  assert.equal(
    decideActivationEventAction({
      sendAt: israelSlotInstant("2026-10-08", "07:00"),
      now: new Date("2026-10-08T05:00:00.000Z"),
    }),
    "send",
    "before the first slot, earlier today is still today"
  );
  assert.equal(decideActivationEventAction({ sendAt: null, now: morningRun }), "seed");
}

/** A row due at the evening slot is sent by a run that starts at 20:00 or shortly after it. */
{
  assert.equal(EVENING_SLOT_IL, "20:00");
  assert.equal(EVENING_RETRY_SLOT_IL, "20:20");
  const dueAtEvening = trialReminderNormalSendAt({
    classDateYmd: "2026-10-10",
    classTime: "18:00",
    delayDays: 1,
  });
  assert.equal(dueAtEvening?.toISOString(), "2026-10-09T17:00:00.000Z", "due at 20:00 IL the evening before");
  for (const [at, label] of [
    ["2026-10-09T16:59:58.000Z", "cron fires 2s early"],
    ["2026-10-09T17:00:00.000Z", "run at exactly 20:00:00"],
    ["2026-10-09T17:00:20.000Z", "run at 20:00:20"],
    ["2026-10-09T17:04:30.000Z", "run at 20:04:30"],
    ["2026-10-09T17:20:05.000Z", "retry pass at 20:20:05"],
  ] as const) {
    assert.equal(
      decideActivationEventAction({ sendAt: dueAtEvening, now: new Date(at) }),
      "send",
      `evening row: ${label}`
    );
  }
  assert.equal(
    decideActivationEventAction({ sendAt: dueAtEvening, now: new Date("2026-10-10T06:00:20.000Z") }),
    "seed",
    "the next morning it is history"
  );
}

console.log("new-rule-activation.test.ts: ok");
