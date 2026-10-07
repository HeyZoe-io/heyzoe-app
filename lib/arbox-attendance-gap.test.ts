import assert from "node:assert/strict";
import {
  ATTENDANCE_GAP_FUTURE_SPAN_DAYS,
  ATTENDANCE_GAP_PAST_SPAN_DAYS,
  ATTENDANCE_GAP_SYNC_VARIANT,
  attendanceGapDecideFreeze,
  attendanceGapDueAction,
  attendanceGapFutureBookingUserIds,
  attendanceGapOct8CatchUp,
  attendanceGapFreezeReportWindows,
  attendanceGapMemberDecision,
  attendanceGapMembershipIsStaff,
  attendanceGapFutureWindow,
  attendanceGapPastWindow,
  attendanceGapLookbackCoversDelays,
  attendanceGapSeedCandidates,
  attendanceGapTiersNeedingSoftSeed,
  attendanceGapUnmarkedBooking,
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
  maxDelayDaysForTrigger,
  minDelayDaysForTrigger,
  triggerTypeLabel,
} from "@/lib/trigger-catalog";
import { missedOccurrenceYesCount } from "@/lib/leads/arbox-missed-class";
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
  assert.equal(minDelayDaysForTrigger("attendance_gap"), 1);
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

/** Unmarked class inside the gap blocks. Marked-class No, or an empty window, does not. */
{
  const today = "2026-10-08";
  const rows = [
    row({ user_id: 1, date: "2026-09-24", check_in: "Yes", class_name: "כוח", time: "10:00" }),
    row({ user_id: 1, date: "2026-10-01", check_in: "No", class_name: "כוח", time: "18:00" }),
    row({ user_id: 2, date: "2026-09-24", check_in: "Yes", class_name: "יוגה", time: "09:00" }),
    row({ user_id: 2, date: "2026-10-01", check_in: "No", class_name: "יוגה", time: "19:00" }),
    row({ user_id: 9, date: "2026-10-01", check_in: "Yes", class_name: "יוגה", time: "19:00" }),
    row({ user_id: 3, date: "2026-09-20", check_in: "Yes", class_name: "פילאטיס", time: "08:00" }),
  ];
  const yes = missedOccurrenceYesCount(rows);
  assert.deepEqual(
    attendanceGapUnmarkedBooking({
      userId: 1,
      lastYesYmd: "2026-09-24",
      todayYmd: today,
      rows,
      occurrenceYes: yes,
    }),
    { classDate: "2026-10-01", classTime: "18:00", className: "כוח" }
  );
  assert.equal(
    attendanceGapUnmarkedBooking({
      userId: 2,
      lastYesYmd: "2026-09-24",
      todayYmd: today,
      rows,
      occurrenceYes: yes,
    }),
    null
  );
  assert.equal(
    attendanceGapUnmarkedBooking({
      userId: 3,
      lastYesYmd: "2026-09-20",
      todayYmd: today,
      rows,
      occurrenceYes: yes,
    }),
    null
  );
  assert.equal(
    attendanceGapLookbackCoversDelays({
      lookbackFrom: "2026-09-09",
      todayYmd: today,
      delayDays: [7, 14],
    }),
    true
  );
  assert.equal(
    attendanceGapLookbackCoversDelays({
      lookbackFrom: "2026-10-01",
      todayYmd: today,
      delayDays: [14],
    }),
    false
  );
}

/** Freeze guard: active, overlapping, ended-before, report failure, no candidates. */
{
  const today = "2026-10-08";
  const lastYes = "2026-09-24";
  const base = {
    reportOk: true,
    userId: 1,
    lastYesYmd: lastYes,
    todayYmd: today,
    holds: [] as { userId: number; startYmd: string; endYmd: string | null }[],
  };
  assert.equal(
    attendanceGapDecideFreeze({
      ...base,
      holds: [{ userId: 1, startYmd: "2026-10-01", endYmd: "2026-10-10" }],
    }),
    "frozen",
    "active freeze"
  );
  assert.equal(
    attendanceGapDecideFreeze({
      ...base,
      holds: [{ userId: 1, startYmd: "2026-10-01", endYmd: null }],
    }),
    "frozen",
    "open-ended freeze is active"
  );
  assert.equal(
    attendanceGapDecideFreeze({
      ...base,
      holds: [{ userId: 1, startYmd: "2026-09-28", endYmd: "2026-10-05" }],
    }),
    "frozen",
    "freeze overlapped the gap and then ended"
  );
  assert.equal(
    attendanceGapDecideFreeze({
      ...base,
      holds: [{ userId: 1, startYmd: "2026-09-01", endYmd: "2026-09-20" }],
    }),
    "send",
    "freeze ended before last Yes"
  );
  assert.equal(
    attendanceGapDecideFreeze({ ...base, reportOk: false }),
    "pending",
    "report failure writes pending and does not send"
  );
  assert.equal(
    attendanceGapDecideFreeze({
      ...base,
      existingStatus: "pending",
      existingContactId: null,
      existingProcessedAtIso: "2026-10-08T06:00:00.000Z",
    }),
    "send",
    "same-day retry after a failed report can still send"
  );
  assert.equal(
    attendanceGapDecideFreeze({
      ...base,
      existingStatus: "pending",
      existingContactId: null,
      existingProcessedAtIso: "2026-10-07T06:00:00.000Z",
    }),
    "stale_hold",
    "a failed report is not sent on a later day"
  );
  assert.deepEqual(
    attendanceGapFreezeReportWindows({
      candidateLastYesYmds: [],
      todayYmd: today,
      maxDelayDays: 21,
    }),
    [],
    "no candidates means no freeze-report call"
  );
  assert.deepEqual(
    attendanceGapFreezeReportWindows({
      candidateLastYesYmds: ["2026-09-15", "2026-10-01"],
      todayYmd: today,
      maxDelayDays: 21,
      endHorizonDays: 0,
    }),
    [{ fromDate: "2026-09-15", toDate: today }]
  );
  const activeEnd = attendanceGapFreezeReportWindows({
    candidateLastYesYmds: ["2026-09-15"],
    todayYmd: today,
    maxDelayDays: 21,
  });
  assert.equal(activeEnd[0]?.fromDate, "2026-09-15");
  assert.equal(activeEnd[activeEnd.length - 1]?.toDate, "2027-01-06");
  assert.ok(
    activeEnd.some((window) => window.fromDate <= "2026-10-10" && window.toDate >= "2026-10-10"),
    "an active freeze ending after today is inside a fetched window"
  );
  assert.ok(activeEnd.length >= 2, "the end horizon past the cap splits into more than one call");
  const split = attendanceGapFreezeReportWindows({
    candidateLastYesYmds: ["2026-10-01"],
    todayYmd: today,
    maxDelayDays: 45,
    endHorizonDays: 0,
  });
  assert.equal(split[0]?.fromDate, "2026-08-24");
  assert.ok(split.length >= 2, "a delay past the 30-day cap splits into more than one call");
  assert.equal(split[split.length - 1]?.toDate, today);
}

/** Active paid or punch card sends. Expired, cancelled, trial-only, none, and staff do not. */
{
  assert.equal(attendanceGapMembershipIsStaff("מנוי צוות"), true);
  assert.equal(attendanceGapMembershipIsStaff("staff pass"), true);
  assert.equal(attendanceGapMembershipIsStaff("BOXFIT X 9"), false);

  const paid = {
    user_id: 1,
    status: "active",
    type: "plan",
    membership_type_name: "BOXFIT ללא הגבלה",
  };
  assert.equal(
    attendanceGapMemberDecision({ userId: 1, membershipRows: [paid], sessionRows: [] }),
    "send",
    "active paid"
  );
  assert.equal(
    attendanceGapMemberDecision({
      userId: 1,
      membershipRows: [{ ...paid, status: "activeMemberWithFutureCancel" }],
      sessionRows: [],
    }),
    "send",
    "future cancellation is still active"
  );
  assert.equal(
    attendanceGapMemberDecision({
      userId: 2,
      membershipRows: [],
      sessionRows: [{ user_id: 2, status: "active", type: "session", name: "כרטיסיית אימונים 24+1" }],
    }),
    "send",
    "valid punch card"
  );
  assert.equal(
    attendanceGapMemberDecision({
      userId: 2,
      membershipRows: [{ user_id: 2, status: "active", type: "session", membership_type_name: "כרטיסיית 12+1" }],
      sessionRows: [],
    }),
    "send",
    "punch card on the membership report"
  );
  assert.equal(
    attendanceGapMemberDecision({ userId: 3, membershipRows: [], sessionRows: [] }),
    "not_active_member",
    "no membership"
  );
  assert.equal(
    attendanceGapMemberDecision({
      userId: 3,
      membershipRows: [{ user_id: 3, status: "cancelled", type: "plan", membership_type_name: "GOLD" }],
      sessionRows: [],
    }),
    "not_active_member",
    "cancelled"
  );
  assert.equal(
    attendanceGapMemberDecision({
      userId: 3,
      membershipRows: [{ user_id: 3, status: "expired", type: "plan", membership_type_name: "GOLD" }],
      sessionRows: [],
    }),
    "not_active_member",
    "expired"
  );
  assert.equal(
    attendanceGapMemberDecision({
      userId: 4,
      membershipRows: [{ user_id: 4, status: "active", type: "trial", membership_type_name: "פילאטיס ניסיון" }],
      sessionRows: [],
    }),
    "not_active_member",
    "trial only"
  );
  assert.equal(
    attendanceGapMemberDecision({
      userId: 5,
      membershipRows: [{ user_id: 5, status: "active", type: "plan", membership_type_name: "מנוי צוות" }],
      sessionRows: [],
    }),
    "staff"
  );
  assert.equal(
    attendanceGapMemberDecision({
      userId: 5,
      membershipRows: [
        { user_id: 5, status: "active", type: "plan", membership_type_name: "מנוי צוות" },
        { ...paid, user_id: 5 },
      ],
      sessionRows: [],
    }),
    "send",
    "a paid plan beside a staff plan still sends"
  );
}

/** New tier: due today sends, earlier is seeded, later stays for its own day. */
{
  const now = new Date("2026-10-08T06:00:00.000Z");
  assert.equal(
    attendanceGapDueAction({ lastYesYmd: "2026-09-24", tier: 14, now }),
    "send",
    "due today"
  );
  assert.equal(
    attendanceGapDueAction({ lastYesYmd: "2026-09-23", tier: 14, now }),
    "seed",
    "due earlier"
  );
  assert.equal(
    attendanceGapDueAction({ lastYesYmd: "2026-09-25", tier: 14, now }),
    "send",
    "due later"
  );
  const laterGap = ymdDiffDays("2026-10-08", "2026-09-25");
  assert.equal(laterGap, 13);
  assert.equal(laterGap != null && laterGap < 14, true, "due later is not a candidate until its day");
  const onDay = ymdDiffDays("2026-10-09", "2026-09-25");
  assert.equal(onDay, 14, "due later sends on its day");
  assert.equal(maxDelayDaysForTrigger("attendance_gap"), 28);
}

/** One-off catch-up is only the four Oriya people, and only on 2026-10-08. */
{
  const chen = { businessId: 3646, userId: 8966278, tier: 14 };
  assert.equal(attendanceGapOct8CatchUp({ ...chen, todayYmd: "2026-10-07" }), "hold");
  assert.equal(attendanceGapOct8CatchUp({ ...chen, todayYmd: "2026-10-08" }), "send");
  assert.equal(attendanceGapOct8CatchUp({ ...chen, todayYmd: "2026-10-09" }), null);
  assert.equal(
    attendanceGapOct8CatchUp({ businessId: 3646, userId: 11286969, tier: 14, todayYmd: "2026-10-08" }),
    null,
    "Mika is the normal due-today send, not the catch-up"
  );
  for (const userId of [11493613, 11493625, 9177440]) {
    assert.equal(
      attendanceGapOct8CatchUp({ businessId: 3646, userId, tier: 14, todayYmd: "2026-10-08" }),
      "send"
    );
  }
}

/** A booking inside today…today+14 blocks. A booking after that does not. */
{
  const ids = attendanceGapFutureBookingUserIds({
    rows: [
      { user_id: 1, date: "2026-10-08" },
      { user_id: 2, date: "2026-10-22" },
      { user_id: 3, date: "2026-10-23" },
    ],
    fromYmd: "2026-10-08",
    toYmd: "2026-10-22",
  });
  assert.equal(ids.has(1), true);
  assert.equal(ids.has(2), true);
  assert.equal(ids.has(3), false);
}

console.log("arbox-attendance-gap.test.ts: ok");
