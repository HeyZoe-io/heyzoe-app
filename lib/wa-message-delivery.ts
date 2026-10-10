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

export function isMissingSeenAtColumn(message: string): boolean {
  return /seen_at/i.test(message) && /does not exist|42703|schema cache/i.test(message);
}

function failedLookbackSince(now?: Date): string {
  return new Date(
    (now ?? new Date()).getTime() - FAILED_DELIVERY_LOOKBACK_DAYS * 24 * 36e5
  ).toISOString();
}

/**
 * Recipient phones (last 9 digits) with a failed delivery in the lookback, per business.
 * `businessIds` empty = every business (Zoe admin «all conversations»).
 * `unseenOnly` skips failures a business user already opened (seen_at). Before
 * supabase/wa_message_statuses_seen_at.sql runs, it falls back to every failure.
 */
export async function loadFailedDeliveryPhones(
  admin: Admin,
  input: { businessIds: readonly number[]; now?: Date; unseenOnly?: boolean }
): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  const since = failedLookbackSince(input.now);
  const ids = input.businessIds.filter((id) => Number.isFinite(id) && id > 0);
  const run = (unseenOnly: boolean) => {
    let query = admin
      .from(WA_MESSAGE_STATUSES_TABLE)
      .select("business_id, recipient_phone")
      .eq("status", "failed")
      .gte("status_at", since);
    if (ids.length === 1) query = query.eq("business_id", ids[0]!);
    else if (ids.length > 1) query = query.in("business_id", ids);
    if (unseenOnly) query = query.is("seen_at", null);
    return query.limit(5000);
  };
  let { data, error } = await run(input.unseenOnly === true);
  if (error && input.unseenOnly && isMissingSeenAtColumn(error.message)) {
    ({ data, error } = await run(false));
  }
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
  scope: { businessId: number } | { businessIdBySlug: ReadonlyMap<string, number> },
  options: { unseenOnly?: boolean } = {}
): Promise<Array<T & { hasFailedDelivery?: boolean }>> {
  if (!sessions.length) return sessions;
  const businessIds = "businessId" in scope ? [scope.businessId] : [];
  const failed = await loadFailedDeliveryPhones(admin, {
    businessIds,
    unseenOnly: options.unseenOnly,
  });
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

/**
 * A business user opened the conversation: its failed rows in the lookback get seen_at,
 * so the owner's «failed messages» list drops it until the next failure.
 * One update on (status, status_at), scoped to the business. Never throws.
 */
export async function markFailedDeliverySeen(
  admin: Admin,
  input: { businessId: number; phone?: string | null; sessionId: string; now?: Date }
): Promise<{ ok: boolean; cleared: number; error?: string }> {
  const tail = phoneTail9(input.phone) || phoneTail9(input.sessionId.split("_").pop());
  if (!(input.businessId > 0) || !tail) return { ok: false, cleared: 0, error: "missing_phone" };
  try {
    const { data, error } = await admin
      .from(WA_MESSAGE_STATUSES_TABLE)
      .update({ seen_at: (input.now ?? new Date()).toISOString() })
      .eq("status", "failed")
      .gte("status_at", failedLookbackSince(input.now))
      .eq("business_id", input.businessId)
      .is("seen_at", null)
      .like("recipient_phone", `%${tail}`)
      .select("wamid");
    if (error) {
      console.error(
        isMissingSeenAtColumn(error.message)
          ? "[wa-message-delivery] seen_at missing — run supabase/wa_message_statuses_seen_at.sql"
          : "[wa-message-delivery] failed-seen update failed:",
        error.message
      );
      return { ok: false, cleared: 0, error: error.message };
    }
    return { ok: true, cleared: (data ?? []).length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa-message-delivery] failed-seen update threw:", message);
    return { ok: false, cleared: 0, error: message };
  }
}
