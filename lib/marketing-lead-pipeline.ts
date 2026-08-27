import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { syncContactToMetaAudience } from "@/lib/ads/meta-audiences";
import type { LeadRow } from "@/lib/leads-types";
import { coerceMarketingNoteStatus } from "@/lib/marketing-conversation-notes";
import { markMarketingFollowupOptedOut } from "@/lib/marketing-followups";
import {
  applyManualPipelineStatus,
  isMarketingPipelineDropStatus,
  pipelineStatusStopsFollowups,
  pipelineStatusToNoteStatus,
  type MarketingPipelineDropStatus,
} from "@/lib/marketing-pipeline-status";
import { canonicalMarketingSessionId } from "@/lib/marketing-whatsapp";
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
  human_followup?: boolean;
  status?: MarketingPipelineDropStatus;
  next_call_at?: string | null;
};

export type MarketingLeadPipelineResult = {
  phone: string;
  human_followup_at: string | null;
  next_call_at: string | null;
  pipeline_status: MarketingPipelineDropStatus | null;
  lead_patch: Partial<LeadRow>;
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

function isMissingColumnError(message: string, columns: string): boolean {
  return new RegExp(`${columns}|column`, "i").test(message);
}

async function syncNoteStatusForPipeline(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phone: string,
  status: MarketingPipelineDropStatus
): Promise<void> {
  const noteStatus = pipelineStatusToNoteStatus(status);
  if (!noteStatus) return;

  const { data: existing, error: existingErr } = await admin
    .from("marketing_conversation_notes")
    .select("phone, session_id, business_name, link, notes, status, conversation_at")
    .eq("phone", phone)
    .maybeSingle();
  if (existingErr) {
    console.error("[marketing-lead-pipeline] notes lookup failed:", existingErr.message);
    return;
  }

  const prevStatus = existing ? coerceMarketingNoteStatus(existing.status) : null;
  const sessionId = String(existing?.session_id ?? "").trim() || canonicalMarketingSessionId(phone);
  const payload = {
    phone,
    session_id: sessionId,
    business_name: String(existing?.business_name ?? ""),
    link: String(existing?.link ?? ""),
    notes: String(existing?.notes ?? ""),
    status: noteStatus,
    conversation_at: existing?.conversation_at ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("marketing_conversation_notes").upsert(payload, { onConflict: "phone" });
  if (error) {
    console.error("[marketing-lead-pipeline] notes status sync failed:", error.message);
    return;
  }

  if (prevStatus !== noteStatus) {
    void syncContactToMetaAudience({ phone, status: noteStatus }).catch((e) => {
      console.error("[marketing-lead-pipeline] meta audience sync failed:", e);
    });
  }
}

function leadPatchFromResult(
  status: MarketingPipelineDropStatus | null,
  humanFollowupAt: string | null,
  nextCallAt: string | null,
  atIso: string
): Partial<LeadRow> {
  const seed: LeadRow = {
    phone: null,
    full_name: null,
    source: null,
    created_at: null,
    opted_out: false,
    not_relevant_at: null,
    not_relevant_reason: null,
    human_requested_at: null,
    human_followup_at: humanFollowupAt,
    next_call_at: nextCallAt,
    session_phase: null,
    trial_registered: false,
    wa_no_response_at: null,
    no_response_notified_at: null,
    wa_followup_stage: null,
    last_contact_at: null,
    cta_clicked_at: null,
    pipeline_status: status,
  };
  if (!status) {
    return {
      human_followup_at: humanFollowupAt,
      next_call_at: nextCallAt,
      pipeline_status: null,
    };
  }
  const applied = applyManualPipelineStatus(seed, status, atIso);
  return {
    opted_out: applied.opted_out,
    not_relevant_at: applied.not_relevant_at,
    human_requested_at: applied.human_requested_at,
    human_followup_at: applied.human_followup_at,
    next_call_at: applied.next_call_at,
    trial_registered: applied.trial_registered,
    session_phase: applied.session_phase,
    wa_no_response_at: applied.wa_no_response_at,
    pipeline_status: applied.pipeline_status ?? status,
  };
}

export async function updateMarketingLeadPipeline(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phoneRaw: string,
  patch: MarketingLeadPipelinePatch
): Promise<MarketingLeadPipelineResult> {
  const phone = await findMarketingSessionPhone(admin, phoneRaw);
  if (!phone) throw new Error("lead_not_found");

  const status: MarketingPipelineDropStatus | null = isMarketingPipelineDropStatus(patch.status)
    ? patch.status
    : patch.human_followup === true
      ? "human_followup"
      : patch.human_followup === false
        ? null
        : null;

  if (patch.status && !isMarketingPipelineDropStatus(patch.status)) {
    throw new Error("unsupported_status");
  }
  if (status == null && patch.human_followup !== false && !patch.status) {
    throw new Error("missing_status");
  }

  const { data: existing, error: existingErr } = await admin
    .from("marketing_flow_sessions")
    .select("phone, human_followup_at, next_call_at, pipeline_status")
    .eq("phone", phone)
    .maybeSingle();
  if (existingErr) {
    if (isMissingColumnError(String(existingErr.message ?? ""), "pipeline_status")) {
      const fallback = await admin
        .from("marketing_flow_sessions")
        .select("phone, human_followup_at, next_call_at")
        .eq("phone", phone)
        .maybeSingle();
      if (fallback.error) {
        if (isMissingColumnError(String(fallback.error.message ?? ""), "human_followup_at|next_call_at")) {
          console.error("[marketing-lead-pipeline] migration required:", fallback.error.message);
          throw new Error("migration_required");
        }
        console.error("[marketing-lead-pipeline] session load failed:", fallback.error.message);
        throw new Error("session_lookup_failed");
      }
      return applyPipelineUpdate(admin, phone, fallback.data, status, patch, false);
    }
    if (isMissingColumnError(String(existingErr.message ?? ""), "human_followup_at|next_call_at")) {
      console.error("[marketing-lead-pipeline] migration required:", existingErr.message);
      throw new Error("migration_required");
    }
    console.error("[marketing-lead-pipeline] session load failed:", existingErr.message);
    throw new Error("session_lookup_failed");
  }

  return applyPipelineUpdate(admin, phone, existing, status, patch, true);
}

async function applyPipelineUpdate(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phone: string,
  existing: {
    human_followup_at?: string | null;
    next_call_at?: string | null;
    pipeline_status?: string | null;
  } | null,
  status: MarketingPipelineDropStatus | null,
  patch: MarketingLeadPipelinePatch,
  writePipelineStatus: boolean
): Promise<MarketingLeadPipelineResult> {
  const nowIso = new Date().toISOString();
  if (
    !writePipelineStatus &&
    status &&
    status !== "human_followup" &&
    !pipelineStatusToNoteStatus(status)
  ) {
    console.error("[marketing-lead-pipeline] pipeline_status column required for", status);
    throw new Error("migration_required");
  }
  const isHuman = status === "human_followup";
  const nextCallAt = isHuman
    ? toPipelineDateOnly(patch.next_call_at) ?? toPipelineDateOnly(existing?.next_call_at)
    : null;
  const humanFollowupAt = isHuman ? (existing?.human_followup_at as string | null) || nowIso : null;

  const update: Record<string, unknown> = {
    updated_at: nowIso,
    human_followup_at: humanFollowupAt,
    next_call_at: nextCallAt,
  };
  if (writePipelineStatus) update.pipeline_status = status;

  const { data, error } = await admin
    .from("marketing_flow_sessions")
    .update(update)
    .eq("phone", phone)
    .select("phone, human_followup_at, next_call_at")
    .single();

  if (error) {
    if (writePipelineStatus && /pipeline_status|column/i.test(String(error.message ?? ""))) {
      console.warn("[marketing-lead-pipeline] pipeline_status missing — notes/human followup only");
      return applyPipelineUpdate(admin, phone, existing, status, patch, false);
    }
    if (isMissingColumnError(String(error.message ?? ""), "human_followup_at|next_call_at")) {
      console.error("[marketing-lead-pipeline] migration required:", error.message);
      throw new Error("migration_required");
    }
    console.error("[marketing-lead-pipeline] update failed:", error.message);
    throw new Error("update_failed");
  }

  if (status) {
    await syncNoteStatusForPipeline(admin, phone, status);
    if (pipelineStatusStopsFollowups(status)) {
      await markMarketingFollowupOptedOut(phone);
    }
  }

  const resolvedHumanAt = (data.human_followup_at as string | null) ?? humanFollowupAt;
  const resolvedNextCall = toPipelineDateOnly(data.next_call_at) ?? nextCallAt;

  return {
    phone: String(data.phone ?? phone),
    human_followup_at: resolvedHumanAt,
    next_call_at: resolvedNextCall,
    pipeline_status: status,
    lead_patch: leadPatchFromResult(status, resolvedHumanAt, resolvedNextCall, nowIso),
  };
}

