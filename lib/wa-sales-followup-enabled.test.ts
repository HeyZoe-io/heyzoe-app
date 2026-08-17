import assert from "node:assert/strict";
import {
  isWaSalesFollowupStageEnabled,
  resolveWaFollowupSendPlan,
  resolveWaSalesFollowupEnabled,
  socialFlagEnabled,
  WA_FOLLOWUP_MS_20_MIN,
  WA_FOLLOWUP_MS_2_H,
  WA_FOLLOWUP_MS_23_H,
  type WaSalesFollowupEnabled,
} from "@/lib/wa-sales-followup-defaults";

assert.equal(socialFlagEnabled(undefined), true);
assert.equal(socialFlagEnabled(null), true);
assert.equal(socialFlagEnabled(true), true);
assert.equal(socialFlagEnabled(false), false);

assert.deepEqual(resolveWaSalesFollowupEnabled({}), { e1: true, e2: true, e3: true });
assert.deepEqual(resolveWaSalesFollowupEnabled(null), { e1: true, e2: true, e3: true });
assert.deepEqual(resolveWaSalesFollowupEnabled([]), { e1: true, e2: true, e3: true });
assert.deepEqual(resolveWaSalesFollowupEnabled("oops"), { e1: true, e2: true, e3: true });
assert.deepEqual(
  resolveWaSalesFollowupEnabled({
    wa_sales_followup_1_enabled: false,
    wa_sales_followup_2_enabled: true,
    wa_sales_followup_3_enabled: false,
  }),
  { e1: false, e2: true, e3: false }
);

const allOn = { e1: true, e2: true, e3: true };
const allOff = { e1: false, e2: false, e3: false };

function assertNeverSendsDisabled(enabled: WaSalesFollowupEnabled, plan: { sendStage: 0 | 1 | 2 | 3 }) {
  if (plan.sendStage === 0) return;
  assert.equal(
    isWaSalesFollowupStageEnabled(enabled, plan.sendStage),
    true,
    `sendStage ${plan.sendStage} must be enabled`
  );
}

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 0,
    elapsedMs: WA_FOLLOWUP_MS_20_MIN,
    enabled: allOn,
  }),
  { sendStage: 1, advanceToStage: 1 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 0,
    elapsedMs: WA_FOLLOWUP_MS_20_MIN - 1,
    enabled: allOn,
  }),
  { sendStage: 0, advanceToStage: 0 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 0,
    elapsedMs: WA_FOLLOWUP_MS_20_MIN,
    enabled: { e1: false, e2: true, e3: true },
  }),
  { sendStage: 0, advanceToStage: 1 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 0,
    elapsedMs: WA_FOLLOWUP_MS_2_H,
    enabled: { e1: false, e2: true, e3: true },
  }),
  { sendStage: 2, advanceToStage: 2 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 0,
    elapsedMs: WA_FOLLOWUP_MS_2_H,
    enabled: { e1: true, e2: false, e3: true },
  }),
  { sendStage: 1, advanceToStage: 1 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 1,
    elapsedMs: WA_FOLLOWUP_MS_2_H,
    enabled: { e1: true, e2: false, e3: true },
  }),
  { sendStage: 0, advanceToStage: 2 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 1,
    elapsedMs: WA_FOLLOWUP_MS_23_H,
    enabled: { e1: true, e2: false, e3: true },
  }),
  { sendStage: 3, advanceToStage: 3 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 2,
    elapsedMs: WA_FOLLOWUP_MS_23_H,
    enabled: { e1: true, e2: true, e3: false },
  }),
  { sendStage: 0, advanceToStage: 3 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 0,
    elapsedMs: WA_FOLLOWUP_MS_23_H,
    enabled: { e1: false, e2: false, e3: true },
  }),
  { sendStage: 3, advanceToStage: 3 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 0,
    elapsedMs: WA_FOLLOWUP_MS_23_H,
    enabled: allOff,
  }),
  { sendStage: 0, advanceToStage: 3 }
);

assert.deepEqual(
  resolveWaFollowupSendPlan({
    stageCurrent: 0,
    elapsedMs: 60_000,
    enabled: allOn,
  }),
  { sendStage: 0, advanceToStage: 0 }
);

const combos: WaSalesFollowupEnabled[] = [];
for (const e1 of [true, false]) {
  for (const e2 of [true, false]) {
    for (const e3 of [true, false]) {
      combos.push({ e1, e2, e3 });
    }
  }
}
const stages = [0, 1, 2, 3];
const elapsedList = [
  0,
  WA_FOLLOWUP_MS_20_MIN - 1,
  WA_FOLLOWUP_MS_20_MIN,
  WA_FOLLOWUP_MS_2_H - 1,
  WA_FOLLOWUP_MS_2_H,
  WA_FOLLOWUP_MS_23_H - 1,
  WA_FOLLOWUP_MS_23_H,
  WA_FOLLOWUP_MS_23_H + 60_000,
];
let cases = 0;
for (const enabled of combos) {
  for (const stageCurrent of stages) {
    for (const elapsedMs of elapsedList) {
      const plan = resolveWaFollowupSendPlan({ stageCurrent, elapsedMs, enabled });
      assertNeverSendsDisabled(enabled, plan);
      if (plan.sendStage > 0) {
        assert.ok(plan.advanceToStage === plan.sendStage);
      }
      if (plan.advanceToStage < stageCurrent) {
        assert.fail(`must not rewind stage ${stageCurrent} → ${plan.advanceToStage}`);
      }
      cases += 1;
    }
  }
}

console.log(`wa-sales-followup-enabled.test.ts ok (${cases} matrix cases)`);
