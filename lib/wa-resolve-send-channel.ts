import { waSessionIdLookupVariants } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type ActiveWaChannel = {
  id: number;
  phoneNumberId: string;
  businessSlug: string;
  createdAt: string;
};

export type ResolvedWaSendChannel = ActiveWaChannel;

export type LatestUserMessageAcrossChannels = {
  createdAt: string;
  phoneNumberId: string;
  sessionId: string;
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Map a messages.session_id back to one of the business's phone_number_ids. */
export function phoneNumberIdFromSessionId(
  sessionId: string,
  phoneNumberIds: string[]
): string | null {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return null;
  for (const pid of phoneNumberIds) {
    if (pid && sid.startsWith(`wa_${pid}_`)) return pid;
  }
  return null;
}

/**
 * Prefer Meta CONNECTED pnids when the caller already has that set cheaply;
 * otherwise most recently created active channel (never lowest id).
 */
export function pickDefaultActiveChannel(
  channels: ActiveWaChannel[],
  preferConnectedPhoneNumberIds?: ReadonlySet<string> | null
): ActiveWaChannel | null {
  const active = channels
    .filter((c) => Boolean(String(c.phoneNumberId ?? "").trim()))
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      if (tb !== ta) return tb - ta;
      return b.id - a.id;
    });
  if (!active.length) return null;

  const prefer = preferConnectedPhoneNumberIds;
  if (prefer && prefer.size > 0) {
    const connected = active.find((c) => prefer.has(c.phoneNumberId));
    if (connected) return connected;
  }
  return active[0] ?? null;
}

/** Pure: if inbound maps to an active channel, use it; else default pick. */
export function pickSendChannelForContact(
  channels: ActiveWaChannel[],
  latestInboundPhoneNumberId: string | null | undefined,
  preferConnectedPhoneNumberIds?: ReadonlySet<string> | null
): ActiveWaChannel | null {
  const inbound = String(latestInboundPhoneNumberId ?? "").trim();
  if (inbound) {
    const match = channels.find((c) => c.phoneNumberId === inbound);
    if (match) return match;
  }
  return pickDefaultActiveChannel(channels, preferConnectedPhoneNumberIds);
}

export async function loadActiveWaChannels(
  admin: AdminClient,
  businessId: number
): Promise<ActiveWaChannel[]> {
  const id = Number(businessId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const { data, error } = await admin
    .from("whatsapp_channels")
    .select("id, phone_number_id, business_slug, created_at")
    .eq("business_id", id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[wa-resolve-send-channel] loadActiveWaChannels failed:", error.message);
    return [];
  }

  const out: ActiveWaChannel[] = [];
  for (const row of data ?? []) {
    const phoneNumberId = String((row as { phone_number_id?: string }).phone_number_id ?? "").trim();
    if (!phoneNumberId) continue;
    const channelId = Number((row as { id?: unknown }).id);
    out.push({
      id: Number.isFinite(channelId) ? channelId : 0,
      phoneNumberId,
      businessSlug: String((row as { business_slug?: string }).business_slug ?? "")
        .trim()
        .toLowerCase(),
      createdAt: String((row as { created_at?: string }).created_at ?? "").trim(),
    });
  }
  return out;
}

/**
 * Latest inbound user message for this contact across ALL given WA channels.
 * Shared by resolveSendChannelForContact and trial-registered-wa-reply.
 */
export async function fetchLatestUserMessageAcrossChannels(input: {
  admin: AdminClient;
  businessSlug: string;
  phone: string;
  phoneNumberIds: string[];
}): Promise<LatestUserMessageAcrossChannels | null> {
  const phoneNumberIds = input.phoneNumberIds.map((p) => String(p ?? "").trim()).filter(Boolean);
  if (!phoneNumberIds.length) return null;

  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  if (!businessSlug) return null;

  const sessionIds = [
    ...new Set(phoneNumberIds.flatMap((pid) => waSessionIdLookupVariants(pid, input.phone))),
  ].filter(Boolean);
  if (!sessionIds.length) return null;

  const { data } = await input.admin
    .from("messages")
    .select("created_at, session_id")
    .eq("business_slug", businessSlug)
    .in("session_id", sessionIds)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const createdAt = String((data as { created_at?: string } | null)?.created_at ?? "").trim();
  const sessionId = String((data as { session_id?: string } | null)?.session_id ?? "").trim();
  if (!createdAt || !sessionId) return null;

  const phoneNumberId = phoneNumberIdFromSessionId(sessionId, phoneNumberIds);
  if (!phoneNumberId) return null;

  return { createdAt, phoneNumberId, sessionId };
}

/**
 * Contact-scoped send channel:
 * 1) active channel of the contact's latest role=user message
 * 2) else Meta CONNECTED (if prefer set provided cheaply) / else newest active by created_at
 * 3) null if no active channel
 */
export async function resolveSendChannelForContact(
  admin: AdminClient,
  businessId: number,
  contactPhone: string,
  opts?: { preferConnectedPhoneNumberIds?: ReadonlySet<string> | null }
): Promise<ResolvedWaSendChannel | null> {
  const channels = await loadActiveWaChannels(admin, businessId);
  if (!channels.length) return null;

  const businessSlug =
    channels.map((c) => c.businessSlug).find(Boolean) ||
    String(channels[0]?.businessSlug ?? "").trim();
  const latest = await fetchLatestUserMessageAcrossChannels({
    admin,
    businessSlug,
    phone: contactPhone,
    phoneNumberIds: channels.map((c) => c.phoneNumberId),
  });

  return pickSendChannelForContact(
    channels,
    latest?.phoneNumberId,
    opts?.preferConnectedPhoneNumberIds
  );
}

/** Non-contact-scoped: newest active / CONNECTED prefer — never first-by-id. */
export async function resolveDefaultSendChannel(
  admin: AdminClient,
  businessId: number,
  opts?: { preferConnectedPhoneNumberIds?: ReadonlySet<string> | null }
): Promise<ResolvedWaSendChannel | null> {
  const channels = await loadActiveWaChannels(admin, businessId);
  return pickDefaultActiveChannel(channels, opts?.preferConnectedPhoneNumberIds);
}
