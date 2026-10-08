import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { SEND_OUTCOME_UNKNOWN } from "@/lib/notifications/graph-whatsapp-send";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The column is not there yet. Retry the same write without it. */
export function isMissingSyncLogReasonColumn(message: string): boolean {
  return /reason/i.test(message) && /schema cache|does not exist|PGRST204|column/i.test(message);
}

/**
 * Status / reason pairs to try in order when the table's status check does not
 * allow the first one yet. None of the fallbacks is retried by a later run:
 * unknown → sending → sent (both with reason send_outcome_unknown); failed → pending.
 */
export function syncLogStatusFallbacks(
  status: unknown,
  reason: string | null | undefined
): Array<{ status: string; reason: string | null | undefined }> {
  const value = String(status ?? "");
  if (value === "unknown") {
    return [
      { status: "unknown", reason: reason ?? SEND_OUTCOME_UNKNOWN },
      { status: "sending", reason: SEND_OUTCOME_UNKNOWN },
      { status: "sent", reason: SEND_OUTCOME_UNKNOWN },
    ];
  }
  if (value === "failed") {
    return [
      { status: "failed", reason },
      { status: "pending", reason: reason ?? "failed" },
    ];
  }
  return [{ status: value, reason }];
}

/**
 * One sync-log upsert. A missing reason column drops the reason; a status the
 * check does not allow yet moves to the next fallback.
 */
export async function upsertOptionalReason(
  admin: Admin,
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
  reason?: string | null,
  options?: { ignoreDuplicates?: boolean }
): Promise<{ ok: boolean }> {
  const attempts = row.status === undefined ? [{ status: undefined, reason }] : syncLogStatusFallbacks(row.status, reason);
  let dropReason = false;
  let lastMessage = "";
  for (const attempt of attempts) {
    for (let pass = 0; pass < 2; pass += 1) {
      const payload: Record<string, unknown> = { ...row };
      if (attempt.status !== undefined) payload.status = attempt.status;
      if (attempt.reason !== undefined && !dropReason) payload.reason = attempt.reason;
      if (dropReason) delete payload.reason;
      const result = await admin
        .from(table)
        .upsert(payload, { onConflict, ...(options?.ignoreDuplicates ? { ignoreDuplicates: true } : {}) });
      if (!result.error) return { ok: true };
      lastMessage = result.error.message;
      if (!dropReason && "reason" in payload && isMissingSyncLogReasonColumn(result.error.message)) {
        dropReason = true;
        continue;
      }
      if (isSyncLogStatusCheck(result.error)) break;
      console.error(`[${table}] sync_log upsert failed:`, result.error.message);
      return { ok: false };
    }
  }
  console.error(`[${table}] sync_log upsert failed:`, lastMessage);
  return { ok: false };
}

export function isSyncLogStatusCheck(error: { code?: string; message?: string }): boolean {
  return String(error.code ?? "") === "23514" || /check constraint/i.test(String(error.message ?? ""));
}
