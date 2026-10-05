import assert from "node:assert/strict";
import {
  claimBlockReason,
  isDuplicateBlockAlarmReason,
  mergeDuplicateBlocks,
} from "@/lib/leads/duplicate-block-alarm";

assert.equal(isDuplicateBlockAlarmReason("template_rule_cap"), true);
assert.equal(isDuplicateBlockAlarmReason("free_message_cap"), true);
assert.equal(isDuplicateBlockAlarmReason("trial_24h_cap"), true);
assert.equal(isDuplicateBlockAlarmReason("claim_lost"), true);
assert.equal(isDuplicateBlockAlarmReason("claim_failed"), true);
assert.equal(isDuplicateBlockAlarmReason("claim_not_won"), true);
assert.equal(isDuplicateBlockAlarmReason("dedup_claim_failed"), true);
assert.equal(isDuplicateBlockAlarmReason("dedup_read_failed"), false);
assert.equal(isDuplicateBlockAlarmReason("activation_read_failed"), false);

assert.equal(claimBlockReason({ code: "23505", message: "duplicate key" }), "claim_lost");
assert.equal(claimBlockReason({ code: "42703", message: "column missing" }), "claim_not_won");

const merged = mergeDuplicateBlocks([
  { businessId: 3543, triggerType: "trial_booked", count: 2 },
  { businessId: 3543, triggerType: "trial_booked", count: 3 },
  { businessId: 3543, triggerType: "credit_refusal", count: 1 },
]);
assert.equal(merged.length, 2);
assert.equal(merged.find((row) => row.triggerType === "trial_booked")?.count, 5);

console.log("duplicate-block-alarm.test.ts: ok");
