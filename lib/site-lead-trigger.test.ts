import assert from "node:assert/strict";
import {
  isArboxDependentTriggerType,
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

/** site_lead is a known trigger type and is NOT Arbox-dependent */
{
  assert.equal(isTriggerType("site_lead"), true);
  assert.equal(isArboxDependentTriggerType("site_lead"), false);
  assert.ok((NON_ARBOX_TRIGGER_TYPES as readonly string[]).includes("site_lead"));
  assert.ok((TRIGGER_TYPES as readonly string[]).includes("site_lead"));
}

/** Arbox types still gated */
{
  assert.equal(isArboxDependentTriggerType("purchase"), true);
  assert.equal(isArboxDependentTriggerType("birthday"), true);
}

function rule(
  partial: Partial<PurchaseTemplateTriggerRule> &
    Pick<PurchaseTemplateTriggerRule, "id" | "template_name">
): PurchaseTemplateTriggerRule {
  return {
    business_id: 1,
    trigger_type: "site_lead",
    product_filter: null,
    delay_days: 0,
    delay_direction: "after",
    enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

/** pick newest site_lead rule with template_name */
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

/** site_lead dedup key */
{
  const a = buildSiteLeadScheduledDedupKey(1, "rule-uuid", "972501234567", "2026-08-04");
  const b = buildSiteLeadScheduledDedupKey(1, "rule-uuid", "972501234567", "2026-08-04");
  assert.equal(a, b);
  assert.equal(a, "site_lead:1:rule-uuid:972501234567:2026-08-04");
}

/** no-response helpers accept both sources */
{
  assert.equal(isOpeningTemplateLeadSource("meta_lead_ad"), true);
  assert.equal(isOpeningTemplateLeadSource("site_lead"), true);
  assert.equal(isOpeningTemplateLeadSource("whatsapp"), false);

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
  assert.equal(isLeadTemplateOnlyContact({ ...base, source: "whatsapp" }), false);
}

console.log("site-lead-trigger.test.ts: ok");
