import assert from "node:assert/strict";
import {
  pickPurchaseTemplateTriggerRule,
  purchaseSaleMembershipScopeIsEmpty,
  purchaseTriggerRuleMatchesMembershipType,
  resolvePurchaseSaleMembershipScope,
  saleMembershipTypeInScope,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";

function rule(
  partial: Partial<PurchaseTemplateTriggerRule> &
    Pick<PurchaseTemplateTriggerRule, "id" | "product_filter" | "template_name">
): PurchaseTemplateTriggerRule {
  return {
    business_id: 1,
    trigger_type: "purchase",
    delay_days: 0,
    delay_direction: "after",
    enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const TRIAL_IDS = [80601, 144543];
const MEMBERSHIP_IDS = [90001, 90002];

const trialRule = rule({
  id: "rule-trial",
  product_filter: TRIAL_IDS,
  template_name: "T_trial",
  updated_at: "2026-06-01T00:00:00.000Z",
});

const membershipRule = rule({
  id: "rule-membership",
  product_filter: MEMBERSHIP_IDS,
  template_name: "T_membership",
  updated_at: "2026-06-02T00:00:00.000Z",
});

const rules = [trialRule, membershipRule];

/** Membership sale → membership template. */
{
  const picked = pickPurchaseTemplateTriggerRule(rules, 90001);
  assert.equal(picked?.id, "rule-membership");
  assert.equal(picked?.template_name, "T_membership");
}

/** Trial sale → trial template. */
{
  const picked = pickPurchaseTemplateTriggerRule(rules, 80601);
  assert.equal(picked?.id, "rule-trial");
  assert.equal(picked?.template_name, "T_trial");
}

/** Unmatched membership_type_id → no_rule. */
{
  const picked = pickPurchaseTemplateTriggerRule(rules, 11111);
  assert.equal(picked, null);
}

/** Specific product_filter wins over catch-all. */
{
  const catchAll = rule({
    id: "rule-catch-all",
    product_filter: null,
    template_name: "T_any",
    updated_at: "2026-12-01T00:00:00.000Z",
  });
  const picked = pickPurchaseTemplateTriggerRule([catchAll, trialRule, membershipRule], 144543);
  assert.equal(picked?.id, "rule-trial");
  assert.equal(picked?.template_name, "T_trial");
}

/** Catch-all matches when no specific rule matches. */
{
  const catchAll = rule({
    id: "rule-catch-all",
    product_filter: null,
    template_name: "T_any",
  });
  assert.equal(purchaseTriggerRuleMatchesMembershipType(catchAll, 99999), true);
  const picked = pickPurchaseTemplateTriggerRule([trialRule, catchAll], 99999);
  assert.equal(picked?.id, "rule-catch-all");
  assert.equal(picked?.template_name, "T_any");
}

/** Cron scope: union of trial IDs + purchase rule product filters. */
{
  const scope = resolvePurchaseSaleMembershipScope({
    trialMembershipTypeIds: TRIAL_IDS,
    purchaseRules: [membershipRule],
  });
  assert.equal(scope.mode, "ids");
  if (scope.mode === "ids") {
    assert.deepEqual(scope.membershipTypeIds, [...TRIAL_IDS, ...MEMBERSHIP_IDS].sort((a, b) => a - b));
  }
  assert.equal(saleMembershipTypeInScope(90001, scope), true);
  assert.equal(saleMembershipTypeInScope(80601, scope), true);
  assert.equal(saleMembershipTypeInScope(11111, scope), false);
}

/** Cron scope: empty product_filter catch-all → all sales. */
{
  const catchAll = rule({
    id: "rule-catch-all",
    product_filter: null,
    template_name: "T_any",
  });
  const scope = resolvePurchaseSaleMembershipScope({
    trialMembershipTypeIds: [],
    purchaseRules: [catchAll],
  });
  assert.equal(scope.mode, "all");
  assert.equal(saleMembershipTypeInScope(99999, scope), true);
  assert.equal(purchaseSaleMembershipScopeIsEmpty(scope), false);
}

/** Cron scope: nothing configured → empty (skip business). */
{
  const scope = resolvePurchaseSaleMembershipScope({
    trialMembershipTypeIds: [],
    purchaseRules: [],
  });
  assert.equal(purchaseSaleMembershipScopeIsEmpty(scope), true);
}

console.log("template-triggers-match.test.ts: ok");
