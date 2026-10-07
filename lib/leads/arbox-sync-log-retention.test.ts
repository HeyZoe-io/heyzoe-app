import assert from "node:assert/strict";
import {
  ARBOX_BIRTHDAY_SYNC_LOG_RETENTION_DAYS,
  ARBOX_SYNC_LOG_RETENTION_DAYS,
  ARBOX_SYNC_LOG_RETENTION_TARGETS,
  retentionCutoffIso,
} from "./arbox-sync-log-retention";

const byTable = new Map(ARBOX_SYNC_LOG_RETENTION_TARGETS.map((target) => [target.table, target]));

assert.equal(byTable.get("arbox_birthday_sync_log")?.retentionDays, ARBOX_BIRTHDAY_SYNC_LOG_RETENTION_DAYS);
assert.ok(ARBOX_BIRTHDAY_SYNC_LOG_RETENTION_DAYS > 365);

for (const target of ARBOX_SYNC_LOG_RETENTION_TARGETS) {
  if (target.table === "arbox_birthday_sync_log") continue;
  assert.equal(target.retentionDays, ARBOX_SYNC_LOG_RETENTION_DAYS);
  assert.equal(target.timeColumn, "processed_at");
}

assert.deepEqual(byTable.get("arbox_lost_lead_sync_log")?.keep, [{ column: "lead_id", not: 0 }]);
assert.deepEqual(byTable.get("arbox_freeze_created_sync_log")?.keep, [
  { column: "membership_hold_id", not: 0 },
]);
assert.deepEqual(byTable.get("arbox_lead_status_change_sync_log")?.keep, [
  { column: "status", not: "pending" },
]);
assert.deepEqual(byTable.get("arbox_days_in_club_sync_log")?.keep, [{ column: "user_id", not: 0 }]);
assert.deepEqual(byTable.get("arbox_attendance_gap_sync_log")?.keep, [{ column: "user_id", not: 0 }]);

for (const excluded of [
  "arbox_nth_workout_sync_log",
  "arbox_first_paid_purchase_log",
  "arbox_lead_status_snapshot",
  "arbox_lead_known_statuses",
  "arbox_future_booking_snapshot",
  "arbox_class_trainer_snapshot",
  "arbox_trial_booking_identity",
]) {
  assert.equal(byTable.has(excluded), false, excluded);
}

const cutoff = retentionCutoffIso(90, new Date("2026-10-07T12:00:00.000Z"));
assert.equal(cutoff, "2026-07-09T12:00:00.000Z");

console.log("arbox-sync-log-retention.test.ts ok");
