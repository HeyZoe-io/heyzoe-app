import assert from "node:assert/strict";
import {
  isTrialReminderDue,
  normalizeTrialReminderClassNamePk,
  normalizeTrialReminderClassTimePk,
  parseTrialReminderUserId,
  trialReminderFutureWindow,
  trialReminderHasConfiguredIds,
  trialReminderNeedsSoftSeed,
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
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  classNameFromScheduledDedupKey,
  classTimeFromScheduledDedupKey,
  resolveTemplateBodyParamValues,
  TEMPLATE_CLASS_TIME_FALLBACK,
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
    "היי {{1}}, רציתי לוודא הגעה לאימון הניסיון {{2}} בשעה {{3}}. נשמח לראותך!"
  );
  const values = resolveTemplateBodyParamValues({
    triggerType: "trial_reminder",
    storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.trial_reminder.body }],
    firstName: "דנה",
    className: "יוגה",
    classTime: "18:00",
  });
  assert.deepEqual(values, ["דנה", "יוגה", "18:00"]);
  const missingTime = resolveTemplateBodyParamValues({
    triggerType: "trial_reminder",
    storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.trial_reminder.body }],
    firstName: "דנה",
    className: "יוגה",
  });
  assert.equal(missingTime[2], TEMPLATE_CLASS_TIME_FALLBACK);
}

{
  assert.equal(showsProductFilter("trial_reminder"), true);
  assert.equal(isUniquePerBusinessTriggerType("trial_reminder"), true);
  assert.equal(uniqueCreateModeFor("trial_reminder"), "warn");
  assert.equal(minDelayDaysForTrigger("trial_reminder"), 0);
  assert.equal(defaultDelayDays("trial_reminder"), 1);
  assert.equal(defaultDelayDirection("trial_reminder"), "before");
  assert.equal(formatDelayLabel("trial_reminder", 0, "before"), "בוקר האימון");
  assert.equal(formatDelayLabel("trial_reminder", 1, "before"), "1 ימים לפני האימון");
}

console.log("arbox-trial-reminder.test.ts: ok");
