import assert from "node:assert/strict";
import { metaAudienceBucketForRelevance, metaAudienceBucketForStatus } from "@/lib/ads/meta-audiences";
import type { LeadRow } from "@/lib/leads-types";
import {
  formatMarketingAdminStatusLabel,
  marketingStageLabel,
  resolveMarketingAdminColumn,
  splitStoredMarketingStatus,
} from "@/lib/marketing-admin-status";

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
  wa_no_response_at: null,
  no_response_notified_at: null,
  wa_followup_stage: 3,
  last_contact_at: "2026-08-01T10:00:00.000Z",
  cta_clicked_at: null,
  pipeline_status: null,
};

assert.deepEqual(
  splitStoredMarketingStatus({ status: "not_relevant", relevance: null, hasNote: true }),
  { relevance: "not_relevant", stage: "in_process" }
);
assert.deepEqual(
  splitStoredMarketingStatus({ status: "no_response", relevance: "relevant", hasNote: true }),
  { relevance: "relevant", stage: "no_response" }
);
assert.equal(splitStoredMarketingStatus({ status: "in_process", hasNote: false }), null);

assert.equal(
  resolveMarketingAdminColumn({
    ...base,
    marketing_relevance: "relevant",
    marketing_stage: "no_response",
    pipeline_status: "active",
  }),
  "no_response"
);
assert.equal(
  resolveMarketingAdminColumn({
    ...base,
    marketing_relevance: "not_relevant",
    marketing_stage: "no_response",
  }),
  "not_relevant"
);
assert.equal(resolveMarketingAdminColumn({ ...base, pipeline_status: "human_followup" }), "requires_call");
assert.equal(resolveMarketingAdminColumn(base), "no_response");
assert.equal(
  formatMarketingAdminStatusLabel({ relevance: "relevant", stage: "no_response" }),
  "רלוונטי + ללא מענה"
);
assert.equal(formatMarketingAdminStatusLabel({ relevance: "not_relevant", stage: "followup" }), "לא רלוונטי");
assert.equal(marketingStageLabel("setup_call"), "שיחת הקמה");
assert.equal(
  formatMarketingAdminStatusLabel({ relevance: "relevant", stage: "setup_call" }),
  "רלוונטי + שיחת הקמה"
);

assert.equal(metaAudienceBucketForRelevance("relevant"), "relevant");
assert.equal(metaAudienceBucketForRelevance("not_relevant"), "excluded");
assert.equal(metaAudienceBucketForStatus("no_response"), "relevant");
assert.equal(metaAudienceBucketForStatus("in_process"), "relevant");
assert.equal(metaAudienceBucketForStatus("setup_call"), "relevant");
assert.equal(metaAudienceBucketForStatus("not_relevant"), "excluded");
assert.equal(metaAudienceBucketForStatus("opted_out"), null);

console.log("marketing-admin-status.test.ts: ok");
