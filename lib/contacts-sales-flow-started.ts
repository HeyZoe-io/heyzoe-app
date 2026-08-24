import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";

/** First time this contact opened a sales flow — unique lead for owner analytics. */
export function contactIsAnalyticsNewLead(
  salesFlowStartedAt: string | null | undefined,
  rangeStartIso: string | null
): boolean {
  const at = String(salesFlowStartedAt ?? "").trim();
  if (!at) return false;
  if (!rangeStartIso) return true;
  return at >= rangeStartIso;
}

async function resolveBusinessId(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId?: string | number | null;
  businessSlug?: string | null;
}): Promise<string | number | null> {
  if (input.businessId != null && String(input.businessId).trim()) {
    return input.businessId;
  }
  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  if (!slug) return null;
  const { data, error } = await input.admin.from("businesses").select("id").eq("slug", slug).maybeSingle();
  if (error) {
    console.warn("[sales-flow-started] business slug lookup failed:", error.message);
    return null;
  }
  const id = (data as { id?: unknown } | null)?.id;
  return id != null && String(id).trim() ? (id as string | number) : null;
}

/**
 * Stamp sales_flow_started_at once (first sales-flow open). Indexed single-row UPDATE.
 * Missing column: log and continue — do not fail the webhook.
 */
export async function markContactSalesFlowStarted(input: {
  supabase?: ReturnType<typeof createSupabaseAdminClient>;
  businessId?: string | number | null;
  businessSlug?: string | null;
  phone: string;
}): Promise<void> {
  const phone = String(input.phone ?? "").trim();
  if (!phone) return;

  try {
    const admin = input.supabase ?? createSupabaseAdminClient();
    const businessId = await resolveBusinessId({
      admin,
      businessId: input.businessId,
      businessSlug: input.businessSlug,
    });
    if (businessId == null) return;

    const variants = contactPhoneLookupVariants(phone);
    const nowIso = new Date().toISOString();
    const { error } = await admin
      .from("contacts")
      .update({ sales_flow_started_at: nowIso })
      .eq("business_id", businessId)
      .in("phone", variants.length ? variants : [phone])
      .is("sales_flow_started_at", null);

    if (error) {
      if (/sales_flow_started_at|column/i.test(error.message)) {
        console.warn(
          "[sales-flow-started] column missing — run supabase/contacts_sales_flow_started_at.sql:",
          error.message
        );
        return;
      }
      console.warn("[sales-flow-started] update failed:", error.message);
    }
  } catch (e) {
    console.warn("[sales-flow-started] mark threw:", e);
  }
}
