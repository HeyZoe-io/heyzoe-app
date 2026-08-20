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

console.log("contact-status.test.ts: ok");
