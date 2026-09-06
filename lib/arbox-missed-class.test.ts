import assert from "node:assert/strict";
import {
  bookingsReportSharedLookbackWindow,
  isBookingCheckInNo,
  isMissedClassDatePast,
  normalizeMissedClassNamePk,
  normalizeMissedClassTimePk,
  parseMissedClassUserId,
} from "@/lib/leads/arbox-missed-class";
import {
  ARBOX_SYNC_SEND_ATTEMPT_CAP,
  nextCancellationSyncLogAfterDispatch,
  shouldRetryCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import {
  bookingMatchesTrialScope,
  buildBookingsReportPath,
  isBookingCheckedIn,
  normalizeMembershipTypeName,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { shouldFetchNextArboxReportPage, ARBOX_REPORT_PAGE_SIZE } from "@/lib/leads/arbox-sales-report";
import { buildMissedClassScheduledDedupKey } from "@/lib/scheduled-template-sends";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  classNameFromScheduledDedupKey,
  resolveTemplateBodyParamValues,
} from "@/lib/template-send-params";

/** check_in="No" only — Yes / empty must not fire. */
{
  assert.equal(isBookingCheckInNo("No"), true);
  assert.equal(isBookingCheckInNo("no"), true);
  assert.equal(isBookingCheckInNo("Yes"), false);
  assert.equal(isBookingCheckInNo(""), false);
  assert.equal(isBookingCheckInNo(null), false);
  assert.equal(isBookingCheckedIn("Yes"), true);
  assert.equal(isBookingCheckedIn("No"), false);
}

/** Past date only (Israel YMD compare). */
{
  const now = new Date("2026-09-06T10:00:00.000Z");
  assert.equal(isMissedClassDatePast("2026-09-05", now), true);
  assert.equal(isMissedClassDatePast("2026-09-06", now), false);
  assert.equal(isMissedClassDatePast("2026-09-07", now), false);
}

/** PK grain helpers. */
{
  assert.equal(normalizeMissedClassTimePk("  18:00  "), "18:00");
  assert.equal(normalizeMissedClassTimePk(""), null);
  assert.equal(normalizeMissedClassNamePk("יוגה"), "יוגה");
  assert.equal(parseMissedClassUserId(44123), 44123);
  assert.equal(parseMissedClassUserId("0"), null);
}

/** Trial vs regular routing inputs (same as trial_attended). */
{
  const names = new Set([normalizeMembershipTypeName("שיעור ניסיון")]);
  const scope = { trialTypeIds: [80601], trialTypeNamesNormalized: names };
  const trialNo: ArboxBookingReportRow = {
    user_id: 1,
    check_in: "No",
    membership_type_name: "שיעור ניסיון",
    date: "2026-09-05",
    time: "10:00",
    class_name: "יוגה",
  };
  const memberNo: ArboxBookingReportRow = {
    user_id: 2,
    check_in: "No",
    membership_type_name: "מנוי חודשי",
    date: "2026-09-05",
    time: "18:00",
    class_name: "HIIT",
  };
  assert.equal(isBookingCheckInNo(trialNo.check_in) && bookingMatchesTrialScope(trialNo, scope), true);
  assert.equal(isBookingCheckInNo(memberNo.check_in) && !bookingMatchesTrialScope(memberNo, scope), true);
  assert.equal(isBookingCheckInNo("Yes"), false);
}

/** Shared window: seed = 30d, forward = lookback days. */
{
  const now = new Date("2026-09-06T12:00:00.000Z");
  const seed = bookingsReportSharedLookbackWindow({ now, missedNeedsSeed: true });
  assert.equal(seed.toDate, "2026-09-06");
  assert.equal(seed.fromDate, "2026-08-08");
  const fwd = bookingsReportSharedLookbackWindow({
    now,
    missedNeedsSeed: false,
    lookbackDays: 7,
  });
  assert.equal(fwd.toDate, "2026-09-06");
  assert.equal(fwd.fromDate, "2026-08-31");
}

/** Pagination contract (same as salesReport / bookings). */
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
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    page: 2,
  });
  assert.match(path, /bookingsReport/);
  assert.match(path, /page=2/);
}

/** Dedup key + delayed class_name recovery. */
{
  const key = buildMissedClassScheduledDedupKey(
    "missed_class",
    1,
    "rule-uuid",
    44123,
    "2026-09-05",
    "18:00",
    "יוגה"
  );
  assert.match(key, /^missed_class:1:rule-uuid:44123:2026-09-05:/);
  assert.equal(classNameFromScheduledDedupKey(key), "יוגה");
}

/** Preset categories + body params. */
{
  assert.equal(TEMPLATE_PRESETS.missed_class.category, "UTILITY");
  assert.equal(TEMPLATE_PRESETS.missed_trial.category, "MARKETING");
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "missed_class",
      storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.missed_class.body }],
      firstName: "דנה כהן",
      className: "HIIT",
    }),
    ["דנה", "HIIT"]
  );
}

/** A9 retry: gated does not count; 3× send_failed → abandoned. */
{
  assert.equal(ARBOX_SYNC_SEND_ATTEMPT_CAP, 3);
  const gated = nextCancellationSyncLogAfterDispatch({ dispatch: "gated", attemptsSoFar: 0 });
  assert.deepEqual(gated, { attempts: 0, status: "pending", hitCap: false });
  let row = gated;
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(shouldRetryCancellationSyncLog(row.status), true);
    row = nextCancellationSyncLogAfterDispatch({
      dispatch: "send_failed",
      attemptsSoFar: row.attempts,
    });
  }
  assert.deepEqual(row, { attempts: 3, status: "abandoned", hitCap: true });
}

console.log("arbox-missed-class.test.ts: ok");
