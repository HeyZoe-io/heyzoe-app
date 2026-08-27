import assert from "node:assert/strict";
import { computeContactStatus } from "@/lib/contact-status";
import { mapMarketingFlowSessionToLeadRow } from "@/lib/leads-data";

const nowIso = new Date().toISOString();
const session = {
  phone: "972501234567",
  full_name: "טסט",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: nowIso,
  last_user_message_at: nowIso,
  flow_completed: false,
  current_node_id: "node-1",
  followup_opted_out: true,
  followup_1_sent_at: nowIso,
  followup_2_sent_at: null,
  followup_3_sent_at: null,
  human_followup_at: null,
  next_call_at: null,
};

const registered = mapMarketingFlowSessionToLeadRow(session, true);
assert.equal(registered.opted_out, false);
assert.equal(registered.trial_registered, true);
assert.equal(computeContactStatus(registered), "registered");

const followup = mapMarketingFlowSessionToLeadRow(session, false);
assert.equal(followup.opted_out, false);
assert.equal(followup.trial_registered, false);
assert.equal(computeContactStatus(followup), "followup");

const elinFromNotes = mapMarketingFlowSessionToLeadRow(
  {
    ...session,
    phone: "972524560589",
    full_name: "Elin",
    last_user_message_at: "2026-08-20T11:46:05.000Z",
    followup_1_sent_at: null,
    flow_completed: true,
    current_node_id: null,
  },
  {
    registeredFromMessage: false,
    noteStatus: "registered",
    noteUpdatedAt: "2026-08-13T11:26:51.000Z",
  }
);
assert.equal(computeContactStatus(elinFromNotes), "registered");

const humanFollowup = mapMarketingFlowSessionToLeadRow(
  { ...session, human_followup_at: "2026-08-21T08:00:00.000Z" },
  false
);
assert.equal(computeContactStatus(humanFollowup), "human_followup");

const draggedActive = mapMarketingFlowSessionToLeadRow(
  { ...session, pipeline_status: "active", last_user_message_at: "2026-08-01T10:00:00.000Z" },
  false
);
assert.equal(draggedActive.pipeline_status, "active");

console.log("leads-data.marketing-status.test.ts: ok");
