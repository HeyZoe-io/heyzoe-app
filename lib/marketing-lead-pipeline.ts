import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";

export function toPipelineDateOnly(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type MarketingLeadPipelinePatch = {
  human_followup: boolean;
  next_call_at?: string | null;
};

export type MarketingLeadPipelineResult = {
  phone: string;
  human_followup_at: string | null;
  next_call_at: string | null;
};

async function findMarketingSessionPhone(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phoneRaw: string
): Promise<string | null> {
  const normalized = normalizePhone(phoneRaw);
  const candidates = [...new Set([normalized, String(phoneRaw ?? "").trim()].filter(Boolean))] as string[];
  for (const phone of candidates) {
    const { data, error } = await admin
      .from("marketing_flow_sessions")
      .select("phone")
      .eq("phone", phone)
      .maybeSingle();
    if (error) {
      console.error("[marketing-lead-pipeline] session lookup failed:", error.message);
      throw new Error("session_lookup_failed");
    }
    if (data?.phone) return String(data.phone);
  }
  return null;
}

export async function updateMarketingLeadPipeline(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phoneRaw: string,
  patch: MarketingLeadPipelinePatch
): Promise<MarketingLeadPipelineResult> {
  const phone = await findMarketingSessionPhone(admin, phoneRaw);
  if (!phone) throw new Error("lead_not_found");

  const { data: existing, error: existingErr } = await admin
    .from("marketing_flow_sessions")
    .select("phone, human_followup_at, next_call_at")
    .eq("phone", phone)
    .maybeSingle();
  if (existingErr) {
    if (/human_followup_at|next_call_at|column/i.test(String(existingErr.message ?? ""))) {
      console.error("[marketing-lead-pipeline] migration required:", existingErr.message);
      throw new Error("migration_required");
    }
    console.error("[marketing-lead-pipeline] session load failed:", existingErr.message);
    throw new Error("session_lookup_failed");
  }

  const nowIso = new Date().toISOString();
  const nextCallAt = patch.human_followup ? toPipelineDateOnly(patch.next_call_at) : null;
  const humanFollowupAt = patch.human_followup
    ? (existing?.human_followup_at as string | null) || nowIso
    : null;
  const update: Record<string, unknown> = {
    updated_at: nowIso,
    human_followup_at: humanFollowupAt,
    next_call_at: nextCallAt,
  };

  const { data, error } = await admin
    .from("marketing_flow_sessions")
    .update(update)
    .eq("phone", phone)
    .select("phone, human_followup_at, next_call_at")
    .single();

  if (error) {
    if (/human_followup_at|next_call_at|column/i.test(String(error.message ?? ""))) {
      console.error("[marketing-lead-pipeline] migration required:", error.message);
      throw new Error("migration_required");
    }
    console.error("[marketing-lead-pipeline] update failed:", error.message);
    throw new Error("update_failed");
  }

  return {
    phone: String(data.phone ?? phone),
    human_followup_at: (data.human_followup_at as string | null) ?? null,
    next_call_at: toPipelineDateOnly(data.next_call_at),
  };
}
