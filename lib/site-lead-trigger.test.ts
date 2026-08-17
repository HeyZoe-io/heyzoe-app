import assert from "node:assert/strict";
import {
  canonicalizeTriggerType,
  isArboxDependentTriggerType,
  isIncomingLeadTriggerType,
  isTriggerType,
  NON_ARBOX_TRIGGER_TYPES,
  TRIGGER_TYPES,
} from "@/lib/template-trigger-types";
import { pickSiteLeadTemplateTriggerRule } from "@/lib/template-triggers-match";
import type { PurchaseTemplateTriggerRule } from "@/lib/template-triggers-match";
import {
  isLeadTemplateOnlyContact,
  isOpeningTemplateLeadSource,
} from "@/lib/lead-template";
import { buildSiteLeadScheduledDedupKey } from "@/lib/scheduled-template-sends";

/** incoming_lead is the sole non-Arbox webhook lead type */
{
  assert.equal(isTriggerType("incoming_lead"), true);
  assert.equal(isArboxDependentTriggerType("incoming_lead"), false);
  assert.ok((NON_ARBOX_TRIGGER_TYPES as readonly string[]).includes("incoming_lead"));
  assert.ok((TRIGGER_TYPES as readonly string[]).includes("incoming_lead"));
  assert.equal(isTriggerType("site_lead"), false);
  assert.equal(isTriggerType("campaign_lead"), false);
  assert.equal(isIncomingLeadTriggerType("incoming_lead"), true);
  assert.equal(isIncomingLeadTriggerType("site_lead"), true);
  assert.equal(isIncomingLeadTriggerType("campaign_lead"), true);
  assert.equal(isIncomingLeadTriggerType("no_response"), false);
  assert.equal(canonicalizeTriggerType("site_lead"), "incoming_lead");
  assert.equal(canonicalizeTriggerType("campaign_lead"), "incoming_lead");
  assert.equal(canonicalizeTriggerType("incoming_lead"), "incoming_lead");
}

/** Arbox types still gated */
{
  assert.equal(isArboxDependentTriggerType("purchase"), true);
  assert.equal(isArboxDependentTriggerType("birthday"), true);
  assert.equal(isArboxDependentTriggerType("arbox_new_lead"), true);
  assert.equal(isTriggerType("arbox_new_lead"), true);
}

function rule(
  partial: Partial<PurchaseTemplateTriggerRule> &
    Pick<PurchaseTemplateTriggerRule, "id" | "template_name">
): PurchaseTemplateTriggerRule {
  return {
    business_id: 1,
    trigger_type: "incoming_lead",
    product_filter: null,
    delay_days: 0,
    delay_direction: "after",
    enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

/** pick newest incoming_lead rule with template_name */
{
  const older = rule({
    id: "old",
    template_name: "T_old",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  const newer = rule({
    id: "new",
    template_name: "T_new",
    updated_at: "2026-08-01T00:00:00.000Z",
  });
  const noTpl = rule({
    id: "empty",
    template_name: null,
    updated_at: "2026-12-01T00:00:00.000Z",
  });
  const picked = pickSiteLeadTemplateTriggerRule([older, newer, noTpl]);
  assert.equal(picked?.id, "new");
  assert.equal(picked?.template_name, "T_new");
}

/** legacy DB rows still resolve (until migration) */
{
  const legacy = rule({
    id: "legacy",
    trigger_type: "site_lead",
    template_name: "T_legacy",
  });
  const picked = pickSiteLeadTemplateTriggerRule([legacy]);
  assert.equal(picked?.template_name, "T_legacy");
}

/** rule-vs-fallback selection (mirrors incoming route) */
{
  const matched = pickSiteLeadTemplateTriggerRule([
    rule({ id: "r1", template_name: "from_rule" }),
  ]);
  const fallback = "from_column";
  const templateName = matched?.template_name?.trim() || fallback;
  assert.equal(templateName, "from_rule");

  const noRule = pickSiteLeadTemplateTriggerRule([]);
  const fallbackOnly = noRule?.template_name?.trim() || fallback;
  assert.equal(fallbackOnly, "from_column");
}

/** dedup key prefix unchanged (historical site_lead:…) */
{
  const a = buildSiteLeadScheduledDedupKey(1, "rule-uuid", "972501234567", "2026-08-04");
  assert.equal(a, "site_lead:1:rule-uuid:972501234567:2026-08-04");
}

/**
 * Contact source stays "site_lead" when an incoming_lead rule matches —
 * no-response cron indexes meta_lead_ad + site_lead only.
 */
{
  assert.equal(isOpeningTemplateLeadSource("meta_lead_ad"), true);
  assert.equal(isOpeningTemplateLeadSource("site_lead"), true);
  assert.equal(isOpeningTemplateLeadSource("incoming_lead"), false);

  const base = {
    session_phase: "opening",
    opted_out: false,
    not_relevant_at: null,
    human_requested_at: null,
    trial_registered: false,
    wa_followup_stage: 0,
  };
  assert.equal(isLeadTemplateOnlyContact({ ...base, source: "meta_lead_ad" }), true);
  assert.equal(isLeadTemplateOnlyContact({ ...base, source: "site_lead" }), true);

  const usingRule = Boolean(
    pickSiteLeadTemplateTriggerRule([
      rule({ id: "c1", trigger_type: "incoming_lead", template_name: "T" }),
    ])
  );
  const contactSource = usingRule ? "site_lead" : "meta_lead_ad";
  assert.equal(contactSource, "site_lead");
  assert.equal(isOpeningTemplateLeadSource(contactSource), true);
}

/** Uniqueness semantics (API): only one incoming_lead row per business */
{
  const existing = [rule({ id: "1", template_name: "A" })];
  const wouldCreateSecond = existing.some((r) => isIncomingLeadTriggerType(r.trigger_type));
  assert.equal(wouldCreateSecond, true);
  assert.equal(isIncomingLeadTriggerType("incoming_lead"), true);
}

console.log("site-lead-trigger.test.ts: ok");
