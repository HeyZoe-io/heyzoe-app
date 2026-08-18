import assert from "node:assert/strict";
import {
  isCasualHiGreeting,
  isSalesFlowStartTrigger,
  buildCasualHiGreetingReply,
  salesFlowGreetingMarkerCountsAsStarted,
} from "@/lib/sales-flow-start-triggers";

assert.equal(isSalesFlowStartTrigger("היי"), false);
assert.equal(isSalesFlowStartTrigger("היי", { slug: "info-2815" }), true);
assert.equal(isSalesFlowStartTrigger("היי!", { slug: "info-2815" }), true);
assert.equal(isSalesFlowStartTrigger("היי", { businessName: "סאנגה יוגה" }), true);
assert.equal(isSalesFlowStartTrigger("היי", { slug: "limitless" }), false);
assert.equal(isSalesFlowStartTrigger("שלום"), false);
assert.equal(isSalesFlowStartTrigger("hi"), false);
assert.equal(isSalesFlowStartTrigger("אשמח לפרטים"), true);
assert.equal(isSalesFlowStartTrigger("אשמח לשמוע פרטים"), true);
assert.equal(isSalesFlowStartTrigger("אפשר פרטים?"), true);
assert.equal(isSalesFlowStartTrigger("אשמח למידע"), true);
assert.equal(isSalesFlowStartTrigger("פרטים"), true);
assert.equal(isSalesFlowStartTrigger("רוצה פרטים"), true);
assert.equal(isSalesFlowStartTrigger("מהתחלה"), true);
assert.equal(isSalesFlowStartTrigger("התחלה"), true);
assert.equal(isSalesFlowStartTrigger("להתחיל מהתחלה"), true);
assert.equal(isSalesFlowStartTrigger("בואו נתחיל"), true);
assert.equal(isSalesFlowStartTrigger("בואו נתחיל!"), true);
assert.equal(isSalesFlowStartTrigger("היי אשמח לפרטים"), true);
assert.equal(isSalesFlowStartTrigger("היי פרטים"), true);
assert.equal(isSalesFlowStartTrigger("תודה"), false);
assert.equal(isSalesFlowStartTrigger("תודה רבה"), false);
assert.equal(isSalesFlowStartTrigger("ok"), false);

assert.equal(isCasualHiGreeting("היי"), true);
assert.equal(isCasualHiGreeting("היי!"), true);
assert.equal(isCasualHiGreeting("  היי  "), true);
assert.equal(isCasualHiGreeting("היי אשמח לפרטים"), false);
assert.equal(isCasualHiGreeting("שלום"), false);
assert.equal(
  buildCasualHiGreetingReply("אלין", "Limitless"),
  "היי! כאן אלין, הבוטית של Limitless איך אפשר לעזור?"
);
assert.equal(
  buildCasualHiGreetingReply("", ""),
  "היי! כאן זואי, הבוטית של העסק איך אפשר לעזור?"
);

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
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "registration_intent_no_member",
    precedingUserText: "רוצה להצטרף בשבת לפוואר אנד הייט",
  }),
  true
);

console.log("sales-flow-start-triggers.test.ts: ok");
