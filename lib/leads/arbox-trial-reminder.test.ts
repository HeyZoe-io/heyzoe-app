import assert from "node:assert/strict";
import {
  addIsraelCalendarDays,
  claimTrialReminderSend,
  classStartMinutes,
  isTrialReminderDue,
  trialReminderSendAllowedNow,
  normalizeTrialReminderClassNamePk,
  normalizeTrialReminderClassTimePk,
  parseTrialReminderUserId,
  reminderEarlyCutoffHm,
  trialReminderFutureWindow,
  trialReminderHasConfiguredIds,
  trialReminderMatchesSlot,
  trialReminderNeedsSoftSeed,
  trialReminderNormalSendAt,
  trialReminderSendsEveningBefore,
  trialReminderBookedAfterEveningRun,
  TRIAL_REMINDER_BOOKED_AFTER_EVENING_RUN,
  earlyCutoffMatchesSlot,
  earlyCutoffNormalSendAt,
  TRIAL_REMINDER_FUTURE_SPAN_DAYS,
  TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_DATE,
  TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_NAME,
  TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_TIME,
  TRIAL_REMINDER_SOFT_SEED_SENTINEL_USER_ID,
} from "@/lib/leads/arbox-trial-reminder";
import {
  ARBOX_SYNC_SEND_ATTEMPT_CAP,
  nextCancellationSyncLogAfterDispatch,
} from "@/lib/leads/arbox-membership-cancelled";
import { sharedFutureBookingsWindow } from "@/lib/leads/arbox-attendance-gap";
import {
  bookingMatchesTrialScope,
  buildBookingsReportPath,
  membershipTypeNameLooksLikeTrial,
  normalizeMembershipTypeName,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { shouldFetchNextArboxReportPage, ARBOX_REPORT_PAGE_SIZE } from "@/lib/leads/arbox-sales-report";
import { buildTrialReminderScheduledDedupKey } from "@/lib/scheduled-template-sends";
import { formatDateYmdIsrael } from "@/lib/leads/arbox-membership-cancelled";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  classNameFromScheduledDedupKey,
  classTimeFromScheduledDedupKey,
  resolveTemplateBodyParamValues,
  triggerTypeFromScheduledDedupKey,
} from "@/lib/template-send-params";
import {
  defaultDelayDays,
  defaultDelayDirection,
  formatDelayLabel,
  isUniquePerBusinessTriggerType,
  minDelayDaysForTrigger,
  showsProductFilter,
  uniqueCreateModeFor,
} from "@/lib/trigger-catalog";

assert.equal(TRIAL_REMINDER_FUTURE_SPAN_DAYS, 14);
assert.equal(TRIAL_REMINDER_SOFT_SEED_SENTINEL_USER_ID, 0);
assert.equal(TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_DATE, "1970-01-01");
assert.equal(TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_TIME, "-");
assert.equal(TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_NAME, "seed");

{
  const now = new Date("2026-09-07T12:00:00.000Z");
  const withToday = trialReminderFutureWindow(now);
  assert.equal(withToday.fromDate, "2026-09-07");
  assert.equal(withToday.toDate, "2026-09-21");
  const freezeOnly = sharedFutureBookingsWindow(now, { includeToday: false });
  assert.equal(freezeOnly.fromDate, "2026-09-08");
  assert.equal(freezeOnly.toDate, "2026-09-21");
}

{
  assert.equal(
    isTrialReminderDue({ classDateYmd: "2026-09-08", todayYmd: "2026-09-07", delayDays: 1 }),
    true
  );
  assert.equal(
    isTrialReminderDue({ classDateYmd: "2026-09-07", todayYmd: "2026-09-07", delayDays: 0 }),
    true
  );
  assert.equal(
    isTrialReminderDue({ classDateYmd: "2026-09-07", todayYmd: "2026-09-07", delayDays: 1 }),
    false
  );
  assert.equal(
    isTrialReminderDue({ classDateYmd: "2026-09-09", todayYmd: "2026-09-07", delayDays: 1 }),
    false
  );
  assert.equal(
    isTrialReminderDue({ classDateYmd: "2026-09-10", todayYmd: "2026-09-07", delayDays: 0 }),
    false
  );
}

{
  assert.equal(trialReminderNeedsSoftSeed({ trialReminderSeeded: true, logCount: 0 }), true);
  assert.equal(trialReminderNeedsSoftSeed({ trialReminderSeeded: true, logCount: 1 }), false);
  assert.equal(trialReminderNeedsSoftSeed({ trialReminderSeeded: false, logCount: 0 }), false);
}

{
  assert.equal(trialReminderHasConfiguredIds([297742], null), true);
  assert.equal(trialReminderHasConfiguredIds(null, [586475]), true);
  assert.equal(trialReminderHasConfiguredIds([], []), false);
  assert.equal(trialReminderHasConfiguredIds(null, null), false);
}

{
  assert.equal(normalizeTrialReminderClassTimePk("  18:00  "), "18:00");
  assert.equal(normalizeTrialReminderClassTimePk(""), null);
  assert.equal(normalizeTrialReminderClassNamePk("יוגה"), "יוגה");
  assert.equal(parseTrialReminderUserId(44123), 44123);
  assert.equal(parseTrialReminderUserId("0"), null);
}

/** Same C4 name-match; heuristic must NOT be used as a fallback for this trigger. */
{
  const names = new Set([normalizeMembershipTypeName("2 אימוני היכרות - כוח, פונקציונלי")]);
  const scope = { trialTypeIds: [297742], trialTypeNamesNormalized: names };
  const trialRow: ArboxBookingReportRow = {
    user_id: 1,
    membership_type_name: "2 אימוני היכרות - כוח, פונקציונלי",
    date: "2026-09-08",
    time: "09:00",
    class_name: "כוח",
  };
  const membershipRow: ArboxBookingReportRow = {
    user_id: 2,
    membership_type_name: "מנוי חודשי",
    date: "2026-09-08",
    time: "18:00",
    class_name: "HIIT",
  };
  const englishTrialName: ArboxBookingReportRow = {
    user_id: 3,
    membership_type_name: "trial class",
    date: "2026-09-08",
    time: "10:00",
    class_name: "Yoga",
  };
  assert.equal(bookingMatchesTrialScope(trialRow, scope), true);
  assert.equal(bookingMatchesTrialScope(membershipRow, scope), false);
  assert.equal(bookingMatchesTrialScope(englishTrialName, scope), false);
  assert.equal(
    bookingMatchesTrialScope(
      { ...englishTrialName, user_id: 4, membership_type_name: "trialClassTitle" },
      scope
    ),
    true
  );
  assert.equal(membershipTypeNameLooksLikeTrial("trial class"), true);
  assert.equal(membershipTypeNameLooksLikeTrial("2 אימוני היכרות - כוח, פונקציונלי"), false);
}

{
  assert.equal(
    shouldFetchNextArboxReportPage({
      pageRowsLength: ARBOX_REPORT_PAGE_SIZE,
      nextPageUrl: "http://x?page=2",
    }),
    true
  );
  assert.equal(
    shouldFetchNextArboxReportPage({ pageRowsLength: 199, nextPageUrl: "http://x?page=2" }),
    false
  );
  const path = buildBookingsReportPath({
    fromDate: "2026-09-07",
    toDate: "2026-09-21",
    locationId: "20547",
    page: 2,
  });
  assert.match(path, /bookingsReport/);
  assert.match(path, /page=2/);
}

{
  const key = buildTrialReminderScheduledDedupKey(
    1,
    "rule-uuid",
    44123,
    "2026-09-08",
    "18:00",
    "יוגה"
  );
  assert.equal(triggerTypeFromScheduledDedupKey(key), "trial_reminder");
  assert.equal(classNameFromScheduledDedupKey(key), "יוגה");
  assert.equal(classTimeFromScheduledDedupKey(key), "18:00");
}

{
  const gated = nextCancellationSyncLogAfterDispatch({
    dispatch: "gated",
    attemptsSoFar: 2,
  });
  assert.equal(gated.status, "pending");
  assert.equal(gated.attempts, 2);
  const failed = nextCancellationSyncLogAfterDispatch({
    dispatch: "send_failed",
    attemptsSoFar: 2,
  });
  assert.equal(failed.status, "abandoned");
  assert.equal(failed.attempts, ARBOX_SYNC_SEND_ATTEMPT_CAP);
}

{
  assert.equal(TEMPLATE_PRESETS.trial_reminder.category, "UTILITY");
  assert.equal(TEMPLATE_PRESETS.trial_reminder.button_text, undefined);
  assert.equal(
    TEMPLATE_PRESETS.trial_reminder.body,
    "היי {{1}}, רציתי לוודא הגעה לאימון הניסיון {{2}} ב{{3}} בשעה {{4}}. נשמח לראותך!"
  );
  const values = resolveTemplateBodyParamValues({
    triggerType: "trial_reminder",
    storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.trial_reminder.body }],
    firstName: "דנה",
    className: "יוגה",
    classTime: "18:00",
    classDateYmd: "2026-10-06",
  });
  assert.deepEqual(values, ["דנה", "יוגה", "יום שלישי 6.10", "18:00"]);
  const missingTime = resolveTemplateBodyParamValues({
    triggerType: "trial_reminder",
    storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.trial_reminder.body }],
    firstName: "דנה",
    className: "יוגה",
  });
  assert.deepEqual(missingTime, []);
}

{
  assert.equal(showsProductFilter("trial_reminder"), true);
  assert.equal(isUniquePerBusinessTriggerType("trial_reminder"), false);
  assert.equal(uniqueCreateModeFor("trial_reminder"), undefined);
  assert.equal(minDelayDaysForTrigger("trial_reminder"), 0);
  assert.equal(defaultDelayDays("trial_reminder"), 1);
  assert.equal(defaultDelayDirection("trial_reminder"), "before");
  assert.equal(formatDelayLabel("trial_reminder", 0, "before"), "ערב לפני האימון, 20:00");
  assert.equal(formatDelayLabel("trial_reminder", 1, "before"), "ערב לפני האימון, 20:00");
}

{
  const today = "2026-10-06";
  const tomorrow = "2026-10-07";
  const early = {
    classTime: "09:59",
    todayYmd: today,
    delayDays: 0,
    cutoffHm: "10:00",
  };
  const onTime = { ...early, classTime: "10:00" };
  assert.equal(
    earlyCutoffMatchesSlot({ ...early, classDateYmd: tomorrow, slot: "evening" }),
    true,
    "trainer split: 09:59 tomorrow is evening only"
  );
  assert.equal(earlyCutoffMatchesSlot({ ...early, classDateYmd: tomorrow, slot: "morning" }), false);
  assert.equal(earlyCutoffMatchesSlot({ ...early, classDateYmd: today, slot: "morning" }), false);
  assert.equal(earlyCutoffMatchesSlot({ ...onTime, classDateYmd: today, slot: "morning" }), true);
  assert.equal(earlyCutoffMatchesSlot({ ...onTime, classDateYmd: tomorrow, slot: "evening" }), false);
  assert.equal(
    earlyCutoffMatchesSlot({ ...early, classDateYmd: tomorrow, delayDays: 1, slot: "morning" }),
    true,
    "trainer split: delay 1 stays on the morning job"
  );
}

{
  const today = "2026-10-08";
  const tomorrow = "2026-10-09";
  for (const delayDays of [0, 1]) {
    for (const classTime of ["06:30", "09:59", "10:00", "13:00", "20:00"]) {
      const base = { classTime, todayYmd: today, delayDays };
      assert.equal(
        trialReminderMatchesSlot({ ...base, classDateYmd: tomorrow, slot: "evening" }),
        true,
        `delay ${delayDays} ${classTime}: tomorrow goes on the evening run`
      );
      assert.equal(
        trialReminderMatchesSlot({ ...base, classDateYmd: tomorrow, slot: "morning" }),
        false,
        `delay ${delayDays} ${classTime}: never on the 09:00 run`
      );
      assert.equal(trialReminderMatchesSlot({ ...base, classDateYmd: today, slot: "morning" }), false);
      assert.equal(trialReminderMatchesSlot({ ...base, classDateYmd: today, slot: "evening" }), false);
      assert.equal(
        trialReminderMatchesSlot({ ...base, classDateYmd: "2026-10-10", slot: "evening" }),
        false
      );
    }
    assert.equal(trialReminderSendsEveningBefore(delayDays), true);
  }
  assert.equal(trialReminderSendsEveningBefore(2), false);
  const two = { classTime: "07:00", todayYmd: today, delayDays: 2 };
  assert.equal(trialReminderMatchesSlot({ ...two, classDateYmd: "2026-10-10", slot: "morning" }), true);
  assert.equal(trialReminderMatchesSlot({ ...two, classDateYmd: "2026-10-10", slot: "evening" }), false);
  assert.equal(trialReminderMatchesSlot({ ...two, classDateYmd: tomorrow, slot: "evening" }), false);
}

{
  const today = "2026-10-09";
  assert.equal(
    trialReminderBookedAfterEveningRun({ classDateYmd: today, todayYmd: today, delayDays: 0, slot: "morning" }),
    true,
    "a class of today on the 09:00 run was booked after last evening"
  );
  assert.equal(
    trialReminderBookedAfterEveningRun({ classDateYmd: today, todayYmd: today, delayDays: 1, slot: "morning" }),
    true
  );
  assert.equal(
    trialReminderBookedAfterEveningRun({ classDateYmd: today, todayYmd: today, delayDays: 1, slot: "evening" }),
    false
  );
  assert.equal(
    trialReminderBookedAfterEveningRun({ classDateYmd: "2026-10-10", todayYmd: today, delayDays: 1, slot: "morning" }),
    false,
    "tomorrow's class still waits for tonight"
  );
  assert.equal(
    trialReminderBookedAfterEveningRun({ classDateYmd: today, todayYmd: today, delayDays: 2, slot: "morning" }),
    false
  );
  assert.equal(TRIAL_REMINDER_BOOKED_AFTER_EVENING_RUN, "booked_after_evening_run");
}

{
  const thursdayMorning = new Date("2026-10-08T06:00:00Z");
  const thursdayEvening = new Date("2026-10-08T17:00:00Z");
  const fridayClass = { classDateYmd: "2026-10-09", classTime: "09:00", delayDays: 1 };
  assert.equal(
    trialReminderSendAllowedNow({ ...fridayClass, slot: "morning", realNow: thursdayMorning }),
    false,
    "delay 1 Friday class no longer goes Thursday 09:00"
  );
  assert.equal(trialReminderSendAllowedNow({ ...fridayClass, slot: "evening", realNow: thursdayEvening }), true);
  assert.equal(
    trialReminderSendAllowedNow({
      classDateYmd: "2026-10-09",
      classTime: "19:00",
      delayDays: 0,
      slot: "evening",
      realNow: thursdayEvening,
    }),
    true,
    "delay 0 evening class goes the evening before"
  );
  assert.equal(
    trialReminderSendAllowedNow({
      classDateYmd: "2026-10-09",
      classTime: "19:00",
      delayDays: 0,
      slot: "morning",
      realNow: new Date("2026-10-09T06:00:00Z"),
    }),
    false
  );
  assert.equal(
    trialReminderNormalSendAt({ classDateYmd: "2026-10-09", classTime: "19:00", delayDays: 0 })?.toISOString(),
    "2026-10-08T17:00:00.000Z"
  );
  assert.equal(
    trialReminderNormalSendAt({ classDateYmd: "2026-10-09", classTime: "07:00", delayDays: 1 })?.toISOString(),
    "2026-10-08T17:00:00.000Z"
  );
  assert.equal(
    earlyCutoffNormalSendAt({ classDateYmd: "2026-10-09", classTime: "19:00", delayDays: 0 })?.toISOString(),
    "2026-10-09T06:00:00.000Z",
    "trainer heads-up timing is unchanged"
  );
}

{
  const fallbackInstant = new Date("2026-10-24T23:30:00.000Z");
  const israelToday = formatDateYmdIsrael(fallbackInstant);
  assert.equal(israelToday, "2026-10-25");
  assert.notEqual(fallbackInstant.toISOString().slice(0, 10), israelToday);
  const tomorrow = addIsraelCalendarDays(israelToday, 1);
  assert.equal(tomorrow, "2026-10-26");
  assert.equal(
    trialReminderMatchesSlot({
      classDateYmd: "2026-10-26",
      classTime: "07:00",
      todayYmd: israelToday,
      delayDays: 0,
      slot: "evening",
    }),
    true,
    "DST fallback evening still targets the Israel tomorrow"
  );
  assert.equal(
    trialReminderMatchesSlot({
      classDateYmd: "2026-10-25",
      classTime: "07:00",
      todayYmd: israelToday,
      delayDays: 0,
      slot: "evening",
    }),
    false
  );
}

{
  const booking = {
    businessId: 1,
    triggerId: "rule-1",
    userId: 42,
    classDateYmd: "2026-10-07",
    classTime: "09:59",
    className: "ניסיון",
    delayDays: 0,
  };
  const eveningDay = "2026-10-06";
  const morningDay = "2026-10-07";
  const run = (order: Array<"evening" | "morning">) => {
    const claimed = new Set<string>();
    const results = order.map((slot) =>
      claimTrialReminderSend({
        ...booking,
        claimedKeys: claimed,
        todayYmd: slot === "evening" ? eveningDay : morningDay,
        slot,
      })
    );
    return results.filter((row) => row === "sent").length;
  };
  assert.equal(run(["evening", "morning"]), 1);
  assert.equal(run(["morning", "evening"]), 1);
  const morningKey = buildTrialReminderScheduledDedupKey(
    booking.businessId,
    booking.triggerId,
    booking.userId,
    booking.classDateYmd,
    booking.classTime,
    booking.className
  );
  assert.equal(morningKey.includes("slot"), false);
  assert.equal(morningKey.includes("evening"), false);
  assert.equal(classStartMinutes("10:00:00"), 10 * 60);
  assert.equal(classStartMinutes("09:59"), 9 * 60 + 59);
}

{
  const previous = process.env.REMINDER_EARLY_CUTOFF;
  process.env.REMINDER_EARLY_CUTOFF = "08:30";
  try {
    assert.equal(reminderEarlyCutoffHm(), "08:30");
    assert.equal(
      earlyCutoffMatchesSlot({
        classDateYmd: "2026-10-07",
        classTime: "08:29",
        todayYmd: "2026-10-06",
        delayDays: 0,
        slot: "evening",
      }),
      true
    );
    assert.equal(
      earlyCutoffMatchesSlot({
        classDateYmd: "2026-10-06",
        classTime: "08:30",
        todayYmd: "2026-10-06",
        delayDays: 0,
        slot: "morning",
      }),
      true
    );
  } finally {
    if (previous === undefined) delete process.env.REMINDER_EARLY_CUTOFF;
    else process.env.REMINDER_EARLY_CUTOFF = previous;
  }
}

console.log("arbox-trial-reminder.test.ts: ok");
