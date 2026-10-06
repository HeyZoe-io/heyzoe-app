import assert from "node:assert/strict";
import {
  eventBeforeRuleActivation,
  parseReportEventInstant,
  ruleActivationMs,
  ruleActivationResets,
  rulesOpenForEvent,
  type RuleActivationSnapshot,
} from "@/lib/rule-activation";

const created = "2026-10-05T10:00:00.000Z";
const activated = "2026-10-05T14:00:00.000Z";

const fresh = { id: "new", created_at: activated, updated_at: activated };
const reenabled = { id: "old", created_at: created, updated_at: activated };
const waiting = { id: "tights", created_at: created, updated_at: created };
const approved = { id: "tights", created_at: created, updated_at: activated };

assert.equal(ruleActivationMs(reenabled), Date.parse(activated));
assert.equal(ruleActivationMs({ id: "x", created_at: activated, updated_at: created }), Date.parse(activated));

const earlier = parseReportEventInstant("2026-10-05T09:00:00.000Z");
const later = parseReportEventInstant("2026-10-05T15:00:00.000Z");
assert.ok(earlier && later);

for (const rule of [fresh, reenabled, approved]) {
  assert.equal(rulesOpenForEvent([rule], earlier).length, 0);
  assert.equal(rulesOpenForEvent([rule], later).length, 1);
}

assert.equal(eventBeforeRuleActivation(earlier, waiting), true);
assert.equal(eventBeforeRuleActivation(parseReportEventInstant("2026-10-05T10:30:00.000Z"), waiting), false);
assert.equal(eventBeforeRuleActivation(earlier, approved), true);
assert.equal(eventBeforeRuleActivation(later, approved), false);
assert.equal(rulesOpenForEvent([fresh], null).length, 0);
assert.equal(eventBeforeRuleActivation(parseReportEventInstant("2026-10-05"), fresh), true);

function shouldSendAfterSilentSeed(alreadyActive: boolean, alreadyLogged: boolean): boolean {
  return alreadyActive && !alreadyLogged;
}
assert.equal(shouldSendAfterSilentSeed(false, false), false);
assert.equal(shouldSendAfterSilentSeed(true, true), false);
assert.equal(shouldSendAfterSilentSeed(true, false), true);

const active: RuleActivationSnapshot = {
  enabled: true,
  trigger_type: "trial_reminder",
  product_filter: [442268, 622016],
  item_type_filter: null,
  delay_days: 1,
  delay_direction: "before",
  lookback_days: null,
  template_name: "trial_reminder",
};

assert.equal(
  ruleActivationResets(active, { template_name: "trial_reminder_v2" }),
  false,
  "template rebinding must not reset activation"
);
assert.equal(ruleActivationResets(active, { template_name: "trial_reminder" }), false);
assert.equal(ruleActivationResets({ ...active, enabled: false }, { enabled: false }), false);

const edited = { ...active, template_name: "trial_reminder_v2" };
const activationBeforeEdit = "2026-10-01T06:00:00.000Z";
const loggedBookingAt = "2026-10-05T06:00:21.000Z";
assert.equal(ruleActivationResets(active, { template_name: edited.template_name }), false);
assert.ok(Date.parse(loggedBookingAt) >= Date.parse(activationBeforeEdit));

assert.equal(ruleActivationResets(active, { enabled: false }), false);
assert.equal(ruleActivationResets({ ...active, enabled: false }, { enabled: true }), true);
assert.equal(ruleActivationResets(active, { delay_days: 0 }), true);
assert.equal(ruleActivationResets(active, { delay_direction: "after" }), true);
assert.equal(ruleActivationResets(active, { trigger_type: "trial_booked" }), true);
assert.equal(ruleActivationResets(active, { product_filter: [442268] }), true);
assert.equal(ruleActivationResets(active, { product_filter: [622016, 442268] }), false);
assert.equal(ruleActivationResets(active, { lookback_days: 14 }), true);
assert.equal(ruleActivationResets(active, { item_type_filter: ["session"] }), true);
assert.equal(ruleActivationResets(active, { delay_days: 1, template_name: "other" }), false);

const stillActiveAfterTemplateEdit = !ruleActivationResets(active, { template_name: "trial_reminder_v2" });
assert.equal(shouldSendAfterSilentSeed(stillActiveAfterTemplateEdit, false), true);
const resetByReenable = ruleActivationResets({ ...active, enabled: false }, { enabled: true });
assert.equal(resetByReenable, true);
assert.equal(shouldSendAfterSilentSeed(!resetByReenable, false), false);

console.log("rule-activation.test.ts: ok");
