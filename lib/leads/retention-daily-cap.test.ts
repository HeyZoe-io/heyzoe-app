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

assert.equal(retentionMarkedThisProcess(3445, "972501234670", morning), false);
markRetentionSent(3445, "972501234670", morning);
assert.equal(retentionMarkedThisProcess(3445, "972501234670", morning), true);
assert.equal(retentionMarkedThisProcess(3445, "972509999999", morning), false);
assert.equal(retentionMarkedThisProcess(3445, "972501234670", nextMorning), false);

assert.equal(isCancellationSyncLogTerminal("skipped"), true);
assert.equal(isCancellationSyncLogTerminal("pending"), false);

const admin = {
  from() {
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      gte() {
        return this;
      },
      limit() {
        return Promise.resolve({ data: [], error: null });
      },
      in() {
        return Promise.resolve({ data: [], error: null });
      },
    };
  },
};

async function alreadySentFromThisProcess() {
  const seen = await retentionAlreadySentToday(
    admin as never,
    3445,
    "972501234670",
    morning
  );
  assert.equal(seen, true);
}

alreadySentFromThisProcess().then(
  () => console.log("retention-daily-cap.test.ts: ok"),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
