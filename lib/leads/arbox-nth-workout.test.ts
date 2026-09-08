import assert from "node:assert/strict";
import {
  countAttendedWorkoutsSinceJoin,
  isWithinNewCustomerWindow,
  joinDateCoveredByBookingsFetch,
  nthWorkoutDedupKey,
  nthWorkoutLookbackDays,
  nthWorkoutN,
  nthWorkoutNeedsSoftSeed,
  shouldSeedNthWorkout,
  shouldSendNthWorkout,
  uniqueNthWorkoutMembers,
} from "@/lib/leads/arbox-nth-workout";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import { resolveTemplateBodyParamValues } from "@/lib/template-send-params";
import {
  defaultDelayDays,
  formatDelayLabel,
  formatLookbackLabel,
  isNthWorkoutTriggerType,
  isTriggerType,
  isUniquePerBusinessTriggerType,
  minDelayDaysForTrigger,
  NTH_WORKOUT_LOOKBACK_MAX,
  parseLookbackDays,
  triggerTypeLabel,
} from "@/lib/trigger-catalog";

{
  assert.equal(nthWorkoutN(3), 3);
  assert.equal(nthWorkoutN(10), 10);
  assert.equal(nthWorkoutN(0), 1);
  assert.equal(nthWorkoutN(null), 1);
  assert.equal(nthWorkoutLookbackDays(null), 30);
  assert.equal(nthWorkoutLookbackDays(14), 14);
  assert.equal(nthWorkoutLookbackDays(90), 30);
  assert.equal(nthWorkoutLookbackDays(0), 30);
  assert.equal(parseLookbackDays(14), 14);
  assert.equal(parseLookbackDays(null), null);
  assert.equal(parseLookbackDays(31), "invalid");
  assert.equal(NTH_WORKOUT_LOOKBACK_MAX, 30);
}

{
  const today = "2026-09-08";
  assert.equal(
    isWithinNewCustomerWindow({
      memberSinceYmd: "2026-08-25",
      todayYmd: today,
      lookbackDays: 30,
    }),
    true
  );
  assert.equal(
    isWithinNewCustomerWindow({
      memberSinceYmd: "2026-07-01",
      todayYmd: today,
      lookbackDays: 30,
    }),
    false,
    "veteran outside window is not a new customer"
  );
  assert.equal(
    isWithinNewCustomerWindow({
      memberSinceYmd: "2026-08-20",
      todayYmd: today,
      lookbackDays: 14,
    }),
    false
  );
  assert.equal(joinDateCoveredByBookingsFetch("2026-08-10", "2026-08-10"), true);
  assert.equal(joinDateCoveredByBookingsFetch("2026-08-09", "2026-08-10"), false);
}

{
  const bookings = [
    { user_id: 11, check_in: "Yes", date: "2026-08-20" },
    { user_id: 11, check_in: "Yes", date: "2026-08-28" },
    { user_id: 11, check_in: "Yes", date: "2026-09-05" },
    { user_id: 11, check_in: "No", date: "2026-09-06" },
    { user_id: 11, check_in: "Yes", date: "2026-09-08" },
    { user_id: 12, check_in: "Yes", date: "2026-09-05" },
  ];
  assert.equal(
    countAttendedWorkoutsSinceJoin({
      bookings,
      userId: 11,
      memberSinceYmd: "2026-08-25",
      todayYmd: "2026-09-08",
    }),
    2,
    "Yes rows before member_since are not counted"
  );
  assert.equal(
    countAttendedWorkoutsSinceJoin({
      bookings,
      userId: 11,
      memberSinceYmd: "2026-08-01",
      todayYmd: "2026-09-08",
    }),
    3,
    "today's class is not a completed workout yet"
  );
}

{
  assert.equal(shouldSeedNthWorkout({ yesCount: 3, n: 3 }), true);
  assert.equal(shouldSeedNthWorkout({ yesCount: 5, n: 3 }), true);
  assert.equal(shouldSeedNthWorkout({ yesCount: 2, n: 3 }), false);

  assert.equal(
    shouldSendNthWorkout({ yesCount: 3, n: 3, hasTerminalLog: false }),
    true,
    "exactly N fires"
  );
  assert.equal(
    shouldSendNthWorkout({ yesCount: 5, n: 3, hasTerminalLog: false }),
    true,
    ">= N still fires once if no log (missed cron / two-a-day)"
  );
  assert.equal(
    shouldSendNthWorkout({ yesCount: 5, n: 3, hasTerminalLog: true }),
    false,
    "terminal log blocks a second send"
  );
  assert.equal(shouldSendNthWorkout({ yesCount: 2, n: 3, hasTerminalLog: false }), false);
}

{
  const rule3 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const rule10 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  assert.equal(nthWorkoutDedupKey(rule3, 11), nthWorkoutDedupKey(rule3, 11));
  assert.notEqual(nthWorkoutDedupKey(rule3, 11), nthWorkoutDedupKey(rule10, 11));
  assert.equal(
    shouldSendNthWorkout({ yesCount: 3, n: 3, hasTerminalLog: true }),
    false,
    "returning member with an existing log does not get C7 again"
  );
  const uniques = uniqueNthWorkoutMembers([
    {
      userId: 11,
      memberSinceYmd: "2025-01-01",
      phone: "0500000001",
    },
    {
      userId: 11,
      memberSinceYmd: "2026-08-20",
      phone: "0500000001",
    },
  ]);
  assert.equal(uniques.length, 1);
  assert.equal(uniques[0]?.memberSinceYmd, "2026-08-20");
}

{
  assert.equal(nthWorkoutNeedsSoftSeed({ nthWorkoutSeeded: true, logCount: 0 }), true);
  assert.equal(nthWorkoutNeedsSoftSeed({ nthWorkoutSeeded: true, logCount: 1 }), false);
  assert.equal(nthWorkoutNeedsSoftSeed({ nthWorkoutSeeded: false, logCount: 0 }), false);
}

{
  assert.equal(isTriggerType("nth_workout"), true);
  assert.equal(isNthWorkoutTriggerType("nth_workout"), true);
  assert.equal(triggerTypeLabel("nth_workout"), "אימון מספר N (לקוח חדש)");
  assert.equal(isUniquePerBusinessTriggerType("nth_workout"), false);
  assert.equal(minDelayDaysForTrigger("nth_workout"), 1);
  assert.equal(defaultDelayDays("nth_workout"), 3);
  assert.equal(formatDelayLabel("nth_workout", 3, "after"), "אימון מספר 3");
  assert.equal(formatLookbackLabel(30), "30 ימים כלקוח חדש");
}

{
  assert.equal(TEMPLATE_PRESETS.nth_workout.category, "MARKETING");
  assert.equal(TEMPLATE_PRESETS.nth_workout.name, "nth_workout");
  assert.equal(TEMPLATE_PRESETS.nth_workout.button_text, undefined);
  assert.equal(
    TEMPLATE_PRESETS.nth_workout.body,
    "היי {{1}}, ראינו שהיית לאחרונה, זה כבר האימון ה-{{2}} שלך אצלנו, נשמח לפידבק ולהגדיר מטרות."
  );
  assert.doesNotMatch(TEMPLATE_PRESETS.nth_workout.body, /אתמול/);
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "nth_workout",
      storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.nth_workout.body }],
      firstName: "דנה כהן",
      workoutN: 3,
    }),
    ["דנה", "3"]
  );
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "nth_workout",
      storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.nth_workout.body }],
      firstName: "דנה כהן",
      workoutN: 10,
    }),
    ["דנה", "10"]
  );
}

console.log("arbox-nth-workout.test.ts: ok");
