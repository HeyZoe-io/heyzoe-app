import assert from "node:assert/strict";
import {
  pickPurchaseTemplateTriggerRule,
  purchaseSaleMembershipScopeIsEmpty,
  purchaseTriggerRuleMatchesItemType,
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
    item_type_filter: null,
    delay_days: 0,
    delay_direction: "after",
    lookback_days: null,
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

/** item_type_filter: plan-only vs session-only for the same id set. */
{
  const planOnly = rule({
    id: "rule-plan",
    product_filter: null,
    item_type_filter: ["plan"],
    template_name: "T_plan",
    updated_at: "2026-07-01T00:00:00.000Z",
  });
  const sessionOnly = rule({
    id: "rule-session",
    product_filter: null,
    item_type_filter: ["session"],
    template_name: "T_session",
    updated_at: "2026-07-02T00:00:00.000Z",
  });
  assert.equal(purchaseTriggerRuleMatchesItemType(planOnly, "plan"), true);
  assert.equal(purchaseTriggerRuleMatchesItemType(planOnly, "session"), false);
  assert.equal(purchaseTriggerRuleMatchesItemType(planOnly, "trial"), false);
  assert.equal(pickPurchaseTemplateTriggerRule([planOnly, sessionOnly], 90001, "plan")?.id, "rule-plan");
  assert.equal(
    pickPurchaseTemplateTriggerRule([planOnly, sessionOnly], 90001, "session")?.id,
    "rule-session"
  );
  assert.equal(pickPurchaseTemplateTriggerRule([planOnly, sessionOnly], 90001, "service"), null);
  assert.equal(pickPurchaseTemplateTriggerRule([planOnly, sessionOnly], 90001, null), null);
}

/** item_type + product_filter both apply; more specific wins over class-only. */
{
  const planAny = rule({
    id: "rule-plan-any",
    product_filter: null,
    item_type_filter: ["plan"],
    template_name: "T_plan_any",
    updated_at: "2026-08-01T00:00:00.000Z",
  });
  const planSpecific = rule({
    id: "rule-plan-id",
    product_filter: [90001],
    item_type_filter: ["plan"],
    template_name: "T_plan_id",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(
    pickPurchaseTemplateTriggerRule([planAny, planSpecific], 90001, "plan")?.id,
    "rule-plan-id"
  );
  assert.equal(
    pickPurchaseTemplateTriggerRule([planAny, planSpecific], 90002, "plan")?.id,
    "rule-plan-any"
  );
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

/** Cron scope: empty product_filter catch-all → all sales (incl. item_type-only rules). */
{
  const catchAll = rule({
    id: "rule-catch-all",
    product_filter: null,
    item_type_filter: ["plan"],
    template_name: "T_plan",
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
