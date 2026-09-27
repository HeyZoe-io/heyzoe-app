import assert from "node:assert/strict";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import {
  classCancelQuietHoursDecision,
  classCancelledCustomerBodyParams,
  classStartHasPassed,
  formatClassDateDdMm,
  nextNotifyStatusAfterSendFailure,
  planSnapshotPresence,
  selectCancellationCohort,
  shouldAbortSnapshotRefresh,
  stampFutureBookings,
  type SnapshotLogicRow,
} from "@/lib/leads/arbox-class-cancelled-customer";

const summary = (
  scheduleId: string,
  name: string,
  date: string,
  time: string,
  status = "active"
) => ({
  schedule_id: scheduleId,
  class_name: name,
  date,
  start_time: time,
  status,
});

const booking = (
  userId: string,
  name: string,
  date: string,
  time: string,
  role = "client"
) => ({
  user_id: userId,
  class_name: name,
  date,
  time,
  user_role: role,
  phone: "0500000000",
  first_name: "דנה",
});

{
  const one = stampFutureBookings({
    bookings: [booking("1", "יוגה", "2026-09-28", "9:30")],
    summary: [summary("sch-1", "יוגה", "2026-09-28", "09:30")],
  });
  assert.equal(one.stamped.length, 1);
  assert.equal(one.stamped[0]!.schedule_id, "sch-1");
  assert.equal(one.stamped[0]!.class_time, "09:30");
  assert.equal(one.skipped_no_match, 0);
  assert.equal(one.skipped_ambiguous, 0);
}

{
  const none = stampFutureBookings({
    bookings: [booking("1", "יוגה", "2026-09-28", "09:30")],
    summary: [summary("sch-1", "פילאטיס", "2026-09-28", "09:30")],
  });
  assert.equal(none.stamped.length, 0);
  assert.equal(none.skipped_no_match, 1);
}

{
  const many = stampFutureBookings({
    bookings: [booking("1", "יוגה", "2026-09-28", "09:30")],
    summary: [
      summary("sch-1", "יוגה", "2026-09-28", "09:30", "active"),
      summary("sch-2", "יוגה", "2026-09-28", "09:30", "active"),
    ],
  });
  assert.equal(many.stamped.length, 0);
  assert.equal(many.skipped_ambiguous, 1);
}

{
  const cancelledTwin = stampFutureBookings({
    bookings: [booking("1", "יוגה", "2026-09-28", "09:30")],
    summary: [
      summary("sch-old", "יוגה", "2026-09-28", "09:30", "cancelled"),
      summary("sch-live", "יוגה", "2026-09-28", "09:30", "active"),
    ],
  });
  assert.equal(cancelledTwin.stamped.length, 1);
  assert.equal(cancelledTwin.stamped[0]!.schedule_id, "sch-live");
}

{
  const staff = stampFutureBookings({
    bookings: [booking("9", "יוגה", "2026-09-28", "09:30", "staffMember")],
    summary: [summary("sch-1", "יוגה", "2026-09-28", "09:30")],
  });
  assert.equal(staff.stamped.length, 0);
  assert.equal(staff.skipped_staff, 1);
}

const row = (
  partial: Partial<SnapshotLogicRow> & Pick<SnapshotLogicRow, "schedule_id" | "user_id">
): SnapshotLogicRow => ({
  class_date: "2026-09-28",
  disappeared_at: null,
  notify_status: null,
  ...partial,
});

{
  const rows = [
    row({ schedule_id: "s", user_id: "1" }),
    row({ schedule_id: "s", user_id: "2", disappeared_at: "2026-09-27T12:00:00.000Z" }),
    row({ schedule_id: "s", user_id: "3", disappeared_at: "2026-09-27T08:00:00.000Z" }),
    row({ schedule_id: "s", user_id: "4", notify_status: "sent" }),
    row({ schedule_id: "other", user_id: "5" }),
  ];
  const cancelledAt = new Date("2026-09-27T10:00:00.000Z");
  const cohort = selectCancellationCohort(rows, {
    scheduleId: "s",
    cancelledAt,
    ruleCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
  });
  assert.deepEqual(
    cohort.map((r) => r.user_id).sort(),
    ["1", "2"]
  );
}

{
  const rows = [row({ schedule_id: "s", user_id: "1" })];
  const cohort = selectCancellationCohort(rows, {
    scheduleId: "s",
    cancelledAt: new Date("2026-09-20T10:00:00.000Z"),
    ruleCreatedAt: new Date("2026-09-27T10:00:00.000Z"),
  });
  assert.equal(cohort.length, 0);
}

{
  const rows = [
    row({ schedule_id: "live", user_id: "1", class_date: "2026-09-28" }),
    row({ schedule_id: "live", user_id: "2", class_date: "2026-09-28" }),
    row({ schedule_id: "cancelled", user_id: "3", class_date: "2026-09-28" }),
    row({
      schedule_id: "live",
      user_id: "4",
      class_date: "2026-09-28",
      disappeared_at: "2026-09-26T00:00:00.000Z",
    }),
    row({ schedule_id: "past", user_id: "5", class_date: "2026-09-20" }),
  ];
  const presence = planSnapshotPresence({
    rows,
    stamped: [{ schedule_id: "live", user_id: "1" }],
    cancelledScheduleIds: new Set(["cancelled"]),
    todayYmd: "2026-09-27",
  });
  assert.deepEqual(
    presence.markDisappeared.map((r) => r.user_id),
    ["2"]
  );
  assert.deepEqual(
    presence.clearDisappeared.map((r) => r.user_id),
    []
  );
}

{
  const presence = planSnapshotPresence({
    rows: [
      row({
        schedule_id: "live",
        user_id: "4",
        disappeared_at: "2026-09-26T00:00:00.000Z",
      }),
    ],
    stamped: [{ schedule_id: "live", user_id: "4" }],
    cancelledScheduleIds: new Set(),
    todayYmd: "2026-09-27",
  });
  assert.equal(presence.clearDisappeared.length, 1);
  assert.equal(presence.markDisappeared.length, 0);
}

{
  assert.equal(
    shouldAbortSnapshotRefresh({
      bookingsOk: false,
      summaryOk: true,
      bookingRowCount: 10,
      snapshotFutureRowCount: 0,
    }),
    true
  );
  assert.equal(
    shouldAbortSnapshotRefresh({
      bookingsOk: true,
      summaryOk: false,
      bookingRowCount: 10,
      snapshotFutureRowCount: 0,
    }),
    true
  );
  assert.equal(
    shouldAbortSnapshotRefresh({
      bookingsOk: true,
      summaryOk: true,
      bookingRowCount: 0,
      snapshotFutureRowCount: 4,
    }),
    true
  );
  assert.equal(
    shouldAbortSnapshotRefresh({
      bookingsOk: true,
      summaryOk: true,
      bookingRowCount: 0,
      snapshotFutureRowCount: 0,
    }),
    false
  );
}

{
  const night = israelWallTimeToUtc("2026-09-03", "02:00");
  const afternoon = israelWallTimeToUtc("2026-09-03", "14:00");
  assert.equal(classCancelQuietHoursDecision(night), "hold");
  assert.equal(classCancelQuietHoursDecision(afternoon), "send");
}

{
  const components = [
    { type: "BODY", text: "היי {{1}}, השיעור {{2}} בתאריך {{3}} בשעה {{4}} בוטל." },
  ];
  assert.deepEqual(
    classCancelledCustomerBodyParams({
      components,
      firstName: "דנה כהן",
      className: "יוגה",
      classDateYmd: "2026-09-28",
      classTime: "09:30",
    }),
    ["דנה", "יוגה", "28/09", "09:30"]
  );
  assert.deepEqual(
    classCancelledCustomerBodyParams({
      components: [{ type: "BODY", text: "היי {{1}}, {{2}} בוטל" }],
      firstName: "",
      className: "יוגה",
      classDateYmd: "2026-09-28",
      classTime: "09:30",
    }),
    ["שלום", "יוגה"]
  );
  assert.equal(formatClassDateDdMm("2026-09-28"), "28/09");
}

{
  assert.deepEqual(nextNotifyStatusAfterSendFailure({ attempts: 0, transient: true }), {
    notify_status: "pending",
    attempts: 1,
  });
  assert.deepEqual(nextNotifyStatusAfterSendFailure({ attempts: 2, transient: true }), {
    notify_status: "failed",
    attempts: 3,
  });
  assert.deepEqual(nextNotifyStatusAfterSendFailure({ attempts: 0, transient: false }), {
    notify_status: "failed",
    attempts: 1,
  });
}

{
  assert.equal(classStartHasPassed("2026-09-28", "18:00", israelWallTimeToUtc("2026-09-28", "18:01")), true);
  assert.equal(classStartHasPassed("2026-09-28", "18:00", israelWallTimeToUtc("2026-09-28", "17:00")), false);
}

console.log("arbox-class-cancelled-customer.test.ts: ok");
