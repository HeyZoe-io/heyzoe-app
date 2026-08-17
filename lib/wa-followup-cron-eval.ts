import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildWaSessionId, waSessionIdLookupVariants } from "@/lib/phone-normalize";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";
import { sessionHasSalesFlowGreeting } from "@/lib/analytics";
import {
  resolveWaFollowupSendPlan,
  resolveWaSalesFollowupEnabled,
  WA_FOLLOWUP_MS_20_MIN,
  WA_FOLLOWUP_MS_2_H,
  WA_FOLLOWUP_MS_23_H,
} from "@/lib/wa-sales-followup-defaults";

export type WaFollowupSkipReason =
  | "time_window"
  | "invalid_contact"
  | "no_active_channel"
  | "no_assistant_message"
  | "no_user_message"
  | "over_24h"
  | "already_replied"
  | "not_due_yet"
  | "send_failed"
  | "session_paused"
  | "stage_disabled"
  | "sales_flow_not_started"
  | "eligible";

export type WaFollowupEvalResult = {
  skip_reason: WaFollowupSkipReason;
  detail?: Record<string, unknown>;
  next_stage?: number;
};

/** Last assistant turn that is not our own WA follow-up (shared with >24h re-engage). */
export async function fetchLatestRealAssistantMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<{ created_at: string; model_used: string | null } | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data } = await input.admin
    .from("messages")
    .select("created_at, model_used")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(40);
  for (const row of data ?? []) {
    const m = String((row as { model_used?: string | null }).model_used ?? "");
    if (!m.startsWith("wa_followup_") && m !== "wa_business_app" && row.created_at) {
      return { created_at: String(row.created_at), model_used: m || null };
    }
  }
  return null;
}

/** True when the lead replied after the given assistant timestamp. */
export async function hasUserReplyAfter(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
  afterIso: string;
}): Promise<boolean> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return false;
  const { data } = await input.admin
    .from("messages")
    .select("id")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "user")
    .gt("created_at", input.afterIso)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

/** Latest inbound user message timestamp for the WA session variants. */
export async function fetchLatestUserMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<string | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data } = await input.admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = data?.created_at ? String(data.created_at) : "";
  return at || null;
}

function notDueYetDetail(stageCurrent: number, elapsedMs: number): Record<string, unknown> {
  if (stageCurrent >= 3) return { wa_followup_stage: stageCurrent, detail: "all_stages_sent" };
  if (stageCurrent < 1) {
    return {
      wa_followup_stage: stageCurrent,
      detail: "waiting_20m",
      elapsed_ms: elapsedMs,
      need_ms: Math.max(0, WA_FOLLOWUP_MS_20_MIN - elapsedMs),
    };
  }
  if (stageCurrent < 2) {
    return {
      wa_followup_stage: stageCurrent,
      detail: "waiting_2h",
      elapsed_ms: elapsedMs,
      need_ms: Math.max(0, WA_FOLLOWUP_MS_2_H - elapsedMs),
    };
  }
  return {
    wa_followup_stage: stageCurrent,
    detail: "waiting_23h",
    elapsed_ms: elapsedMs,
    need_ms: Math.max(0, WA_FOLLOWUP_MS_23_H - elapsedMs),
  };
}

/** הערכת זכאות לפולואפ הבא (בלי לשלוח) */
export async function evaluateBusinessWaFollowup(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  phone: string;
  contact: {
    id?: string | number;
    wa_followup_stage?: number | null;
    opted_out?: boolean | null;
    not_relevant_at?: string | null;
    human_requested_at?: string | null;
    trial_registered?: boolean | null;
  };
}): Promise<WaFollowupEvalResult & { session_id: string; business_slug: string }> {
  const business_slug = input.business_slug.trim().toLowerCase();
  const phone = input.phone.trim();

  if (input.contact.opted_out === true) {
    return {
      skip_reason: "invalid_contact",
      session_id: "",
      business_slug,
      detail: { filtered_reason: "opted_out" },
    };
  }
  if (input.contact.not_relevant_at) {
    return {
      skip_reason: "invalid_contact",
      session_id: "",
      business_slug,
      detail: { filtered_reason: "not_relevant" },
    };
  }
  if (input.contact.human_requested_at) {
    return {
      skip_reason: "invalid_contact",
      session_id: "",
      business_slug,
      detail: { filtered_reason: "human_requested" },
    };
  }
  if (input.contact.trial_registered === true) {
    return {
      skip_reason: "invalid_contact",
      session_id: "",
      business_slug,
      detail: { filtered_reason: "trial_registered" },
    };
  }

  const { data: bizRow } = await input.admin
    .from("businesses")
    .select("id, social_links")
    .ilike("slug", business_slug)
    .limit(1)
    .maybeSingle();
  const businessId = Number((bizRow as { id?: unknown } | null)?.id);
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return {
      skip_reason: "no_active_channel",
      session_id: "",
      business_slug,
      detail: { phone, filtered_reason: "business_not_found" },
    };
  }

  const channel = await resolveSendChannelForContact(input.admin, businessId, phone);

  if (!channel?.phoneNumberId) {
    return {
      skip_reason: "no_active_channel",
      session_id: "",
      business_slug,
      detail: { phone },
    };
  }

  const phoneNumberId = String(channel.phoneNumberId).trim();
  const sessionId = buildWaSessionId(phoneNumberId, phone);
  const sessionIds = waSessionIdLookupVariants(phoneNumberId, phone);

  if (
    !(await sessionHasSalesFlowGreeting({
      business_slug,
      session_id: sessionIds.length ? sessionIds : sessionId,
    }))
  ) {
    return {
      skip_reason: "sales_flow_not_started",
      session_id: sessionId,
      business_slug,
      detail: { contact_id: input.contact.id ?? null },
    };
  }

  const { isWaFollowupBlockedByAppPause } = await import("@/lib/wa-app-echo-pause");
  if (
    await isWaFollowupBlockedByAppPause({
      admin: input.admin,
      businessSlug: business_slug,
      phoneNumberId,
      phone,
    })
  ) {
    return {
      skip_reason: "session_paused",
      session_id: sessionId,
      business_slug,
      detail: { contact_id: input.contact.id ?? null },
    };
  }

  const lastAssist = await fetchLatestRealAssistantMessageAt({
    admin: input.admin,
    business_slug,
    session_ids: sessionIds,
  });
  if (!lastAssist?.created_at) {
    return {
      skip_reason: "no_assistant_message",
      session_id: sessionId,
      business_slug,
      detail: { contact_id: input.contact.id ?? null, session_id_variants: sessionIds },
    };
  }

  const lastUserAtIso = await fetchLatestUserMessageAt({
    admin: input.admin,
    business_slug,
    session_ids: sessionIds,
  });
  if (!lastUserAtIso) {
    return {
      skip_reason: "no_user_message",
      session_id: sessionId,
      business_slug,
      detail: { contact_id: input.contact.id ?? null },
    };
  }

  const hoursSinceUser = (Date.now() - new Date(lastUserAtIso).getTime()) / (1000 * 60 * 60);
  if (!Number.isFinite(hoursSinceUser) || hoursSinceUser >= 24) {
    return {
      skip_reason: "over_24h",
      session_id: sessionId,
      business_slug,
      detail: { hours_since_user: hoursSinceUser, last_user_at: lastUserAtIso },
    };
  }

  if (
    await hasUserReplyAfter({
      admin: input.admin,
      business_slug,
      session_ids: sessionIds,
      afterIso: lastAssist.created_at,
    })
  ) {
    return {
      skip_reason: "already_replied",
      session_id: sessionId,
      business_slug,
      detail: { last_assistant_at: lastAssist.created_at },
    };
  }

  const elapsedMs = Date.now() - new Date(lastAssist.created_at).getTime();
  const stageCurrent = Number(input.contact.wa_followup_stage ?? 0) || 0;
  const enabled = resolveWaSalesFollowupEnabled((bizRow as { social_links?: unknown } | null)?.social_links);
  const plan = resolveWaFollowupSendPlan({ stageCurrent, elapsedMs, enabled });

  if (plan.sendStage < 1) {
    if (plan.advanceToStage > stageCurrent) {
      return {
        skip_reason: "stage_disabled",
        session_id: sessionId,
        business_slug,
        next_stage: plan.advanceToStage,
        detail: {
          last_assistant_at: lastAssist.created_at,
          elapsed_ms: elapsedMs,
          wa_followup_stage: stageCurrent,
          advance_to_stage: plan.advanceToStage,
          enabled,
        },
      };
    }
    return {
      skip_reason: "not_due_yet",
      session_id: sessionId,
      business_slug,
      detail: {
        last_assistant_at: lastAssist.created_at,
        last_assistant_model: lastAssist.model_used,
        ...notDueYetDetail(stageCurrent, elapsedMs),
      },
    };
  }

  return {
    skip_reason: "eligible",
    session_id: sessionId,
    business_slug,
    next_stage: plan.sendStage,
    detail: {
      last_assistant_at: lastAssist.created_at,
      elapsed_ms: elapsedMs,
      wa_followup_stage: stageCurrent,
      enabled,
    },
  };
}
