import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";
import { marketingWaSessionId } from "@/lib/marketing-whatsapp";

export function extractCustomerPhoneFromIcountPayload(
  payload: Record<string, unknown>,
  sessionPhone?: unknown
): string | null {
  const keys = [
    "phone",
    "Phone",
    "mobile",
    "Mobile",
    "cell",
    "tel",
    "customer_phone",
    "customer_mobile",
    "client_phone",
    "client_mobile",
  ];
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (sessionPhone != null && String(sessionPhone).trim()) return String(sessionPhone).trim();
  return null;
}

/**
 * אם הלקוח היה בפלואו השיווקי — רושם purchase עם source wa_marketing (אחרי תשלום מוצלח).
 */
export async function tryRecordWaMarketingPurchase(input: {
  customerPhone: unknown;
  businessId: number;
  planPrice: number;
}): Promise<void> {
  try {
    const normalized = normalizePhone(input.customerPhone);
    if (!normalized) return;

    const admin = createSupabaseAdminClient();
    const { data: waLead } = await admin
      .from("marketing_flow_sessions")
      .select("id, created_at")
      .eq("phone", normalized)
      .maybeSingle();

    if (!waLead?.id) return;

    const businessId = Number(input.businessId);
    const planPrice = Number(input.planPrice);
    if (!Number.isFinite(businessId) || businessId <= 0) return;
    if (!Number.isFinite(planPrice) || planPrice <= 0) return;

    const metadata = {
      marketing_session_id: waLead.id,
      business_id: businessId,
    };

    const row: Record<string, unknown> = {
      event_type: "purchase",
      source: "wa_marketing",
      session_id: marketingWaSessionId(normalized),
      value: planPrice,
      label: `biz_${businessId}`,
      metadata,
    };

    let { error } = await admin.from("analytics_events").insert(row);
    if (error && /metadata|column/i.test(String(error.message ?? ""))) {
      const { metadata: _meta, ...withoutMeta } = row;
      ({ error } = await admin.from("analytics_events").insert(withoutMeta));
    }

    if (error) {
      console.error("[wa-marketing-purchase] analytics insert failed:", error.message);
      return;
    }

    console.info("[wa-marketing-purchase] recorded:", {
      phone: normalized,
      marketing_session_id: waLead.id,
      business_id: businessId,
    });
  } catch (e) {
    console.error("[wa-marketing-purchase] failed:", e);
  }
}
