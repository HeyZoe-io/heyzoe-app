import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { waSessionPhoneKey } from "@/lib/phone-normalize";

const MS_20_MIN = 20 * 60 * 1000;
const MS_2_H = 2 * 60 * 60 * 1000;
const MS_23_H = 23 * 60 * 60 * 1000;

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
  | "eligible";

export type WaFollowupEvalResult = {
  skip_reason: WaFollowupSkipReason;
  detail?: Record<string, unknown>;
  next_stage?: number;
};

async function fetchLatestRealAssistantMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_id: string;
}): Promise<{ created_at: string; model_used: string | null } | null> {
  const { data } = await input.admin
    .from("messages")
    .select("created_at, model_used")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(40);
  for (const row of data ?? []) {
    const m = String((row as { model_used?: string | null }).model_used ?? "");
    if (!m.startsWith("wa_followup_") && row.created_at) {
      return { created_at: String(row.created_at), model_used: m || null };
    }
  }
  return null;
}

async function hasUserReplyAfter(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_id: string;
  afterIso: string;
}): Promise<boolean> {
  const { data } = await input.admin
    .from("messages")
    .select("id")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
    .eq("role", "user")
    .gt("created_at", input.afterIso)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

async function fetchLatestUserMessageAt(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_id: string;
}): Promise<string | null> {
  const { data } = await input.admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
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
      need_ms: Math.max(0, MS_20_MIN - elapsedMs),
    };
  }
  if (stageCurrent < 2) {
    return {
      wa_followup_stage: stageCurrent,
      detail: "waiting_2h",
      elapsed_ms: elapsedMs,
      need_ms: Math.max(0, MS_2_H - elapsedMs),
    };
  }
  return {
    wa_followup_stage: stageCurrent,
    detail: "waiting_23h",
    elapsed_ms: elapsedMs,
    need_ms: Math.max(0, MS_23_H - elapsedMs),
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
  if (input.contact.trial_registered === true) {
    return {
      skip_reason: "invalid_contact",
      session_id: "",
      business_slug,
      detail: { filtered_reason: "trial_registered" },
    };
  }

  const { data: channel } = await input.admin
    .from("whatsapp_channels")
    .select("phone_number_id, business_slug, is_active")
    .eq("business_slug", business_slug)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!channel?.phone_number_id) {
    return {
      skip_reason: "no_active_channel",
      session_id: "",
      business_slug,
      detail: { phone },
    };
  }

  const phoneNumberId = String(channel.phone_number_id).trim();
  const sessionId = `wa_${phoneNumberId}_${waSessionPhoneKey(phone)}`;

  const lastAssist = await fetchLatestRealAssistantMessageAt({
    admin: input.admin,
    business_slug,
    session_id: sessionId,
  });
  if (!lastAssist?.created_at) {
    return {
      skip_reason: "no_assistant_message",
      session_id: sessionId,
      business_slug,
      detail: { contact_id: input.contact.id ?? null },
    };
  }

  const lastUserAtIso = await fetchLatestUserMessageAt({
    admin: input.admin,
    business_slug,
    session_id: sessionId,
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
      session_id: sessionId,
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
  const nextStage =
    stageCurrent < 1 && elapsedMs >= MS_20_MIN
      ? 1
      : stageCurrent < 2 && elapsedMs >= MS_2_H
        ? 2
        : stageCurrent < 3 && elapsedMs >= MS_23_H
          ? 3
          : 0;

  if (nextStage < 1) {
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
    next_stage: nextStage,
    detail: {
      last_assistant_at: lastAssist.created_at,
      elapsed_ms: elapsedMs,
      wa_followup_stage: stageCurrent,
    },
  };
}
