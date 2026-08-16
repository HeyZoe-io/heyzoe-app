import assert from "node:assert/strict";
import { isSalesFlowStartTrigger } from "@/lib/sales-flow-start-triggers";

assert.equal(isSalesFlowStartTrigger("היי"), true);
assert.equal(isSalesFlowStartTrigger("שלום"), true);
assert.equal(isSalesFlowStartTrigger("אשמח לפרטים"), true);
assert.equal(isSalesFlowStartTrigger("בואו נתחיל"), true);
assert.equal(isSalesFlowStartTrigger("תודה"), false);
assert.equal(isSalesFlowStartTrigger("תודה רבה"), false);
assert.equal(isSalesFlowStartTrigger("ok"), false);

console.log("sales-flow-start-triggers.test.ts: ok");
