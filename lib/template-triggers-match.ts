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

/** Enabled credit_refusal rules (no product_filter matching — pick newest). */
export async function loadEnabledCreditRefusalTemplateTriggers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule[]> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "credit_refusal")
    .eq("enabled", true);

  if (error) {
    console.error("[template-triggers-match] load credit_refusal rules failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => normalizeRule(row as Record<string, unknown>));
}

export function pickCreditRefusalTemplateTriggerRule(
  rules: PurchaseTemplateTriggerRule[]
): PurchaseTemplateTriggerRule | null {
  const withName = rules.filter((rule) => Boolean(rule.template_name?.trim()));
  if (!withName.length) return null;
  withName.sort((a, b) => ruleUpdatedAtMs(b) - ruleUpdatedAtMs(a));
  return withName[0] ?? null;
}

export async function resolveCreditRefusalTemplateTrigger(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<PurchaseTemplateTriggerRule | null> {
  const rules = await loadEnabledCreditRefusalTemplateTriggers(input.admin, input.businessId);
  return pickCreditRefusalTemplateTriggerRule(rules);
}

/** Enabled birthday rules — pick newest with a template name. */
export async function loadEnabledBirthdayTemplateTriggers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule[]> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "birthday")
    .eq("enabled", true);

  if (error) {
    console.error("[template-triggers-match] load birthday rules failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => normalizeRule(row as Record<string, unknown>));
}

export function pickBirthdayTemplateTriggerRule(
  rules: PurchaseTemplateTriggerRule[]
): PurchaseTemplateTriggerRule | null {
  return pickCreditRefusalTemplateTriggerRule(rules);
}

export async function resolveBirthdayTemplateTrigger(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<PurchaseTemplateTriggerRule | null> {
  const rules = await loadEnabledBirthdayTemplateTriggers(input.admin, input.businessId);
  return pickBirthdayTemplateTriggerRule(rules);
}

/** Enabled membership_expiring rules — pick newest with a template name. */
export async function loadEnabledMembershipExpiringTemplateTriggers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule[]> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "membership_expiring")
    .eq("enabled", true);

  if (error) {
    console.error(
      "[template-triggers-match] load membership_expiring rules failed:",
      error.message
    );
    return [];
  }

  return (data ?? []).map((row) => normalizeRule(row as Record<string, unknown>));
}

export function pickMembershipExpiringTemplateTriggerRule(
  rules: PurchaseTemplateTriggerRule[]
): PurchaseTemplateTriggerRule | null {
  return pickCreditRefusalTemplateTriggerRule(rules);
}

export async function resolveMembershipExpiringTemplateTrigger(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<PurchaseTemplateTriggerRule | null> {
  const rules = await loadEnabledMembershipExpiringTemplateTriggers(input.admin, input.businessId);
  return pickMembershipExpiringTemplateTriggerRule(rules);
}

/** Enabled sessions_expiring rules — pick newest with a template name. */
export async function loadEnabledSessionsExpiringTemplateTriggers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule[]> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "sessions_expiring")
    .eq("enabled", true);

  if (error) {
    console.error(
      "[template-triggers-match] load sessions_expiring rules failed:",
      error.message
    );
    return [];
  }

  return (data ?? []).map((row) => normalizeRule(row as Record<string, unknown>));
}

export function pickSessionsExpiringTemplateTriggerRule(
  rules: PurchaseTemplateTriggerRule[]
): PurchaseTemplateTriggerRule | null {
  return pickCreditRefusalTemplateTriggerRule(rules);
}

export async function resolveSessionsExpiringTemplateTrigger(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<PurchaseTemplateTriggerRule | null> {
  const rules = await loadEnabledSessionsExpiringTemplateTriggers(input.admin, input.businessId);
  return pickSessionsExpiringTemplateTriggerRule(rules);
}

/** Enabled trial_attended rules — pick newest with a template name.
 * product_filter (if set) scopes which trial membership types count; matching is by
 * membership_type_name via /v3/membershipTypes (bookingsReport has no membership_type_id).
 */
export async function loadEnabledTrialAttendedTemplateTriggers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule[]> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "trial_attended")
    .eq("enabled", true);

  if (error) {
    console.error("[template-triggers-match] load trial_attended rules failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => normalizeRule(row as Record<string, unknown>));
}

export function pickTrialAttendedTemplateTriggerRule(
  rules: PurchaseTemplateTriggerRule[]
): PurchaseTemplateTriggerRule | null {
  return pickCreditRefusalTemplateTriggerRule(rules);
}

export async function resolveTrialAttendedTemplateTrigger(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<PurchaseTemplateTriggerRule | null> {
  const rules = await loadEnabledTrialAttendedTemplateTriggers(input.admin, input.businessId);
  return pickTrialAttendedTemplateTriggerRule(rules);
}

/** Enabled site_lead rules — pick newest with a template name (non-Arbox). */
export async function loadEnabledSiteLeadTemplateTriggers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule[]> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "site_lead")
    .eq("enabled", true);

  if (error) {
    console.error("[template-triggers-match] load site_lead rules failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => normalizeRule(row as Record<string, unknown>));
}

export function pickSiteLeadTemplateTriggerRule(
  rules: PurchaseTemplateTriggerRule[]
): PurchaseTemplateTriggerRule | null {
  return pickCreditRefusalTemplateTriggerRule(rules);
}

export async function resolveSiteLeadTemplateTrigger(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<PurchaseTemplateTriggerRule | null> {
  const rules = await loadEnabledSiteLeadTemplateTriggers(input.admin, input.businessId);
  return pickSiteLeadTemplateTriggerRule(rules);
}

/** Enabled no_response rules — pick newest with a template name (non-Arbox). */
export async function loadEnabledNoResponseTemplateTriggers(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule[]> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "no_response")
    .eq("enabled", true);

  if (error) {
    console.error("[template-triggers-match] load no_response rules failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => normalizeRule(row as Record<string, unknown>));
}

export function pickNoResponseTemplateTriggerRule(
  rules: PurchaseTemplateTriggerRule[]
): PurchaseTemplateTriggerRule | null {
  return pickCreditRefusalTemplateTriggerRule(rules);
}

export async function resolveNoResponseTemplateTrigger(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<PurchaseTemplateTriggerRule | null> {
  const rules = await loadEnabledNoResponseTemplateTriggers(input.admin, input.businessId);
  return pickNoResponseTemplateTriggerRule(rules);
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

/**
 * Which salesReport membership_type_ids the cron should process for a business.
 * Union of trial IDs + enabled purchase rules' product_filter; empty product_filter = catch-all (all sales).
 */
export type PurchaseSaleMembershipScope =
  | { mode: "all" }
  | { mode: "ids"; membershipTypeIds: number[] };

export function resolvePurchaseSaleMembershipScope(input: {
  trialMembershipTypeIds: number[];
  purchaseRules: Array<{ product_filter: number[] | null }>;
}): PurchaseSaleMembershipScope {
  const hasCatchAll = input.purchaseRules.some((rule) => !(rule.product_filter?.length ?? 0));
  if (hasCatchAll) return { mode: "all" };

  const ids = new Set<number>();
  for (const id of input.trialMembershipTypeIds) {
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  for (const rule of input.purchaseRules) {
    for (const id of rule.product_filter ?? []) {
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
  }
  return { mode: "ids", membershipTypeIds: [...ids].sort((a, b) => a - b) };
}

export function saleMembershipTypeInScope(
  membershipTypeId: number | null,
  scope: PurchaseSaleMembershipScope
): boolean {
  if (membershipTypeId == null) return false;
  if (scope.mode === "all") return true;
  return scope.membershipTypeIds.includes(membershipTypeId);
}

export function purchaseSaleMembershipScopeIsEmpty(scope: PurchaseSaleMembershipScope): boolean {
  return scope.mode === "ids" && scope.membershipTypeIds.length === 0;
}
