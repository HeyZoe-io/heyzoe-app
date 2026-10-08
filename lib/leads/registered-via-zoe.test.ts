import assert from "node:assert/strict";
import { registeredViaZoe } from "./registered-via-zoe";

// Tights (3543), 2026-10-07 trial. Both registered through Zoe, no Arbox purchase yet.
const adi = { phone: "972528632266", trial_registered: true, session_phase: "registered", arbox_is_member: false };
const shira = { phone: "972525663145", trial_registered: true, session_phase: "registered", arbox_is_member: false };
assert.equal(registeredViaZoe(adi), true, "Adi ...2266 is skipped");
assert.equal(registeredViaZoe(shira), true, "Shira ...3145 is skipped");

assert.equal(registeredViaZoe({ trial_registered: true, session_phase: "opening" }), true);
assert.equal(registeredViaZoe({ trial_registered: false, session_phase: "registered" }), true);
assert.equal(registeredViaZoe({ trial_registered: false, session_phase: "opening" }), false, "a lead still in the flow");
assert.equal(registeredViaZoe({ trial_registered: null, session_phase: null }), false);
assert.equal(registeredViaZoe(null), false);

console.log("registered-via-zoe.test.ts: ok");
