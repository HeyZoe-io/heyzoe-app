import assert from "node:assert/strict";
import {
  canManuallySetContactStatus,
  computeContactStatus,
  contactStatusMatchesFilter,
} from "@/lib/contact-status";
import { buildNoResponseContactPatch } from "@/lib/wa-no-response";

const humanRequested = {
  human_requested_at: "2026-08-20T07:00:00.000Z",
};

assert.equal(computeContactStatus(humanRequested), "human_requested");

assert.equal(canManuallySetContactStatus("registered", humanRequested), true);
assert.equal(canManuallySetContactStatus("not_relevant", humanRequested), true);
assert.equal(canManuallySetContactStatus("no_response", humanRequested), true);
assert.equal(canManuallySetContactStatus("human_requested", humanRequested), false);

assert.equal(
  canManuallySetContactStatus("human_requested", {
    trial_registered: true,
    session_phase: "registered",
  }),
  true
);

assert.equal(
  canManuallySetContactStatus("human_requested", {
    trial_registered: true,
    session_phase: "registered",
    human_requested_at: "2026-08-20T07:00:00.000Z",
  }),
  false
);

assert.equal(canManuallySetContactStatus("registered", { opted_out: true, ...humanRequested }), false);
assert.equal(
  canManuallySetContactStatus("no_response", {
    ...humanRequested,
    trial_registered: true,
  }),
  false
);

assert.equal(
  computeContactStatus({
    ...humanRequested,
    trial_registered: true,
    session_phase: "registered",
    human_requested_at: null,
  }),
  "registered"
);

assert.equal(
  computeContactStatus({
    trial_registered: true,
    session_phase: "registered",
    human_requested_at: "2026-08-20T07:00:00.000Z",
  }),
  "registered_human_requested"
);

assert.equal(
  contactStatusMatchesFilter("registered_human_requested", "registered"),
  true
);
assert.equal(
  contactStatusMatchesFilter("registered_human_requested", "human_requested"),
  true
);
assert.equal(contactStatusMatchesFilter("registered", "human_requested"), false);
assert.equal(
  contactStatusMatchesFilter("registered_human_requested", "registered_human_requested"),
  true
);

assert.equal(
  computeContactStatus({
    ...humanRequested,
    not_relevant_at: "2026-08-20T08:00:00.000Z",
    human_requested_at: null,
  }),
  "not_relevant"
);

const noResponsePatch = buildNoResponseContactPatch("2026-08-20T08:00:00.000Z");
assert.equal(noResponsePatch.human_requested_at, null);
assert.equal(
  computeContactStatus({
    ...humanRequested,
    ...noResponsePatch,
  }),
  "no_response"
);

const recentLead = new Date().toISOString();
const silentLead = new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString();

assert.equal(
  computeContactStatus({
    wa_followup_stage: 4,
    last_contact_at: recentLead,
    session_phase: "cta",
  }),
  "active"
);
assert.equal(
  computeContactStatus({
    wa_followup_stage: 3,
    last_contact_at: recentLead,
    session_phase: "cta",
  }),
  "no_response"
);
assert.equal(
  computeContactStatus({
    wa_followup_stage: 4,
    last_contact_at: silentLead,
  }),
  "no_response"
);
assert.equal(
  computeContactStatus({
    human_requested_at: recentLead,
    wa_followup_stage: 4,
    last_contact_at: recentLead,
  }),
  "human_requested"
);

console.log("contact-status.test.ts: ok");
