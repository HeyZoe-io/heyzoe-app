import assert from "node:assert/strict";
import {
  eventBeforeRuleActivation,
  parseReportEventInstant,
  ruleActivationMs,
  rulesOpenForEvent,
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

console.log("rule-activation.test.ts: ok");
