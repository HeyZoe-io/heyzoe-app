import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { matchesMarketingRegisteredClick } from "@/lib/admin-marketing-analytics";
import {
  extractLeadPhoneFromMarketingSession,
  MARKETING_CONVERSATIONS_SLUG,
} from "@/lib/marketing-whatsapp";
import { normalizePhone } from "@/lib/phone-normalize";
import type { LeadRow } from "@/lib/leads-types";

function phoneKey(phone: string): string {
  const p = String(phone ?? "").trim();
  return p ? normalizePhone(p) ?? p.replace(/\D/g, "") : "";
}

function mapWaStage(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function loadLeadsForBusiness(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<LeadRow[]> {
  const { data: contacts } = await admin
    .from("contacts")
    .select(
      "phone, full_name, source, created_at, opted_out, session_phase, trial_registered, wa_followup_stage, last_contact_at"
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  const { data: conversations } = await admin
    .from("conversations")
    .select("phone, cta_clicked_at")
    .eq("business_id", businessId);

  const ctaByPhone = new Map<string, string | null>();
  for (const row of conversations ?? []) {
    const raw = row as { phone?: string; cta_clicked_at?: string | null };
    const key = phoneKey(String(raw.phone ?? ""));
    if (!key) continue;
    ctaByPhone.set(key, raw.cta_clicked_at ?? null);
  }

  return (contacts ?? []).map((c) => {
    const row = c as Record<string, unknown>;
    const phone = String(row.phone ?? "").trim();
    const key = phoneKey(phone);
    return {
      phone: row.phone as string | null,
      full_name: row.full_name as string | null,
      source: row.source as string | null,
      created_at: row.created_at as string | null,
      opted_out: row.opted_out as boolean | null,
      session_phase: row.session_phase as string | null,
      trial_registered: row.trial_registered as boolean | null,
      wa_followup_stage: mapWaStage(row.wa_followup_stage),
      last_contact_at: row.last_contact_at as string | null,
      cta_clicked_at: key ? (ctaByPhone.get(key) ?? null) : null,
    };
  });
}

const ADMIN_LEADS_LIMIT = 10_000;

function deriveMarketingWaFollowupStage(row: {
  followup_1_sent_at?: string | null;
  followup_2_sent_at?: string | null;
  followup_3_sent_at?: string | null;
}): number {
  if (row.followup_3_sent_at) return 3;
  if (row.followup_2_sent_at) return 2;
  if (row.followup_1_sent_at) return 1;
  return 0;
}

function deriveMarketingSessionPhase(
  row: { flow_completed?: boolean | null; current_node_id?: string | null },
  registered: boolean
): string | null {
  if (registered) return "registered";
  if (row.flow_completed) return "cta";
  if (row.current_node_id) return "opening";
  return null;
}

async function loadMarketingRegisteredPhoneKeys(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<Set<string>> {
  const { data: messages, error } = await admin
    .from("messages")
    .select("session_id, content")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(50_000);

  if (error) {
    console.warn("[leads-data] marketing registered messages:", error.message);
    return new Set();
  }

  const keys = new Set<string>();
  for (const row of messages ?? []) {
    const raw = row as { session_id?: string; content?: string };
    if (!matchesMarketingRegisteredClick(String(raw.content ?? ""))) continue;
    const phone = extractLeadPhoneFromMarketingSession(String(raw.session_id ?? ""));
    const key = phoneKey(phone);
    if (key) keys.add(key);
  }
  return keys;
}

/** לידים מקו זואי אדמין (שיווק) — לא מטבלת contacts של עסקים */
export async function loadMarketingAdminLeads(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<LeadRow[]> {
  const [{ data: sessions, error }, registeredKeys] = await Promise.all([
    admin
      .from("marketing_flow_sessions")
      .select(
        `
        phone, full_name, created_at, updated_at, last_user_message_at,
        flow_completed, current_node_id,
        followup_opted_out, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at
      `
      )
      .order("created_at", { ascending: false })
      .limit(ADMIN_LEADS_LIMIT),
    loadMarketingRegisteredPhoneKeys(admin),
  ]);

  if (error) {
    console.warn("[leads-data] marketing_flow_sessions load:", error.message);
    return [];
  }

  return (sessions ?? []).map((row) => {
    const s = row as Record<string, unknown>;
    const phone = String(s.phone ?? "").trim();
    const key = phoneKey(phone);
    const registered = key ? registeredKeys.has(key) : false;
    const waStage = deriveMarketingWaFollowupStage({
      followup_1_sent_at: s.followup_1_sent_at as string | null,
      followup_2_sent_at: s.followup_2_sent_at as string | null,
      followup_3_sent_at: s.followup_3_sent_at as string | null,
    });
    const lastContact =
      (s.last_user_message_at as string | null) ??
      (s.updated_at as string | null) ??
      (s.created_at as string | null);

    return {
      phone: phone || null,
      full_name: (s.full_name as string | null) ?? null,
      source: "זואי אדמין",
      created_at: s.created_at as string | null,
      opted_out: false,
      session_phase: deriveMarketingSessionPhase(
        {
          flow_completed: s.flow_completed as boolean | null,
          current_node_id: s.current_node_id as string | null,
        },
        registered
      ),
      trial_registered: registered,
      wa_followup_stage: waStage,
      last_contact_at: lastContact,
      cta_clicked_at: null,
      business_slug: MARKETING_CONVERSATIONS_SLUG,
      business_name: "זואי אדמין",
    };
  });
}

export async function loadLeadsForAdmin(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<LeadRow[]> {
  const { data: contacts, error } = await admin
    .from("contacts")
    .select(
      `
      phone, full_name, source, created_at, opted_out,
      session_phase, trial_registered, wa_followup_stage, last_contact_at,
      business_id,
      businesses ( slug, name )
    `
    )
    .order("created_at", { ascending: false })
    .limit(ADMIN_LEADS_LIMIT);

  if (error) {
    console.warn("[leads-data] admin contacts load:", error.message);
    return [];
  }

  const { data: conversations } = await admin.from("conversations").select("business_id, phone, cta_clicked_at");

  const ctaMap = new Map<string, string | null>();
  for (const row of conversations ?? []) {
    const raw = row as { business_id?: number; phone?: string; cta_clicked_at?: string | null };
    const bid = raw.business_id;
    const key = phoneKey(String(raw.phone ?? ""));
    if (bid == null || !key) continue;
    ctaMap.set(`${bid}:${key}`, raw.cta_clicked_at ?? null);
  }

  return (contacts ?? []).map((row) => {
    const c = row as Record<string, unknown> & {
      business_id?: number;
      businesses?: { slug?: string; name?: string | null } | { slug?: string; name?: string | null }[] | null;
    };
    const bizRaw = c.businesses;
    const biz = Array.isArray(bizRaw) ? bizRaw[0] : bizRaw;
    const businessId = c.business_id;
    const phone = String(c.phone ?? "").trim();
    const key = phoneKey(phone);
    return {
      phone: c.phone as string | null,
      full_name: c.full_name as string | null,
      source: c.source as string | null,
      created_at: c.created_at as string | null,
      opted_out: c.opted_out as boolean | null,
      session_phase: c.session_phase as string | null,
      trial_registered: c.trial_registered as boolean | null,
      wa_followup_stage: mapWaStage(c.wa_followup_stage),
      last_contact_at: c.last_contact_at as string | null,
      business_slug: biz?.slug ?? null,
      business_name: biz?.name ?? null,
      cta_clicked_at:
        businessId != null && key ? (ctaMap.get(`${businessId}:${key}`) ?? null) : null,
    };
  });
}
