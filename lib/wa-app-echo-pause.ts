import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage } from "@/lib/analytics";
import { buildWaSessionId, waSessionIdLookupVariants } from "@/lib/phone-normalize";
import {
  isMarketingConversationsSlug,
  MARKETING_WA_PHONE_NUMBER_ID,
} from "@/lib/marketing-whatsapp";
import type { WaSmbMessageEcho } from "@/lib/whatsapp";

/** Logged on messages.model_used — outbound from the WhatsApp Business app. */
export const WA_BUSINESS_APP_ECHO_MODEL = "wa_business_app";

/** Per-lead silence after a human send from the phone app. No cron — paused_until expires. */
export const WA_BUSINESS_APP_PAUSE_MS = 5 * 60 * 60 * 1000;

/** Dashboard pause is ~100 years. Anything within this window is the 5h app-echo pause. */
export const WA_APP_ECHO_PAUSE_DISPLAY_MAX_MS = 12 * 60 * 60 * 1000;

export function remainingAppEchoPauseMs(
  pausedUntilIso: string | null | undefined,
  now: Date = new Date()
): number {
  const until = pausedUntilIso ? new Date(pausedUntilIso).getTime() : NaN;
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - now.getTime());
}

/** True when this pause is the auto 5h WhatsApp-app silence (not dashboard «עצור בוט»). */
export function isAppEchoAutoPause(
  pausedUntilIso: string | null | undefined,
  now: Date = new Date()
): boolean {
  const remaining = remainingAppEchoPauseMs(pausedUntilIso, now);
  return remaining > 0 && remaining <= WA_APP_ECHO_PAUSE_DISPLAY_MAX_MS;
}

export function formatAppEchoPauseRemaining(
  pausedUntilIso: string,
  lang: "he" | "en",
  now: Date = new Date()
): string {
  const remaining = remainingAppEchoPauseMs(pausedUntilIso, now);
  const totalMin = Math.max(1, Math.ceil(remaining / 60_000));
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (lang === "en") {
    if (hours <= 0) return `${mins}m left`;
    if (mins === 0) return `${hours}h left`;
    return `${hours}h ${mins}m left`;
  }
  if (hours <= 0) return `עוד ${mins} דק׳`;
  if (mins === 0) return `עוד ${hours} שע׳`;
  return `עוד ${hours} שע׳ ${mins} דק׳`;
}

/**
 * Dashboard "עצור בוט" sets paused_until ~100 years out. Never shorten that.
 * Otherwise refresh to now + 5h on every app send.
 */
export function nextPausedUntilForAppEcho(
  existingUntilIso: string | null | undefined,
  now: Date = new Date()
): string {
  const fiveHours = new Date(now.getTime() + WA_BUSINESS_APP_PAUSE_MS);
  const existingMs = existingUntilIso ? new Date(existingUntilIso).getTime() : NaN;
  if (Number.isFinite(existingMs) && existingMs > fiveHours.getTime()) {
    return new Date(existingMs).toISOString();
  }
  return fiveHours.toISOString();
}

export async function isBusinessWaSessionPaused(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessSlug: string;
  sessionIds: string[];
}): Promise<boolean> {
  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionIds = input.sessionIds.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!slug || !sessionIds.length) return false;
  const nowIso = new Date().toISOString();
  const { data, error } = await input.admin
    .from("paused_sessions")
    .select("id")
    .eq("business_slug", slug)
    .in("session_id", sessionIds)
    .gt("paused_until", nowIso)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[wa-app-echo-pause] pause lookup failed:", error.message);
    return false;
  }
  return Boolean(data?.id);
}

async function pauseBusinessSessionForAppEcho(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessSlug: string;
  sessionId: string;
  now: Date;
}): Promise<{ pausedUntil: string; keptManualPause: boolean }> {
  const businessSlug = input.businessSlug.trim().toLowerCase();
  const sessionId = input.sessionId.trim();
  const { data: existing } = await input.admin
    .from("paused_sessions")
    .select("id, paused_until")
    .eq("business_slug", businessSlug)
    .eq("session_id", sessionId)
    .order("paused_until", { ascending: false })
    .limit(1)
    .maybeSingle();

  const existingUntil = String((existing as { paused_until?: string } | null)?.paused_until ?? "") || null;
  const pausedUntil = nextPausedUntilForAppEcho(existingUntil, input.now);
  const keptManualPause = Boolean(existingUntil && pausedUntil === new Date(existingUntil).toISOString());

  if (existing?.id) {
    if (!keptManualPause) {
      const { error } = await input.admin
        .from("paused_sessions")
        .update({ paused_until: pausedUntil })
        .eq("id", existing.id);
      if (error) console.error("[wa-app-echo-pause] paused_sessions update failed:", error.message);
    }
  } else {
    const { error } = await input.admin.from("paused_sessions").insert({
      business_slug: businessSlug,
      session_id: sessionId,
      paused_until: pausedUntil,
    });
    if (error) console.error("[wa-app-echo-pause] paused_sessions insert failed:", error.message);
  }

  return { pausedUntil, keptManualPause };
}

/**
 * Coexistence: a human sent from the WhatsApp Business app to a lead.
 * Pause Zoe on that session for 5 hours. Does not touch marketing, and does not
 * set conversations.bot_paused (that flag notifies the owner and auto-clears at 15 min).
 */
export async function handleSmbMessageEchoes(echoes: WaSmbMessageEcho[]): Promise<void> {
  if (!echoes.length) return;
  const admin = createSupabaseAdminClient();
  const now = new Date();

  for (const echo of echoes) {
    if (echo.phoneNumberId === MARKETING_WA_PHONE_NUMBER_ID) {
      console.info("[wa-app-echo-pause] skip marketing line echo", { messageId: echo.messageId });
      continue;
    }

    const { data: channel, error: chErr } = await admin
      .from("whatsapp_channels")
      .select("business_slug, business_id, phone_number_id")
      .eq("phone_number_id", echo.phoneNumberId)
      .maybeSingle();
    if (chErr) {
      console.error("[wa-app-echo-pause] channel lookup failed:", chErr.message);
      continue;
    }
    const businessSlug = String((channel as { business_slug?: string } | null)?.business_slug ?? "")
      .trim()
      .toLowerCase();
    if (!businessSlug || isMarketingConversationsSlug(businessSlug)) {
      console.warn("[wa-app-echo-pause] no business channel for echo", {
        phoneNumberId: echo.phoneNumberId,
        messageId: echo.messageId,
      });
      continue;
    }

    const sessionId = buildWaSessionId(echo.phoneNumberId, echo.leadPhone);
    if (!sessionId) {
      console.warn("[wa-app-echo-pause] could not build session_id", { messageId: echo.messageId });
      continue;
    }

    const { error: claimErr } = await admin
      .from("wa_processed_messages")
      .insert({ message_id: `echo:${echo.messageId}` });
    if (claimErr?.code === "23505") {
      console.info("[wa-app-echo-pause] skip duplicate echo", { messageId: echo.messageId });
      continue;
    }

    const { pausedUntil, keptManualPause } = await pauseBusinessSessionForAppEcho({
      admin,
      businessSlug,
      sessionId,
      now,
    });

    try {
      await logMessage({
        business_slug: businessSlug,
        role: "assistant",
        content: echo.text,
        model_used: WA_BUSINESS_APP_ECHO_MODEL,
        session_id: sessionId,
      });
    } catch (e) {
      console.error("[wa-app-echo-pause] logMessage failed:", e);
    }

    console.info("[wa-app-echo-pause] paused session after WhatsApp app send", {
      business_slug: businessSlug,
      sessionId,
      messageId: echo.messageId,
      metaType: echo.metaType,
      pausedUntil,
      keptManualPause,
    });
  }
}

export async function isWaFollowupBlockedByAppPause(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessSlug: string;
  phoneNumberId: string;
  phone: string;
}): Promise<boolean> {
  const sessionIds = waSessionIdLookupVariants(input.phoneNumberId, input.phone);
  return isBusinessWaSessionPaused({
    admin: input.admin,
    businessSlug: input.businessSlug,
    sessionIds,
  });
}
