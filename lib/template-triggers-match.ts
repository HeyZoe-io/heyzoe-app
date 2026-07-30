import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type PurchaseTemplateTriggerRule = {
  /** UUID string from template_triggers.id — do not coerce with Number(). */
  id: string;
  business_id: number;
  trigger_type: string;
  product_filter: number[] | null;
  delay_days: number;
  delay_direction: string;
  template_name: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string | null;
};

function parseProductFilter(raw: unknown): number[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const ids: number[] = [];
  for (const item of raw) {
    const n = Number(item);
    if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) ids.push(n);
  }
  if (!ids.length) return null;
  return [...new Set(ids)].sort((a, b) => a - b);
}

function normalizeRule(row: Record<string, unknown>): PurchaseTemplateTriggerRule {
  return {
    id: String(row.id ?? "").trim(),
    business_id: Number(row.business_id),
    trigger_type: String(row.trigger_type ?? ""),
    product_filter: parseProductFilter(row.product_filter),
    delay_days: Number(row.delay_days ?? 0),
    delay_direction: String(row.delay_direction ?? "after"),
    template_name: row.template_name != null ? String(row.template_name).trim() || null : null,
    enabled: Boolean(row.enabled),
    created_at: String(row.created_at ?? ""),
    updated_at: row.updated_at != null ? String(row.updated_at) : null,
  };
}

function ruleUpdatedAtMs(rule: PurchaseTemplateTriggerRule): number {
  const raw = rule.updated_at || rule.created_at;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

/** True when product_filter is null/empty (catch-all) or contains membershipTypeId. */
export function purchaseTriggerRuleMatchesMembershipType(
  rule: PurchaseTemplateTriggerRule,
  membershipTypeId: number
): boolean {
  const filter = rule.product_filter;
  if (!filter?.length) return true;
  return filter.includes(membershipTypeId);
}

/**
 * Among enabled purchase rules, pick the best match for a sale membership_type_id.
 * Prefer specific product_filter over catch-all; tie-break by most recently updated.
 */
export function pickPurchaseTemplateTriggerRule(
  rules: PurchaseTemplateTriggerRule[],
  membershipTypeId: number
): PurchaseTemplateTriggerRule | null {
  const matching = rules.filter((rule) =>
    purchaseTriggerRuleMatchesMembershipType(rule, membershipTypeId)
  );
  if (!matching.length) return null;

  const specific = matching.filter((rule) => (rule.product_filter?.length ?? 0) > 0);
  const pool = specific.length ? specific : matching;

  pool.sort((a, b) => ruleUpdatedAtMs(b) - ruleUpdatedAtMs(a));
  return pool[0] ?? null;
}

export async function loadEnabledPurchaseTemplateTriggers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule[]> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "purchase")
    .eq("enabled", true);

  if (error) {
    console.error("[template-triggers-match] load purchase rules failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => normalizeRule(row as Record<string, unknown>));
}

export async function resolvePurchaseTemplateTriggerForSale(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  membershipTypeId: number | null;
}): Promise<PurchaseTemplateTriggerRule | null> {
  const rules = await loadEnabledPurchaseTemplateTriggers(input.admin, input.businessId);
  if (!rules.length) return null;
  if (input.membershipTypeId == null) {
    const catchAll = rules.filter((rule) => !rule.product_filter?.length);
    if (!catchAll.length) return null;
    catchAll.sort((a, b) => ruleUpdatedAtMs(b) - ruleUpdatedAtMs(a));
    return catchAll[0] ?? null;
  }
  return pickPurchaseTemplateTriggerRule(rules, input.membershipTypeId);
}
