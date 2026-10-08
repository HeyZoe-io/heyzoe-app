/**
 * Meta status webhooks (sent / delivered / read / failed) → public.wa_message_statuses.
 * Called from /api/whatsapp/webhook inside after(), so Meta always gets its 200 first.
 *
 * IO per webhook POST that carries statuses: one upsert for the whole batch, plus one
 * whatsapp_channels read per new phone_number_id per instance (cached). Meta sends up to
 * three status events per outbound message, so rows ≈ 3 × outbound messages.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const WA_MESSAGE_STATUSES_TABLE = "wa_message_statuses";
const KNOWN_STATUSES = new Set(["sent", "delivered", "read", "failed"]);
const CHANNEL_CACHE_MS = 10 * 60_000;

export type MetaStatusEvent = {
  wamid: string;
  status: string;
  phoneNumberId: string;
  recipientPhone: string;
  errorCode: number | null;
  errorTitle: string | null;
  statusAt: string | null;
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function statusInstant(raw: unknown): string | null {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Every `value.statuses[]` entry with a wamid and one of the four delivery states. */
export function parseMetaStatusEvents(payload: unknown): MetaStatusEvent[] {
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? (root!.entry as unknown[]) : [];
  const out: MetaStatusEvent[] = [];
  for (const entry of entries) {
    const changes = Array.isArray(asRecord(entry)?.changes) ? (asRecord(entry)!.changes as unknown[]) : [];
    for (const change of changes) {
      const value = asRecord(asRecord(change)?.value);
      if (!value) continue;
      const phoneNumberId = String(asRecord(value.metadata)?.phone_number_id ?? "").trim();
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const raw of statuses) {
        const st = asRecord(raw);
        const wamid = String(st?.id ?? "").trim();
        const status = String(st?.status ?? "").trim().toLowerCase();
        if (!st || !wamid || !KNOWN_STATUSES.has(status)) continue;
        const firstError = asRecord(Array.isArray(st.errors) ? st.errors[0] : null);
        const code = Number(firstError?.code);
        const title = String(firstError?.title ?? firstError?.message ?? "").trim();
        out.push({
          wamid,
          status,
          phoneNumberId,
          recipientPhone: String(st.recipient_id ?? "").replace(/\D/g, ""),
          errorCode: firstError && Number.isFinite(code) ? Math.trunc(code) : null,
          errorTitle: title ? title.slice(0, 300) : null,
          statusAt: statusInstant(st.timestamp),
        });
      }
    }
  }
  return out;
}

const channelCache = new Map<string, { businessId: number | null; at: number }>();

async function businessIdsForPhoneNumberIds(
  admin: Admin,
  ids: readonly string[],
  nowMs: number
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const missing: string[] = [];
  for (const id of ids) {
    const hit = channelCache.get(id);
    if (hit && nowMs - hit.at < CHANNEL_CACHE_MS) out.set(id, hit.businessId);
    else missing.push(id);
  }
  if (!missing.length) return out;
  const { data, error } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id, business_id")
    .in("phone_number_id", missing);
  if (error) {
    console.error("[wa-message-status] channel lookup failed:", error.message);
    for (const id of missing) out.set(id, null);
    return out;
  }
  const found = new Map<string, number>();
  for (const row of data ?? []) {
    const businessId = Number((row as { business_id?: unknown }).business_id);
    if (Number.isFinite(businessId) && businessId > 0) {
      found.set(String((row as { phone_number_id?: unknown }).phone_number_id ?? ""), businessId);
    }
  }
  for (const id of missing) {
    const businessId = found.get(id) ?? null;
    channelCache.set(id, { businessId, at: nowMs });
    out.set(id, businessId);
  }
  return out;
}

export function isMissingStatusTable(message: string): boolean {
  return /wa_message_statuses|does not exist|42P01|schema cache/i.test(message);
}

/** Never throws. A failed insert is logged and dropped; the webhook already answered 200. */
export async function persistMetaStatusEvents(
  admin: Admin,
  events: readonly MetaStatusEvent[],
  now: Date = new Date()
): Promise<{ ok: boolean; rows: number; error?: string }> {
  if (!events.length) return { ok: true, rows: 0 };
  try {
    const ids = [...new Set(events.map((e) => e.phoneNumberId).filter(Boolean))];
    const businessByChannel = await businessIdsForPhoneNumberIds(admin, ids, now.getTime());
    const byKey = new Map<string, Record<string, unknown>>();
    for (const e of events) {
      byKey.set(`${e.wamid}|${e.status}`, {
        wamid: e.wamid,
        status: e.status,
        business_id: businessByChannel.get(e.phoneNumberId) ?? null,
        phone_number_id: e.phoneNumberId || null,
        recipient_phone: e.recipientPhone || null,
        error_code: e.errorCode,
        error_title: e.errorTitle,
        status_at: e.statusAt,
      });
    }
    const rows = [...byKey.values()];
    const { error } = await admin
      .from(WA_MESSAGE_STATUSES_TABLE)
      .upsert(rows, { onConflict: "wamid,status", ignoreDuplicates: true });
    if (error) {
      console.error(
        isMissingStatusTable(error.message)
          ? "[wa-message-status] table missing — run supabase/wa_message_statuses.sql"
          : "[wa-message-status] upsert failed:",
        error.message
      );
      return { ok: false, rows: 0, error: error.message };
    }
    const failed = events.filter((e) => e.status === "failed");
    if (failed.length) {
      console.warn("[wa-message-status] delivery failed", {
        count: failed.length,
        codes: [...new Set(failed.map((e) => e.errorCode))],
      });
    }
    return { ok: true, rows: rows.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa-message-status] persist threw:", message);
    return { ok: false, rows: 0, error: message };
  }
}
