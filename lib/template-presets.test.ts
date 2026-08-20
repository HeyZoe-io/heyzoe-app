import assert from "node:assert/strict";
import {
  extractBodyVarCount,
  isPresetAvailable,
  paramSlotsForTriggerType,
  TEMPLATE_PRESETS,
} from "@/lib/template-presets";

assert.equal(TEMPLATE_PRESETS.incoming_lead.body, TEMPLATE_PRESETS.arbox_new_lead.body);
assert.equal(TEMPLATE_PRESETS.incoming_lead.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.arbox_new_lead.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.trial_attended.category, "MARKETING");
assert.equal(TEMPLATE_PRESETS.no_response.button_text, "אשמח לפרטים");
assert.equal(TEMPLATE_PRESETS.membership_expiring.button_text, "חידוש מנוי");
assert.equal(TEMPLATE_PRESETS.sessions_expiring.button_text, "חידוש כרטיסיה");
assert.equal(TEMPLATE_PRESETS.trial_attended.button_text, "הצטרפות למנוי");
assert.equal(
  TEMPLATE_PRESETS.trial_attended.body,
  "היי {{1}}, איך היה בשיעור הניסיון? נשמח לעזור לך להמשיך 😊\nיש לנו מספר אפשרויות להצטרפות למנוי:"
);
assert.equal(TEMPLATE_PRESETS.purchase.button_text, undefined);

assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.incoming_lead.body), 1);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.purchase.body), 2);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.membership_expiring.body), 3);
assert.equal(extractBodyVarCount(TEMPLATE_PRESETS.trial_attended.body), 1);

assert.deepEqual(paramSlotsForTriggerType("incoming_lead"), ["business_name"]);
assert.deepEqual(paramSlotsForTriggerType("site_lead"), ["business_name"]);
assert.deepEqual(paramSlotsForTriggerType("purchase"), ["first_name", "business_name"]);
assert.deepEqual(paramSlotsForTriggerType("membership_expiring"), [
  "first_name",
  "business_name",
  "expiry_date",
]);

assert.equal(isPresetAvailable("incoming_lead", false), true);
assert.equal(isPresetAvailable("arbox_new_lead", false), false);
assert.equal(isPresetAvailable("arbox_new_lead", true), true);

console.log("template-presets.test.ts: ok");
