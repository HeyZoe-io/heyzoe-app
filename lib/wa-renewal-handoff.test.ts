import assert from "node:assert/strict";
import {
  isRenewalTemplateHandoffText,
  RENEWAL_HANDOFF_MODEL,
  RENEWAL_MEMBERSHIP_BUTTON_LABEL,
  RENEWAL_SESSIONS_BUTTON_LABEL,
} from "@/lib/wa-renewal-handoff";
import { isSalesFlowStartTrigger } from "@/lib/sales-flow-start-triggers";

assert.equal(isRenewalTemplateHandoffText(RENEWAL_MEMBERSHIP_BUTTON_LABEL), true);
assert.equal(isRenewalTemplateHandoffText(RENEWAL_SESSIONS_BUTTON_LABEL), true);
assert.equal(isRenewalTemplateHandoffText("אשמח לחדש מנוי"), true);
assert.equal(isRenewalTemplateHandoffText("אשמח לחדש כרטיסיה"), true);
assert.equal(isRenewalTemplateHandoffText("חידוש מנוי!"), true);

assert.equal(isRenewalTemplateHandoffText("אשמח לפרטים"), false);
assert.equal(isRenewalTemplateHandoffText("הצטרפות למנוי"), false);
assert.equal(isRenewalTemplateHandoffText("אפשר לחדש מנוי?"), false);
assert.equal(isRenewalTemplateHandoffText("מחירי מנויים"), false);

assert.equal(isSalesFlowStartTrigger("אשמח לפרטים"), true);
assert.equal(isSalesFlowStartTrigger("הצטרפות למנוי"), true);
assert.equal(isSalesFlowStartTrigger(RENEWAL_MEMBERSHIP_BUTTON_LABEL), false);
assert.equal(isSalesFlowStartTrigger(RENEWAL_SESSIONS_BUTTON_LABEL), false);

assert.equal(RENEWAL_HANDOFF_MODEL, "renewal_template_team_handoff");

console.log("wa-renewal-handoff.test.ts: ok");
