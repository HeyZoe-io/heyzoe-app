import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** נשלחה הודעת CTA בפלואו שיווקי (role=assistant, לא מוצג למשתמש בצ'אט) */
export const HEYZOE_MARKETING_CTA_SENT = "[heyzoe:marketing_cta_sent]";

/** sessionStorage / localStorage key — לידים שלחצו וואטסאפ מדף הנחיתה */
export const HZ_WA_LP_ATTRIBUTION_KEY = "hz_wa_lp_attribution";
export const HZ_WA_LP_ATTRIBUTION_MS = 7 * 24 * 60 * 60 * 1000;

export const LP_ANALYTICS_EVENT_TYPES = [
  "pageview",
  "cta_click",
  "chat_open",
  "checkout_start",
  "purchase",
  "lp_10s",
  "lp_30s",
  "lp_60s",
  "lp_scroll_50",
  "lp_scroll_75",
  "lp_pricing_view",
  "wa_lp_click",
  "wa_new_lead",
] as const;

export type LpAnalyticsEventType = (typeof LP_ANALYTICS_EVENT_TYPES)[number];

export const LP_ANALYTICS_EVENT_TYPE_SET = new Set<string>(LP_ANALYTICS_EVENT_TYPES);

export function isWaLpAttributionSource(source: string | null | undefined): boolean {
  const s = String(source ?? "").trim().toLowerCase();
  return s === "wa_lp";
}

export function isWaMarketingAttributionSource(source: string | null | undefined): boolean {
  return String(source ?? "").trim().toLowerCase() === "wa_marketing";
}

export function isWaAttributedPurchaseSource(source: string | null | undefined): boolean {
  return isWaLpAttributionSource(source) || isWaMarketingAttributionSource(source);
}

export async function insertLpAnalyticsEvent(input: {
  event_type: LpAnalyticsEventType;
  session_id: string;
  source?: string | null;
  label?: string | null;
  value?: number | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const event_type = input.event_type;
    const session_id = String(input.session_id ?? "").trim().slice(0, 180);
    if (!session_id || !LP_ANALYTICS_EVENT_TYPE_SET.has(event_type)) return;

    const value =
      event_type === "purchase" && typeof input.value === "number" && Number.isFinite(input.value) && input.value > 0
        ? input.value
        : null;

    const row: Record<string, unknown> = {
      event_type,
      session_id,
      source: input.source?.trim().slice(0, 120) ?? null,
      label: input.label?.trim().slice(0, 80) ?? null,
      value,
    };
    if (input.metadata && typeof input.metadata === "object") {
      row.metadata = input.metadata;
    }

    let { error } = await admin.from("analytics_events").insert(row);
    if (error && row.metadata && /metadata|column/i.test(String(error.message ?? ""))) {
      const { metadata: _m, ...rest } = row;
      ({ error } = await admin.from("analytics_events").insert(rest));
    }
    if (error) throw error;
  } catch (e) {
    console.error("[lp-analytics] insert failed:", e);
  }
}
