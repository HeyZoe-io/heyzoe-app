import assert from "node:assert/strict";
import {
  resolveWaFollowupSendPlan,
  resolveWaSalesFollowupEnabled,
  socialFlagEnabled,
  WA_FOLLOWUP_MS_20_MIN,
  WA_FOLLOWUP_MS_2_H,
  WA_FOLLOWUP_MS_23_H,
} from "@/lib/wa-sales-followup-defaults";

assert.equal(socialFlagEnabled(undefined), true);
assert.equal(socialFlagEnabled(null), true);
assert.equal(socialFlagEnabled(true), true);
assert.equal(socialFlagEnabled(false), false);

assert.deepEqual(resolveWaSalesFollowupEnabled({}), { e1: true, e2: true, e3: true });
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
    stageCurrent: 1,
    elapsedMs: WA_FOLLOWUP_MS_2_H,
    enabled: { e1: true, e2: false, e3: true },
  }),
  { sendStage: 0, advanceToStage: 2 }
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

console.log("wa-sales-followup-enabled.test.ts ok");
