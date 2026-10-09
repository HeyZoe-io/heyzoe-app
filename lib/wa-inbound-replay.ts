import { createHmac } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * One-time production replay of a lead's last unanswered inbound (e.g. it arrived while
 * the session was paused). A queue row is a `messages` event; the wa-followups cron drains it
 * and feeds the inbound back through the real webhook, without logging the user turn again.
 */
export const INBOUND_REPLAY_REQUEST_MODEL = "inbound_replay_request";
export const INBOUND_REPLAY_DONE_MODEL = "inbound_replay_done";
export const INBOUND_REPLAY_PAYLOAD_FLAG = "heyzoe_inbound_replay";

const REQUEST_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const DRAIN_LIMIT = 5;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type InboundReplayRow = {
  id: number | string;
  created_at: string;
  role: string;
  content: string | null;
  model_used?: string | null;
};

export function parseWaSessionId(sessionId: string): { phoneNumberId: string; phone: string } | null {
  const m = /^wa_(\d+)_\+?(\d+)$/.exec(String(sessionId ?? "").trim());
  return m ? { phoneNumberId: m[1]!, phone: m[2]! } : null;
}

/** Newest-first rows. The newest non-event row must be the lead's text, inside the 24h window. */
export function pickUnansweredInbound(
  rowsNewestFirst: InboundReplayRow[],
  now: Date
): { ok: true; row: InboundReplayRow } | { ok: false; reason: string } {
  const latest = rowsNewestFirst.find((r) => String(r.role ?? "").trim() !== "event");
  if (!latest) return { ok: false, reason: "no_messages" };
  if (String(latest.role).trim() !== "user") return { ok: false, reason: "already_answered" };
  const text = String(latest.content ?? "").trim();
  if (!text) return { ok: false, reason: "empty_inbound" };
  const age = now.getTime() - new Date(latest.created_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > REPLAY_WINDOW_MS) return { ok: false, reason: "outside_window" };
  return { ok: true, row: latest };
}

export function buildInboundReplayPayload(input: {
  phoneNumberId: string;
  phone: string;
  text: string;
  replayOfId: string | number;
  profileName?: string;
}): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    [INBOUND_REPLAY_PAYLOAD_FLAG]: true,
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: input.phoneNumberId },
              contacts: input.profileName ? [{ profile: { name: input.profileName }, wa_id: input.phone }] : [],
              messages: [
                {
                  from: input.phone,
                  id: `replay_${input.replayOfId}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: input.text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

export function signMetaPayload(appSecret: string, body: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(body, "utf8").digest("hex")}`;
}

export type InboundReplayDispatch = (body: string) => Promise<number>;

export async function drainInboundReplayRequests(input: {
  admin: Admin;
  dispatch: InboundReplayDispatch;
  now?: Date;
}): Promise<{ fetched: number; replayed: number; skipped: Record<string, number> }> {
  const now = input.now ?? new Date();
  const sinceIso = new Date(now.getTime() - REQUEST_LOOKBACK_MS).toISOString();
  const skipped: Record<string, number> = {};
  const skip = (reason: string, meta: Record<string, unknown>) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    console.warn("[inbound-replay] skip", { reason, ...meta });
  };

  const { data, error } = await input.admin
    .from("messages")
    .select("id, business_slug, session_id")
    .gte("created_at", sinceIso)
    .eq("role", "event")
    .eq("model_used", INBOUND_REPLAY_REQUEST_MODEL)
    .order("created_at", { ascending: true })
    .limit(DRAIN_LIMIT);
  if (error) {
    console.error("[inbound-replay] request lookup failed:", error.message);
    return { fetched: 0, replayed: 0, skipped };
  }

  let replayed = 0;
  for (const req of (data ?? []) as { id: number; business_slug: string; session_id: string }[]) {
    const { data: claimed, error: claimErr } = await input.admin
      .from("messages")
      .update({ model_used: INBOUND_REPLAY_DONE_MODEL })
      .eq("id", req.id)
      .eq("model_used", INBOUND_REPLAY_REQUEST_MODEL)
      .select("id");
    if (claimErr || !claimed?.length) {
      if (claimErr) console.error("[inbound-replay] claim failed:", claimErr.message, { id: req.id });
      continue;
    }

    const meta = { request_id: req.id, business_slug: req.business_slug, session_id: req.session_id };
    const parsed = parseWaSessionId(req.session_id);
    if (!parsed) {
      skip("bad_session_id", meta);
      continue;
    }

    const { data: rows, error: rowsErr } = await input.admin
      .from("messages")
      .select("id, created_at, role, content, model_used")
      .eq("business_slug", req.business_slug)
      .eq("session_id", req.session_id)
      .neq("id", req.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (rowsErr) {
      console.error("[inbound-replay] session lookup failed:", rowsErr.message, meta);
      skip("lookup_failed", meta);
      continue;
    }
    const pick = pickUnansweredInbound((rows ?? []) as InboundReplayRow[], now);
    if (!pick.ok) {
      skip(pick.reason, meta);
      continue;
    }

    const body = buildInboundReplayPayload({
      phoneNumberId: parsed.phoneNumberId,
      phone: parsed.phone,
      text: String(pick.row.content ?? "").trim(),
      replayOfId: pick.row.id,
    });
    try {
      const status = await input.dispatch(body);
      if (status !== 200) {
        console.error("[inbound-replay] webhook rejected replay", { ...meta, status });
        skip("webhook_rejected", meta);
        continue;
      }
      replayed += 1;
      console.info("[inbound-replay] replayed inbound", { ...meta, replay_of: pick.row.id });
    } catch (e) {
      console.error("[inbound-replay] dispatch failed:", e instanceof Error ? e.message : e, meta);
      skip("dispatch_failed", meta);
    }
  }

  return { fetched: data?.length ?? 0, replayed, skipped };
}
