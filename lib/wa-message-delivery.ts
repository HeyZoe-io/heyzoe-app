/**
 * Delivery ticks for the conversations page.
 * Per conversation load: the messages read (with wamid) plus one wa_message_statuses read
 * by primary key for every wamid in it (chunks of 200, so one query below 200 outbound rows).
 * Per list load: one read of failed statuses in the last 14 days on (status, status_at).
 * No Graph or Claude calls. At 10x businesses the reads stay on those two indexes.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { foldDeliveryStatuses, type MessageDelivery } from "@/lib/wa-delivery-errors";
import { isMissingStatusTable, WA_MESSAGE_STATUSES_TABLE } from "@/lib/wa-message-status";
import { isMissingWamidColumn } from "@/lib/wa-outbound-wamid";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const IN_CHUNK = 200;
export const FAILED_DELIVERY_LOOKBACK_DAYS = 14;
export const SESSION_MESSAGE_COLUMNS = "role, content, created_at, error_code, model_used";

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

/**
 * Runs the conversation messages query with wamid, and again without it while
 * supabase/messages_wamid.sql has not run yet.
 */
export async function selectMessagesWithWamid(
  run: (columns: string) => PromiseLike<QueryResult>
): Promise<QueryResult> {
  const first = await run(`${SESSION_MESSAGE_COLUMNS}, wamid`);
  if (!first.error || !isMissingWamidColumn(first.error.message)) return first;
  return run(SESSION_MESSAGE_COLUMNS);
}

export async function loadMessageDeliveries(
  admin: Admin,
  wamids: readonly string[]
): Promise<Map<string, MessageDelivery>> {
  const ids = [...new Set(wamids.map((w) => String(w ?? "").trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) =>
      admin
        .from(WA_MESSAGE_STATUSES_TABLE)
        .select("wamid, status, error_code, error_title")
        .in("wamid", chunk)
    )
  );
  const rows: Array<Record<string, unknown>> = [];
  for (const { data, error } of results) {
    if (error) {
      if (!isMissingStatusTable(error.message)) {
        console.error("[wa-message-delivery] status read failed:", error.message);
      }
      continue;
    }
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  return foldDeliveryStatuses(rows);
}

/** Adds `delivery` to outbound rows that have a wamid with a status, and drops wamid from the payload. */
export async function attachMessageDeliveries<T extends { role: string; wamid?: string | null }>(
  admin: Admin,
  messages: T[]
): Promise<Array<Omit<T, "wamid"> & { delivery?: MessageDelivery }>> {
  const outboundIds = messages
    .filter((m) => m.role === "assistant" && m.wamid)
    .map((m) => String(m.wamid));
  const byWamid = await loadMessageDeliveries(admin, outboundIds);
  return messages.map((m) => {
    const { wamid, ...rest } = m;
    const delivery = m.role === "assistant" && wamid ? byWamid.get(String(wamid)) : undefined;
    return delivery ? { ...rest, delivery } : rest;
  });
}

export function phoneTail9(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

/**
 * Recipient phones (last 9 digits) with a failed delivery in the lookback, per business.
 * `businessIds` empty = every business (Zoe admin «all conversations»).
 */
export async function loadFailedDeliveryPhones(
  admin: Admin,
  input: { businessIds: readonly number[]; now?: Date }
): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  const since = new Date(
    (input.now ?? new Date()).getTime() - FAILED_DELIVERY_LOOKBACK_DAYS * 24 * 36e5
  ).toISOString();
  let query = admin
    .from(WA_MESSAGE_STATUSES_TABLE)
    .select("business_id, recipient_phone")
    .eq("status", "failed")
    .gte("status_at", since);
  const ids = input.businessIds.filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 1) query = query.eq("business_id", ids[0]!);
  else if (ids.length > 1) query = query.in("business_id", ids);
  const { data, error } = await query.limit(5000);
  if (error) {
    if (!isMissingStatusTable(error.message)) {
      console.error("[wa-message-delivery] failed-status read failed:", error.message);
    }
    return out;
  }
  for (const row of (data ?? []) as Array<{ business_id?: unknown; recipient_phone?: unknown }>) {
    const businessId = Number(row.business_id);
    const tail = phoneTail9(row.recipient_phone);
    if (!Number.isFinite(businessId) || businessId <= 0 || !tail) continue;
    const set = out.get(businessId) ?? new Set<string>();
    set.add(tail);
    out.set(businessId, set);
  }
  return out;
}

/** Marks list rows whose phone had a failed delivery. One read per list load. */
export async function markSessionsWithFailedDelivery<
  T extends { phone?: string; session_id: string; source_slug?: string }
>(
  admin: Admin,
  sessions: T[],
  scope: { businessId: number } | { businessIdBySlug: ReadonlyMap<string, number> }
): Promise<Array<T & { hasFailedDelivery?: boolean }>> {
  if (!sessions.length) return sessions;
  const businessIds = "businessId" in scope ? [scope.businessId] : [];
  const failed = await loadFailedDeliveryPhones(admin, { businessIds });
  if (!failed.size) return sessions;
  return sessions.map((s) => {
    const businessId =
      "businessId" in scope
        ? scope.businessId
        : scope.businessIdBySlug.get(String(s.source_slug ?? "").trim().toLowerCase());
    const tails = businessId ? failed.get(businessId) : undefined;
    const tail = phoneTail9(s.phone) || phoneTail9(s.session_id.split("_").pop());
    return tails && tail && tails.has(tail) ? { ...s, hasFailedDelivery: true } : s;
  });
}
