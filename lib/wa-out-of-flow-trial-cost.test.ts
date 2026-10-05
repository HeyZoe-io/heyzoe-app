import assert from "node:assert/strict";
import { isSalesFlowStartTrigger } from "@/lib/sales-flow-start-triggers";
import { matchesTrialTopicAdvanceIntent } from "@/lib/wa-trial-topic-intent";
import {
  OUT_OF_FLOW_TRIAL_COST_INVITE_HE,
  buildOutOfFlowTrialCostReply,
  isOutOfFlowTrialCostQuestion,
} from "@/lib/wa-out-of-flow-trial-cost";

const rachel = "היי, אימון ניסיון זה בעלות מסויימת?";

assert.equal(isOutOfFlowTrialCostQuestion(rachel), true);
assert.equal(matchesTrialTopicAdvanceIntent(rachel), false);
assert.equal(isOutOfFlowTrialCostQuestion("רוצה אימון ניסיון"), false);
assert.equal(isOutOfFlowTrialCostQuestion("כמה עולה מנוי?"), false);
assert.equal(isSalesFlowStartTrigger("אשמח לפרטים"), true);

const apexServices = [
  { name: "יוגה", priceText: "45", offerKind: "trial" },
  { name: "אימון פונקציונלי", priceText: "45", offerKind: "trial" },
  { name: "אימונים לילדים (ד'-ו')", priceText: "ללא עלות", offerKind: "trial" },
  { name: "אימונים לנוער (ז'-י')", priceText: "ללא עלות", offerKind: "trial" },
];

assert.equal(
  buildOutOfFlowTrialCostReply(apexServices, rachel),
  `אימון היכרות עולה 45 ₪.\n${OUT_OF_FLOW_TRIAL_COST_INVITE_HE}`
);

assert.equal(
  buildOutOfFlowTrialCostReply(apexServices, "כמה עולה אימון ניסיון לילדים?"),
  `אימון היכרות ללא עלות.\n${OUT_OF_FLOW_TRIAL_COST_INVITE_HE}`
);

assert.equal(
  buildOutOfFlowTrialCostReply(
    [
      { name: "יוגה", priceText: "80", offerKind: "trial" },
      { name: "פילאטיס", priceText: "120", offerKind: "trial" },
    ],
    "כמה עולה שיעור ניסיון?"
  ),
  `אימון היכרות עולה 80–120 ₪.\n${OUT_OF_FLOW_TRIAL_COST_INVITE_HE}`
);

assert.equal(buildOutOfFlowTrialCostReply([], rachel), null);

assert.match(
  buildOutOfFlowTrialCostReply(apexServices, "how much is a trial class?") ?? "",
  /45 ₪/
);

console.log("wa-out-of-flow-trial-cost.test.ts: ok");
