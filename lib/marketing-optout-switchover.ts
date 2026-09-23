/**
 * When a `<name>_vN` opt-out copy is APPROVED, point live references at it.
 * REJECTED or a non-MARKETING category leaves the original name in place.
 * Sequential updates (no new SQL function). Re-running is safe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { templateHasOptOutButton, originalTemplateName } from "@/lib/marketing-optout-resubmit-plan";

export type OptOutSwitchResult = "switched" | "kept_original" | "skipped";

async function retarget(
  admin: SupabaseClient,
  fromName: string,
  toName: string,
  businessId: number | null,
  marketingLine: boolean
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (businessId != null) {
    const triggers = await admin
      .from("template_triggers")
      .update({ template_name: toName, updated_at: nowIso })
      .eq("business_id", businessId)
      .eq("template_name", fromName)
      .eq("enabled", true);
    if (triggers.error) throw new Error(triggers.error.message);

    const scheduled = await admin
      .from("scheduled_template_sends")
      .update({ template_name: toName, updated_at: nowIso })
      .eq("business_id", businessId)
      .eq("template_name", fromName)
      .eq("status", "pending");
    if (scheduled.error) throw new Error(scheduled.error.message);

    const lead = await admin
      .from("businesses")
      .update({ lead_template_name: toName })
      .eq("id", businessId)
      .eq("lead_template_name", fromName);
    if (lead.error) throw new Error(lead.error.message);
  }

  if (marketingLine) {
    const triggers = await admin
      .from("marketing_template_triggers")
      .update({ template_name: toName, updated_at: nowIso })
      .eq("template_name", fromName)
      .eq("enabled", true);
    if (triggers.error) throw new Error(triggers.error.message);

    const scheduled = await admin
      .from("scheduled_marketing_template_sends")
      .update({ template_name: toName, updated_at: nowIso })
      .eq("template_name", fromName)
      .eq("status", "pending");
    if (scheduled.error) throw new Error(scheduled.error.message);
  }
}

export async function applyOptOutVersionSwitchover(
  admin: SupabaseClient,
  input: {
    name: string;
    status: string;
    category?: string | null;
    components?: unknown[] | null;
    businessId: number | null;
    marketingLine: boolean;
  }
): Promise<OptOutSwitchResult> {
  const original = originalTemplateName(input.name);
  if (!original) return "skipped";

  const status = input.status.trim().toUpperCase();
  const category = String(input.category ?? "").trim().toUpperCase();
  const rejected = status === "REJECTED";
  const wrongCategory = Boolean(category) && category !== "MARKETING";

  if (rejected || wrongCategory) {
    await retarget(admin, input.name, original, input.businessId, input.marketingLine);
    console.info("[marketing-optout-switchover] kept original", {
      version: input.name,
      original,
      status,
      category: category || null,
    });
    return "kept_original";
  }

  if (status !== "APPROVED") return "skipped";
  if (!templateHasOptOutButton({ name: input.name, language: "", status, category, components: input.components ?? undefined })) {
    console.info("[marketing-optout-switchover] skip — version has no opt-out button", {
      version: input.name,
    });
    return "skipped";
  }

  await retarget(admin, original, input.name, input.businessId, input.marketingLine);
  console.info("[marketing-optout-switchover] switched", {
    version: input.name,
    original,
    business_id: input.businessId,
    marketing_line: input.marketingLine,
  });
  return "switched";
}

export async function syncTemplateCategoryFromMeta(
  admin: SupabaseClient,
  input: {
    messageTemplateId?: string | null;
    name?: string | null;
    language?: string | null;
    category: string;
  }
): Promise<number> {
  const category = input.category.trim().toUpperCase();
  if (!category) return 0;
  const nowIso = new Date().toISOString();
  let updated = 0;

  const id = String(input.messageTemplateId ?? "").trim();
  if (id) {
    const business = await admin
      .from("whatsapp_templates")
      .update({ category, updated_at: nowIso })
      .eq("waba_template_id", id)
      .select("id");
    if (business.error) throw new Error(business.error.message);
    updated += business.data?.length ?? 0;

    const marketing = await admin
      .from("marketing_whatsapp_templates")
      .update({ category, updated_at: nowIso })
      .eq("waba_template_id", id)
      .select("id");
    if (marketing.error && !/does not exist|schema cache/i.test(marketing.error.message)) {
      throw new Error(marketing.error.message);
    }
    updated += marketing.data?.length ?? 0;
  }

  const name = String(input.name ?? "").trim();
  const language = String(input.language ?? "").trim();
  if (updated === 0 && name && language) {
    const business = await admin
      .from("whatsapp_templates")
      .update({ category, updated_at: nowIso })
      .eq("name", name)
      .eq("language", language)
      .select("id");
    if (business.error) throw new Error(business.error.message);
    updated += business.data?.length ?? 0;

    const marketing = await admin
      .from("marketing_whatsapp_templates")
      .update({ category, updated_at: nowIso })
      .eq("name", name)
      .eq("language", language)
      .select("id");
    if (marketing.error && !/does not exist|schema cache/i.test(marketing.error.message)) {
      throw new Error(marketing.error.message);
    }
    updated += marketing.data?.length ?? 0;
  }

  return updated;
}

export type TemplateCategoryUpdateEvent = {
  waba_id: string;
  message_template_id: string;
  message_template_name: string;
  message_template_language: string;
  new_category: string;
  previous_category: string;
};

/** Meta field `template_category_update`. No-op until that field is subscribed. */
export function parseTemplateCategoryUpdate(payload: unknown): TemplateCategoryUpdateEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account") return null;
  const entries = Array.isArray(root.entry) ? root.entry : [];
  for (const entry of entries) {
    const ent = entry as Record<string, unknown>;
    const waba_id = String(ent.id ?? "").trim().replace(/\s+/g, "");
    const changes = Array.isArray(ent.changes) ? ent.changes : [];
    for (const change of changes) {
      const ch = change as Record<string, unknown>;
      if (String(ch.field ?? "").trim() !== "template_category_update") continue;
      const value = ch.value;
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const new_category = String(v.new_category ?? "").trim();
      if (!new_category) continue;
      return {
        waba_id,
        message_template_id: String(v.message_template_id ?? "").trim(),
        message_template_name: String(v.message_template_name ?? "").trim(),
        message_template_language: String(v.message_template_language ?? "").trim(),
        new_category,
        previous_category: String(v.previous_category ?? "").trim(),
      };
    }
  }
  return null;
}
