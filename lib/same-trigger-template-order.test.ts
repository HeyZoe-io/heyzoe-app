import assert from "node:assert/strict";
import {
  combineCompanionDispatches,
  isCompanionFollowupTemplate,
  orderAllRulesWithCompanion,
  rulesForCompanionSend,
  SAME_TRIGGER_TEMPLATE_GAP_MS,
} from "@/lib/same-trigger-template-order";

const rule = (
  id: string,
  template_name: string,
  updated_at: string,
  created_at = updated_at
) => ({ id, template_name, updated_at, created_at });

{
  const sent = rulesForCompanionSend([
    rule("b", "registered_after_trial1", "2026-09-28T12:37:18.000Z"),
    rule("a", "registered_after_trial", "2026-09-28T12:35:16.000Z"),
  ]);
  assert.deepEqual(
    sent.map((item) => item.template_name),
    ["registered_after_trial", "registered_after_trial1"]
  );
}

{
  const sent = rulesForCompanionSend([
    rule("new", "missed_trial1", "2026-09-28T12:38:11.000Z"),
    rule("old", "missed_trial", "2026-09-28T12:37:04.000Z"),
  ]);
  assert.deepEqual(
    sent.map((item) => item.template_name),
    ["missed_trial", "missed_trial1"]
  );
}

{
  const sent = rulesForCompanionSend([
    rule("b", "no_response1", "2026-10-04T11:48:03.000Z"),
    rule("a", "no_response", "2026-09-28T12:36:25.000Z"),
  ]);
  assert.deepEqual(
    sent.map((item) => item.template_name),
    ["no_response", "no_response1"]
  );
}

{
  const ordered = orderAllRulesWithCompanion([
    rule("b", "milestones1", "2026-09-30T06:26:36.000Z"),
    rule("a", "milestones", "2026-09-30T06:26:22.000Z"),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.template_name),
    ["milestones", "milestones1"]
  );
}

{
  const gap = [
    rule("2", "attendance_gap2_v2", "2026-10-01T00:00:03.000Z"),
    rule("1", "attendance_gap1_v2", "2026-10-01T00:00:02.000Z"),
    rule("0", "attendance_gap_v2", "2026-10-01T00:00:01.000Z"),
  ];
  assert.equal(rulesForCompanionSend(gap).length, 3);
  assert.deepEqual(
    orderAllRulesWithCompanion(gap).map((item) => item.template_name),
    ["attendance_gap_v2", "attendance_gap1_v2", "attendance_gap2_v2"]
  );
  assert.equal(isCompanionFollowupTemplate("attendance_gap_v2", "attendance_gap1_v2"), false);
  assert.equal(isCompanionFollowupTemplate("missed_trial", "missed_trial1"), true);
}

{
  const sent = rulesForCompanionSend([
    rule("old", "credit_refusal", "2026-01-01T00:00:00.000Z"),
    rule("new", "other_template", "2026-02-01T00:00:00.000Z"),
  ]);
  assert.deepEqual(
    sent.map((item) => item.template_name).sort(),
    ["credit_refusal", "other_template"]
  );
}

assert.equal(SAME_TRIGGER_TEMPLATE_GAP_MS, 5_000);
assert.equal(combineCompanionDispatches(["immediate", "immediate"]), "immediate");
assert.equal(combineCompanionDispatches(["immediate", "send_failed"]), "send_failed");
assert.equal(combineCompanionDispatches(["deferred", "deferred"]), "deferred");

console.log("same-trigger-template-order.test.ts: ok");
