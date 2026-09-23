import assert from "node:assert/strict";
import type { LeadRow } from "@/lib/leads-types";
import {
  isMarketingNoResponseLead,
  phonesForMarketingNoResponse,
  phonesForMarketingStage,
} from "@/lib/marketing-broadcast-audience";

const base: LeadRow = {
  phone: "972501111111",
  full_name: "דנה",
  source: "זואי אדמין",
  created_at: "2026-08-01T10:00:00.000Z",
  opted_out: false,
  not_relevant_at: null,
  not_relevant_reason: null,
  human_requested_at: null,
  human_followup_at: null,
  next_call_at: null,
  session_phase: "cta",
  trial_registered: false,
  wa_no_response_at: "2026-08-20T10:00:00.000Z",
  no_response_notified_at: null,
  wa_followup_stage: 0,
  last_contact_at: "2026-08-20T10:00:00.000Z",
  cta_clicked_at: null,
  pipeline_status: "no_response",
};

assert.equal(isMarketingNoResponseLead(base), true);
assert.equal(
  isMarketingNoResponseLead({ ...base, pipeline_status: "registered", trial_registered: true }),
  false
);
assert.equal(
  isMarketingNoResponseLead({
    ...base,
    pipeline_status: null,
    wa_no_response_at: null,
    wa_followup_stage: 3,
  }),
  true
);
assert.equal(
  isMarketingNoResponseLead({
    ...base,
    pipeline_status: "active",
    wa_no_response_at: "2026-08-20T10:00:00.000Z",
  }),
  false
);

const phones = phonesForMarketingNoResponse([
  base,
  { ...base, phone: "972501111111" },
  { ...base, phone: "972502222222", pipeline_status: "opted_out", opted_out: true },
  { ...base, phone: "  " },
]);
assert.deepEqual(phones, ["972501111111"]);

const byStage = phonesForMarketingStage(
  [
    { ...base, phone: "972503333333", pipeline_status: "followup", marketing_relevance: "relevant", marketing_stage: "followup" },
    { ...base, phone: "972504444444", marketing_relevance: "not_relevant", marketing_stage: "followup" },
    { ...base, phone: "972505555555", pipeline_status: "registered", trial_registered: true },
  ],
  "followup"
);
assert.deepEqual(byStage, ["972503333333"]);

console.log("marketing-broadcast-audience.test.ts: ok");
