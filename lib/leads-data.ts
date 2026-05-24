import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
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
