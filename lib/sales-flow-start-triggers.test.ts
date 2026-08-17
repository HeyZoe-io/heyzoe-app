import assert from "node:assert/strict";
import {
  isSalesFlowStartTrigger,
  salesFlowGreetingMarkerCountsAsStarted,
} from "@/lib/sales-flow-start-triggers";

assert.equal(isSalesFlowStartTrigger("היי"), false);
assert.equal(isSalesFlowStartTrigger("שלום"), false);
assert.equal(isSalesFlowStartTrigger("hi"), false);
assert.equal(isSalesFlowStartTrigger("אשמח לפרטים"), true);
assert.equal(isSalesFlowStartTrigger("אשמח לשמוע פרטים"), true);
assert.equal(isSalesFlowStartTrigger("אפשר פרטים?"), true);
assert.equal(isSalesFlowStartTrigger("אשמח למידע"), true);
assert.equal(isSalesFlowStartTrigger("בואו נתחיל"), true);
assert.equal(isSalesFlowStartTrigger("בואו נתחיל!"), true);
assert.equal(isSalesFlowStartTrigger("היי אשמח לפרטים"), true);
assert.equal(isSalesFlowStartTrigger("תודה"), false);
assert.equal(isSalesFlowStartTrigger("תודה רבה"), false);
assert.equal(isSalesFlowStartTrigger("ok"), false);

assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({ modelUsed: "greeting", precedingUserText: "תודה" }),
  true
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "default_opening",
    precedingUserText: "היי",
  }),
  false
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "default_opening",
    precedingUserText: "אשמח לפרטים",
  }),
  true
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "default_opening",
    precedingUserText: "יש איפה לשים אופניים?",
  }),
  false
);

console.log("sales-flow-start-triggers.test.ts: ok");
