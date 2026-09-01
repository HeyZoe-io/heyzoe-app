import assert from "node:assert/strict";
import { computeContactStatus } from "@/lib/contact-status";
import type { LeadRow } from "@/lib/leads-types";
import {
  applyManualPipelineStatus,
  applyMarketingLeadStatusHints,
  marketingNoteStatusToPipeline,
} from "@/lib/marketing-pipeline-status";

const nowIso = new Date().toISOString();
const base: LeadRow = {
  phone: "972524560589",
  full_name: "Elin",
  source: "זואי אדמין",
  created_at: "2026-08-11T10:48:30.000Z",
  opted_out: false,
  not_relevant_at: null,
  not_relevant_reason: null,
  human_requested_at: null,
  human_followup_at: null,
  next_call_at: null,
  session_phase: "cta",
  trial_registered: false,
  wa_no_response_at: null,
  no_response_notified_at: null,
  wa_followup_stage: 0,
  last_contact_at: "2026-08-20T11:46:05.000Z",
  cta_clicked_at: null,
};

assert.equal(marketingNoteStatusToPipeline("registered"), "registered");
assert.equal(marketingNoteStatusToPipeline("not_interested"), "not_interested");
assert.equal(marketingNoteStatusToPipeline("not_relevant"), "not_relevant");
assert.equal(marketingNoteStatusToPipeline("in_process"), null);

const elin = applyMarketingLeadStatusHints(base, {
  registeredFromMessage: false,
  noteStatus: "registered",
  noteUpdatedAt: "2026-08-13T11:26:51.000Z",
});
assert.equal(elin.trial_registered, true);
assert.equal(computeContactStatus(elin), "registered");

const idleNoNote = applyMarketingLeadStatusHints(base, { registeredFromMessage: false });
assert.equal(computeContactStatus(idleNoNote), "no_response");

const draggedNoResponse = applyManualPipelineStatus(elin, "no_response", nowIso);
assert.equal(computeContactStatus(draggedNoResponse), "no_response");
assert.equal(draggedNoResponse.trial_registered, false);

const draggedHuman = applyManualPipelineStatus(elin, "human_followup", nowIso);
assert.equal(computeContactStatus(draggedHuman), "human_followup");

const messageRegisteredWinsOverIdle = applyMarketingLeadStatusHints(base, {
  registeredFromMessage: true,
});
assert.equal(computeContactStatus(messageRegisteredWinsOverIdle), "registered");

const pipelineOverridesNote = applyMarketingLeadStatusHints(base, {
  noteStatus: "registered",
  pipelineStatus: "not_relevant",
  noteUpdatedAt: nowIso,
});
assert.equal(computeContactStatus(pipelineOverridesNote), "not_relevant");

const draggedActive = applyManualPipelineStatus(idleNoNote, "active", nowIso);
assert.equal(draggedActive.pipeline_status, "active");
assert.equal(computeContactStatus(draggedActive), "no_response");

const pipelineActiveHint = applyMarketingLeadStatusHints(base, {
  pipelineStatus: "active",
  noteUpdatedAt: nowIso,
});
assert.equal(pipelineActiveHint.pipeline_status, "active");

const noteNotInterested = applyMarketingLeadStatusHints(base, {
  noteStatus: "not_interested",
  noteUpdatedAt: nowIso,
});
assert.equal(noteNotInterested.pipeline_status, "not_interested");
assert.equal(noteNotInterested.not_relevant_at, null);
assert.notEqual(computeContactStatus(noteNotInterested), "not_relevant");

const draggedNotInterested = applyManualPipelineStatus(base, "not_interested", nowIso);
assert.equal(draggedNotInterested.pipeline_status, "not_interested");
assert.equal(draggedNotInterested.not_relevant_at, null);
assert.equal(draggedNotInterested.human_followup_at, null);

const pipelineOverridesNotInterestedNote = applyMarketingLeadStatusHints(base, {
  noteStatus: "not_interested",
  pipelineStatus: "not_relevant",
  noteUpdatedAt: nowIso,
});
assert.equal(computeContactStatus(pipelineOverridesNotInterestedNote), "not_relevant");

console.log("marketing-pipeline-status.test.ts: ok");
