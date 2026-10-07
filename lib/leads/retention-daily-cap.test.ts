import assert from "node:assert/strict";
import {
  markRetentionSent,
  retentionAlreadySentToday,
  retentionMarkedThisProcess,
  retentionRank,
} from "@/lib/leads/retention-daily-cap";
import { isCancellationSyncLogTerminal } from "@/lib/leads/arbox-membership-cancelled";

const morning = new Date("2026-10-07T06:00:00.000Z");
const nextMorning = new Date("2026-10-08T06:00:00.000Z");

assert.equal(retentionRank("missed_class"), retentionRank("missed_trial"));
assert.ok(retentionRank("missed_class") < retentionRank("attendance_gap"));
assert.ok(retentionRank("attendance_gap") < retentionRank("lost_lead"));
assert.ok(retentionRank("lost_lead") < retentionRank("no_response"));
assert.ok(retentionRank("no_response") < retentionRank("lead_status_changed"));

assert.equal(retentionMarkedThisProcess(3445, "972501234670", morning), false);
markRetentionSent(3445, "972501234670", morning);
assert.equal(retentionMarkedThisProcess(3445, "972501234670", morning), true);
assert.equal(retentionMarkedThisProcess(3445, "972509999999", morning), false);
assert.equal(retentionMarkedThisProcess(3445, "972501234670", nextMorning), false);

assert.equal(isCancellationSyncLogTerminal("skipped"), true);
assert.equal(isCancellationSyncLogTerminal("pending"), false);

function retentionAdmin(sentTable: string | null) {
  return {
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        gte() {
          return builder;
        },
        in() {
          return builder;
        },
        limit() {
          if (table === "contacts") {
            return Promise.resolve({
              data: [{ id: "contact-1", arbox_user_id: "88001" }],
              error: null,
            });
          }
          if (table === "scheduled_template_sends") {
            return Promise.resolve({ data: [], error: null });
          }
          if (sentTable && table === sentTable) {
            return Promise.resolve({ data: [{ status: "sent" }], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const admin = retentionAdmin(null);

async function alreadySentFromThisProcess() {
  const seen = await retentionAlreadySentToday(
    admin as never,
    3445,
    "972501234670",
    morning
  );
  assert.equal(seen, true);

  const phone = "972501110099";
  const blockedByLostLead = await retentionAlreadySentToday(
    retentionAdmin("arbox_lost_lead_sync_log") as never,
    3646,
    phone,
    morning
  );
  assert.equal(blockedByLostLead, true);
  const blockedByGap = await retentionAlreadySentToday(
    retentionAdmin("arbox_attendance_gap_sync_log") as never,
    3646,
    phone,
    morning
  );
  assert.equal(blockedByGap, true);
  const blockedByMissed = await retentionAlreadySentToday(
    retentionAdmin("arbox_missed_class_sync_log") as never,
    3646,
    phone,
    morning
  );
  assert.equal(blockedByMissed, true);
  const clear = await retentionAlreadySentToday(
    retentionAdmin(null) as never,
    3646,
    phone,
    morning
  );
  assert.equal(clear, false);
}

alreadySentFromThisProcess().then(
  () => console.log("retention-daily-cap.test.ts: ok"),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
