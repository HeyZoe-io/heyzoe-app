/**
 * Owner quota alerts stay on the original template until the UTILITY copy
 * is APPROVED. The status webhook updates marketing_whatsapp_templates;
 * send time reads that row. One lookup by name + language.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWabaTemplate } from "@/lib/meta-templates";

export const QUOTA_UTIL_TEMPLATE_NAMES = {
  quota_warning_80: "quota_warning_80_util",
  quota_limit_reached: "quota_limit_reached_util",
} as const;

export type QuotaAlertBaseName = keyof typeof QUOTA_UTIL_TEMPLATE_NAMES;

export function isQuotaUtilTemplateName(name: string): boolean {
  return name === "quota_warning_80_util" || name === "quota_limit_reached_util";
}

export type ResolvedQuotaTemplateName =
  | QuotaAlertBaseName
  | (typeof QUOTA_UTIL_TEMPLATE_NAMES)[QuotaAlertBaseName];

export function approvedUtilityQuotaTemplateName(
  base: QuotaAlertBaseName,
  row: { status?: unknown; category?: unknown } | null
): ResolvedQuotaTemplateName {
  const status = String(row?.status ?? "").trim().toUpperCase();
  const category = String(row?.category ?? "").trim().toUpperCase();
  if (status === "APPROVED" && category === "UTILITY") return QUOTA_UTIL_TEMPLATE_NAMES[base];
  return base;
}

export async function resolveStarterQuotaWaTemplate(
  admin: SupabaseClient,
  base: QuotaAlertBaseName
): Promise<ResolvedQuotaTemplateName> {
  const utilName = QUOTA_UTIL_TEMPLATE_NAMES[base];
  const { data, error } = await admin
    .from("marketing_whatsapp_templates")
    .select("status, category")
    .eq("name", utilName)
    .eq("language", "he")
    .maybeSingle();
  if (error) {
    console.error("[quota-alert] template lookup failed:", utilName, error.message);
    return base;
  }
  const chosen = approvedUtilityQuotaTemplateName(base, data);
  if (chosen === base && data) {
    const status = String(data.status ?? "").toUpperCase();
    const category = String(data.category ?? "").toUpperCase();
    if (status === "REJECTED" || (status === "APPROVED" && category && category !== "UTILITY")) {
      console.warn("[quota-alert] keeping original template", { base, status, category });
    }
  }
  return chosen;
}

/** One Graph read when Meta reports a status for these two names. Not a poller. */
export async function recordQuotaUtilTemplateReview(
  admin: SupabaseClient,
  input: { templateId: string; name: string; event: string; reason: string }
): Promise<void> {
  if (!isQuotaUtilTemplateName(input.name)) return;
  const event = input.event.trim().toUpperCase();
  if (event !== "APPROVED" && event !== "REJECTED") return;

  const stored = await admin
    .from("marketing_whatsapp_templates")
    .select("components, category")
    .eq("name", input.name)
    .eq("language", "he")
    .maybeSingle();
  if (stored.error) {
    console.error("[quota-alert] review row lookup failed:", input.name, stored.error.message);
  }

  let category = String(stored.data?.category ?? "");
  let components: unknown = stored.data?.components ?? null;
  let reason = input.reason;

  if (input.templateId) {
    try {
      const live = await getWabaTemplate(input.templateId);
      if (live.category) category = live.category;
      if (live.components) components = live.components;
      if (live.rejected_reason && live.rejected_reason.toUpperCase() !== "NONE") {
        reason = live.rejected_reason;
      }
      if (live.category) {
        const { error } = await admin
          .from("marketing_whatsapp_templates")
          .update({ category: live.category.toUpperCase(), updated_at: new Date().toISOString() })
          .eq("name", input.name)
          .eq("language", "he");
        if (error) console.error("[quota-alert] category sync failed:", input.name, error.message);
      }
    } catch (e) {
      console.error("[quota-alert] template review lookup failed:", input.name, e);
    }
  }

  if (event === "APPROVED" && category.toUpperCase() === "UTILITY") {
    console.info("[quota-alert] util template ready", { name: input.name, category });
    return;
  }

  console.error("[quota-alert] util template not switched", {
    name: input.name,
    event,
    category: category || null,
    reason: reason || null,
    components,
  });
}
