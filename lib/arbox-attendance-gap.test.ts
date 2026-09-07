import assert from "node:assert/strict";
import {
  ATTENDANCE_GAP_FUTURE_SPAN_DAYS,
  ATTENDANCE_GAP_PAST_SPAN_DAYS,
  ATTENDANCE_GAP_SYNC_VARIANT,
  attendanceGapFutureWindow,
  attendanceGapPastWindow,
  attendanceGapSeedCandidates,
  attendanceGapTiersNeedingSoftSeed,
  computeAttendanceGapStates,
  sharedFutureBookingsWindow,
  ymdDiffDays,
} from "@/lib/leads/arbox-attendance-gap";
import { buildAttendanceGapScheduledDedupKey } from "@/lib/scheduled-template-sends";
import { resolveTemplateBodyParamValues } from "@/lib/template-send-params";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  formatDelayLabel,
  isAttendanceGapTriggerType,
  isTriggerType,
  minDelayDaysForTrigger,
  triggerTypeLabel,
} from "@/lib/trigger-catalog";
import type { ArboxBookingReportRow } from "@/lib/leads/arbox-trial-attended";

function row(
  partial: Partial<ArboxBookingReportRow> & {
    user_id: number;
    date: string;
    check_in?: string;
  }
): ArboxBookingReportRow {
  return {
    user_id: partial.user_id,
    date: partial.date,
    check_in: partial.check_in ?? "",
    phone: partial.phone ?? "0501234567",
    full_name: partial.full_name ?? "דנה כהן",
    first_name: partial.first_name,
    last_name: partial.last_name,
    class_name: partial.class_name ?? "יוגה",
    time: partial.time ?? "18:00",
    membership_type_name: partial.membership_type_name,
  };
}

assert.equal(ATTENDANCE_GAP_PAST_SPAN_DAYS, 30);
assert.equal(ATTENDANCE_GAP_FUTURE_SPAN_DAYS, 14);
assert.equal(ATTENDANCE_GAP_SYNC_VARIANT, "unbooked");

{
  const now = new Date("2026-09-06T12:00:00.000Z");
  const past = attendanceGapPastWindow(now);
  assert.equal(past.toDate, "2026-09-06");
  assert.equal(past.fromDate, "2026-08-08");
  // Future window helper remains for freeze cron prefetch only.
  const fut = attendanceGapFutureWindow(now);
  assert.equal(fut.fromDate, "2026-09-07");
  assert.equal(fut.toDate, "2026-09-20");
  const withToday = sharedFutureBookingsWindow(now, { includeToday: true });
  assert.equal(withToday.fromDate, "2026-09-06");
  assert.equal(withToday.toDate, "2026-09-20");
}

assert.equal(ymdDiffDays("2026-09-06", "2026-08-30"), 7);

/** C1 removed — booked type must not exist. */
{
  assert.equal(isTriggerType("attendance_gap_booked"), false);
  assert.equal(isTriggerType("attendance_gap_unbooked"), false);
  assert.equal(isTriggerType("attendance_gap"), true);
  assert.equal(isAttendanceGapTriggerType("attendance_gap"), true);
  assert.equal(isAttendanceGapTriggerType("attendance_gap_booked"), false);
  assert.equal(triggerTypeLabel("attendance_gap"), "פער נוכחות ללא רישום עתידי");
}

/** last_yes = check_in Yes only — many No registrations do not count as attended. */
{
  const states = computeAttendanceGapStates({
    todayYmd: "2026-09-06",
    pastRows: [
      row({ user_id: 10, date: "2026-09-01", check_in: "No" }),
      row({ user_id: 10, date: "2026-09-03", check_in: "No" }),
      row({ user_id: 10, date: "2026-09-05", check_in: "No" }),
    ],
  });
  assert.equal(states.length, 0, "No-only bookings must not invent a last_yes");
}

/** Gap measured from last real Yes; later No bookings do not move last_yes forward. */
{
  const states = computeAttendanceGapStates({
    todayYmd: "2026-09-06",
    pastRows: [
      row({ user_id: 11, date: "2026-08-23", check_in: "Yes" }),
      row({ user_id: 11, date: "2026-09-01", check_in: "No" }),
      row({ user_id: 11, date: "2026-09-04", check_in: "No" }),
    ],
  });
  assert.equal(states.length, 1);
  assert.equal(states[0]!.lastYesYmd, "2026-08-23");
  assert.equal(states[0]!.gapDays, 14);
}

/** No future filter — member fires even if they would have had a future booking. */
{
  const states = computeAttendanceGapStates({
    todayYmd: "2026-09-06",
    pastRows: [row({ user_id: 20, date: "2026-08-30", check_in: "Yes" })],
  });
  assert.equal(states.length, 1);
  assert.equal(states[0]!.gapDays, 7);
}

/** Re-entry: new last_yes changes gap_start_date (dedup episode). */
{
  const before = computeAttendanceGapStates({
    todayYmd: "2026-09-06",
    pastRows: [row({ user_id: 30, date: "2026-08-20", check_in: "Yes" })],
  });
  const afterAttend = computeAttendanceGapStates({
    todayYmd: "2026-09-20",
    pastRows: [
      row({ user_id: 30, date: "2026-08-20", check_in: "Yes" }),
      row({ user_id: 30, date: "2026-09-13", check_in: "Yes" }),
    ],
  });
  assert.notEqual(before[0]!.lastYesYmd, afterAttend[0]!.lastYesYmd);
  assert.equal(afterAttend[0]!.lastYesYmd, "2026-09-13");
  assert.equal(afterAttend[0]!.gapDays, 7);
}

{
  const key = buildAttendanceGapScheduledDedupKey(1, "rule-uuid", 44123, "2026-08-23", 7);
  assert.equal(key, "attendance_gap:1:rule-uuid:44123:2026-08-23:7");
}

{
  assert.equal(minDelayDaysForTrigger("attendance_gap"), 7);
  assert.equal(formatDelayLabel("attendance_gap", 14, "after"), "14 ימי היעדרות");
  assert.equal(formatDelayLabel("attendance_gap", 7, "after"), "7 ימי היעדרות");
}

{
  assert.equal(TEMPLATE_PRESETS.attendance_gap.category, "MARKETING");
  assert.equal("attendance_gap_booked" in TEMPLATE_PRESETS, false);
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "attendance_gap",
      storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.attendance_gap.body }],
      firstName: "דנה כהן",
      businessName: "Limitless",
    }),
    ["דנה", "Limitless"]
  );
}

{
  assert.deepEqual(
    attendanceGapTiersNeedingSoftSeed({
      attendanceGapSeeded: false,
      configuredTiers: [7, 14, 21],
      tiersWithAnySyncLog: new Set(),
    }),
    [],
    "before flag: full seed path, not soft-seed"
  );
  assert.deepEqual(
    attendanceGapTiersNeedingSoftSeed({
      attendanceGapSeeded: true,
      configuredTiers: [7, 14, 21],
      tiersWithAnySyncLog: new Set([7]),
    }),
    [14, 21],
    "new tiers with zero sync_log rows soft-seed"
  );

  const states = computeAttendanceGapStates({
    todayYmd: "2026-09-06",
    pastRows: [
      row({ user_id: 40, date: "2026-08-20", check_in: "Yes" }), // gap 17
      row({ user_id: 41, date: "2026-08-30", check_in: "Yes" }), // gap 7
    ],
  });
  const seed14 = attendanceGapSeedCandidates({ states, tier: 14 });
  assert.equal(seed14.length, 1);
  assert.equal(seed14[0]!.userId, 40);
  const seed7 = attendanceGapSeedCandidates({ states, tier: 7 });
  assert.equal(seed7.length, 2);
}

{
  const episodeA = "2026-08-01";
  const episodeB = "2026-09-01";
  const kA = buildAttendanceGapScheduledDedupKey(1, "r", 1, episodeA, 21);
  const kB = buildAttendanceGapScheduledDedupKey(1, "r", 1, episodeB, 21);
  assert.notEqual(kA, kB, "new attendance episode must not collide with prior tier dedup");
  const t7 = buildAttendanceGapScheduledDedupKey(1, "r7", 1, episodeA, 7);
  const t21 = buildAttendanceGapScheduledDedupKey(1, "r21", 1, episodeA, 21);
  assert.notEqual(t7, t21, "tiers are independent keys");
}

console.log("arbox-attendance-gap.test.ts: ok");
