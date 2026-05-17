import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  HEYZOE_MARKETING_CTA_SENT,
  isWaAttributedPurchaseSource,
  type LpAnalyticsEventType,
} from "@/lib/lp-analytics";
import {
  extractLeadPhoneFromMarketingSession,
  MARKETING_CONVERSATIONS_SLUG,
  marketingWaSessionId,
} from "@/lib/marketing-whatsapp";

const DROP_AFTER_CTA_HOURS = 24;

export type WhatsappAnalyticsSnapshot = {
  newLeads: number;
  pricingViews: number;
  waLpClicks: number;
  droppedNoCta: number;
  waAttributedCheckout: number;
  waAttributedPurchase: number;
  waAttributedRevenue: number;
  droppedPhonesSample: string[];
};

type EventRow = {
  event_type: string;
  value: number | null;
  source: string | null;
  session_id: string;
  created_at: string;
};

type MessageRow = {
  session_id: string | null;
  role: string;
  content: string;
  created_at: string;
};

function maskPhone(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

export async function loadWhatsappAnalyticsSnapshot(sinceIso: string): Promise<WhatsappAnalyticsSnapshot> {
  const admin = createSupabaseAdminClient();
  const sinceMs = new Date(sinceIso).getTime();

  const [{ data: eventsRaw }, { data: sessionsRaw }, { data: messagesRaw }] = await Promise.all([
    admin
      .from("analytics_events")
      .select("event_type, value, source, session_id, created_at")
      .gte("created_at", sinceIso)
      .in("event_type", ["lp_pricing_view", "wa_lp_click", "wa_new_lead", "checkout_start", "purchase"] as LpAnalyticsEventType[]),
    admin
      .from("marketing_flow_sessions")
      .select("phone, created_at, flow_completed, current_node_id")
      .gte("created_at", sinceIso),
    admin
      .from("messages")
      .select("session_id, role, content, created_at")
      .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(50_000),
  ]);

  const events = (eventsRaw ?? []) as EventRow[];
  let pricingViews = 0;
  let waLpClicks = 0;
  let newLeadsFromEvents = 0;
  let waAttributedCheckout = 0;
  let waAttributedPurchase = 0;
  let waAttributedRevenue = 0;

  for (const e of events) {
    const t = String(e.event_type ?? "").trim();
    if (t === "lp_pricing_view") pricingViews += 1;
    if (t === "wa_lp_click") waLpClicks += 1;
    if (t === "wa_new_lead") newLeadsFromEvents += 1;
    if (t === "checkout_start" && isWaAttributedPurchaseSource(e.source)) waAttributedCheckout += 1;
    if (t === "purchase" && isWaAttributedPurchaseSource(e.source)) {
      waAttributedPurchase += 1;
      const v = typeof e.value === "number" ? e.value : Number(e.value);
      if (Number.isFinite(v) && v > 0) waAttributedRevenue += v;
    }
  }

  const newLeadsFromSessions = (sessionsRaw ?? []).length;
  const newLeads = Math.max(newLeadsFromSessions, newLeadsFromEvents);

  const messages = (messagesRaw ?? []) as MessageRow[];
  const bySession = new Map<string, MessageRow[]>();
  for (const m of messages) {
    const sid = String(m.session_id ?? "").trim();
    if (!sid) continue;
    const list = bySession.get(sid) ?? [];
    list.push(m);
    bySession.set(sid, list);
  }

  const dropCutoffMs = DROP_AFTER_CTA_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  const droppedPhones: string[] = [];

  for (const [sessionId, rows] of bySession.entries()) {
    let lastCtaAt: number | null = null;
    let userAfterCta = false;

    for (const row of rows) {
      const atMs = new Date(row.created_at).getTime();
      if (!Number.isFinite(atMs) || atMs < sinceMs) continue;

      const content = String(row.content ?? "").trim();
      if (row.role === "assistant" && content.startsWith(HEYZOE_MARKETING_CTA_SENT)) {
        lastCtaAt = atMs;
        userAfterCta = false;
        continue;
      }
      if (row.role === "user" && lastCtaAt != null && atMs > lastCtaAt) {
        userAfterCta = true;
      }
    }

    if (lastCtaAt == null || userAfterCta) continue;
    if (now - lastCtaAt < dropCutoffMs) continue;

    const phone = extractLeadPhoneFromMarketingSession(sessionId);
    if (phone) droppedPhones.push(maskPhone(phone));
  }

  return {
    newLeads,
    pricingViews,
    waLpClicks,
    droppedNoCta: droppedPhones.length,
    waAttributedCheckout,
    waAttributedPurchase,
    waAttributedRevenue,
    droppedPhonesSample: droppedPhones.slice(0, 12),
  };
}

export async function trackWaNewLead(phoneRaw: string): Promise<void> {
  const { normalizePhone } = await import("@/lib/phone-normalize");
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  const { insertLpAnalyticsEvent } = await import("@/lib/lp-analytics");
  await insertLpAnalyticsEvent({
    event_type: "wa_new_lead",
    session_id: marketingWaSessionId(phone),
    source: "marketing_wa",
    label: maskPhone(phone),
  });
}
