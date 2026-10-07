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
import {
  classifyTrainerStoreError,
  planTrainerRefresh,
  shouldNotifyClassTrainer,
  trainerPhoneCoveredByCustomers,
  trainerRuleIdsToSend,
  trainerSkipReason,
  trainersFromActiveSummary,
  type TrainerSnapshotRow,
} from "@/lib/leads/arbox-class-trainer-snapshot";

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
    ["🙂", "יוגה"]
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

const trainer = (
  partial: Partial<TrainerSnapshotRow> & Pick<TrainerSnapshotRow, "staff_user_id">
): TrainerSnapshotRow => ({
  schedule_id: "sch-1",
  slot: "primary",
  phone: "972501111111",
  full_name: "אסתר וקנין",
  class_name: "פילאטיס",
  class_date: "2026-10-08",
  class_time: "18:00",
  seen_at: "2026-10-07T08:00:00.000Z",
  ...partial,
});

{
  const sightings = trainersFromActiveSummary([
    {
      schedule_id: "sch-1",
      class_name: "פילאטיס",
      date: "2026-10-08",
      start_time: "18:00",
      status: "active",
      staff_member: { user_id: 10, full_name: "אסתר וקנין", phone: "0528388406" },
      second_staff_member: { user_id: 11, full_name: "אופל עקיבא", phone: "0500000511" },
    },
    {
      schedule_id: "open",
      class_name: "Open Gym",
      date: "2026-10-08",
      start_time: "09:00",
      status: "active",
      staff_member: null,
    },
  ]);
  assert.equal(sightings.length, 2);
  assert.equal(sightings[0]!.staff_user_id, "10");
  assert.equal(sightings[0]!.phone, "972528388406");
  assert.equal(sightings[1]!.slot, "second");
  assert.equal(sightings[1]!.phone, "972500000511");
}

{
  const existing = [trainer({ staff_user_id: "old", phone: "972501111111", full_name: "ישן" })];
  const swapped = planTrainerRefresh({
    existing,
    sightings: [
      {
        schedule_id: "sch-1",
        slot: "primary",
        staff_user_id: "new",
        phone: "972502222222",
        full_name: "חדש",
        class_name: "פילאטיס",
        class_date: "2026-10-08",
        class_time: "18:00",
      },
    ],
    activeScheduleIds: new Set(["sch-1"]),
    nowIso: "2026-10-07T09:00:00.000Z",
  });
  assert.equal(swapped.upserts.length, 1);
  assert.equal(swapped.upserts[0]!.staff_user_id, "new");
  assert.equal(swapped.upserts[0]!.phone, "972502222222");
  assert.equal(swapped.deleteSlots.length, 0);
  assert.equal(
    shouldNotifyClassTrainer({
      customerRowCount: 2,
      pendingCustomerCount: 2,
      newlyMarkedCount: 1,
      classPassed: false,
    }),
    true
  );
}

{
  const kept = planTrainerRefresh({
    existing: [trainer({ staff_user_id: "10", phone: "972501111111" })],
    sightings: [
      {
        schedule_id: "sch-1",
        slot: "primary",
        staff_user_id: "10",
        phone: null,
        full_name: "אסתר וקנין",
        class_name: "פילאטיס",
        class_date: "2026-10-08",
        class_time: "18:00",
      },
    ],
    activeScheduleIds: new Set(["sch-1"]),
    nowIso: "2026-10-07T09:00:00.000Z",
  });
  assert.equal(kept.upserts[0]!.phone, "972501111111");
}

{
  const removedSecond = planTrainerRefresh({
    existing: [
      trainer({ staff_user_id: "10" }),
      trainer({ staff_user_id: "11", slot: "second", phone: "972503333333" }),
    ],
    sightings: [
      {
        schedule_id: "sch-1",
        slot: "primary",
        staff_user_id: "10",
        phone: "972501111111",
        full_name: "אסתר וקנין",
        class_name: "פילאטיס",
        class_date: "2026-10-08",
        class_time: "18:00",
      },
    ],
    activeScheduleIds: new Set(["sch-1"]),
    nowIso: "2026-10-07T09:00:00.000Z",
  });
  assert.deepEqual(removedSecond.deleteSlots, [{ schedule_id: "sch-1", slot: "second" }]);
}

{
  const cancelledKept = planTrainerRefresh({
    existing: [trainer({ staff_user_id: "10" })],
    sightings: [],
    activeScheduleIds: new Set(),
    nowIso: "2026-10-07T10:00:00.000Z",
  });
  assert.equal(cancelledKept.upserts.length, 0);
  assert.equal(cancelledKept.deleteSlots.length, 0);
}

{
  assert.equal(
    shouldNotifyClassTrainer({
      customerRowCount: 0,
      pendingCustomerCount: 0,
      newlyMarkedCount: 0,
      classPassed: false,
    }),
    true
  );
  assert.equal(trainerPhoneCoveredByCustomers("052-838-8406", ["972528388406"]), true);
  assert.equal(trainerPhoneCoveredByCustomers("972501111111", ["972502222222"]), false);
  assert.equal(
    trainerSkipReason({
      inWindow: true,
      classPassed: false,
      hasSnapshot: true,
      phone: null,
      coveredByCustomer: false,
    }),
    "no_staff_phone"
  );
  assert.equal(
    trainerSkipReason({
      inWindow: false,
      classPassed: false,
      hasSnapshot: true,
      phone: "972501111111",
      coveredByCustomer: false,
    }),
    "outside_window"
  );
  assert.equal(
    trainerSkipReason({
      inWindow: true,
      classPassed: false,
      hasSnapshot: false,
      phone: null,
      coveredByCustomer: false,
    }),
    "no_snapshot"
  );
}

{
  assert.equal(
    shouldNotifyClassTrainer({
      customerRowCount: 3,
      pendingCustomerCount: 0,
      newlyMarkedCount: 0,
      classPassed: false,
    }),
    false
  );
  assert.equal(
    shouldNotifyClassTrainer({
      customerRowCount: 3,
      pendingCustomerCount: 0,
      newlyMarkedCount: 0,
      classPassed: true,
    }),
    false
  );
}

{
  assert.deepEqual(
    trainerRuleIdsToSend({
      ruleIds: ["rule-a", "rule-b"],
      loggedRuleIds: new Set(),
      coveredByCustomer: false,
    }),
    ["rule-a", "rule-b"]
  );
  assert.deepEqual(
    trainerRuleIdsToSend({
      ruleIds: ["rule-a", "rule-b"],
      loggedRuleIds: new Set(["rule-a"]),
      coveredByCustomer: false,
    }),
    ["rule-b"]
  );
  assert.deepEqual(
    trainerRuleIdsToSend({
      ruleIds: ["rule-a", "rule-b"],
      loggedRuleIds: new Set(),
      coveredByCustomer: true,
    }),
    []
  );
}

{
  assert.equal(classifyTrainerStoreError("Could not find the table 'public.arbox_class_trainer_snapshot' in the schema cache"), "missing");
  assert.equal(classifyTrainerStoreError("relation \"arbox_class_trainer_snapshot\" does not exist"), "missing");
  assert.equal(classifyTrainerStoreError("connection reset"), "failed");
}

{
  const components = [{ type: "BODY", text: "היי {{1}}, השיעור {{2}} שנרשמת אליו בתאריך {{3}} בשעה {{4}} בוטל." }];
  assert.deepEqual(
    classCancelledCustomerBodyParams({
      components,
      firstName: "אסתר וקנין",
      className: "פילאטיס",
      classDateYmd: "2026-10-08",
      classTime: "18:00",
    }),
    ["אסתר", "פילאטיס", "08/10", "18:00"]
  );
  assert.deepEqual(
    classCancelledCustomerBodyParams({
      components,
      firstName: "דנה",
      className: "פילאטיס",
      classDateYmd: "2026-10-08",
      classTime: "18:00",
    }),
    ["דנה", "פילאטיס", "08/10", "18:00"]
  );
}

console.log("arbox-class-cancelled-customer.test.ts: ok");
