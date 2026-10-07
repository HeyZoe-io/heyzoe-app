import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The column is not there yet. Retry the same write without it. */
export function isMissingSyncLogReasonColumn(message: string): boolean {
  return /reason/i.test(message) && /schema cache|does not exist|PGRST204|column/i.test(message);
}

export async function upsertOptionalReason(
  admin: Admin,
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
  reason?: string | null
): Promise<{ ok: boolean }> {
  const payload = reason === undefined ? row : { ...row, reason };
  const first = await admin.from(table).upsert(payload, { onConflict });
  if (!first.error) return { ok: true };
  if (reason !== undefined && isMissingSyncLogReasonColumn(first.error.message)) {
    const second = await admin.from(table).upsert(row, { onConflict });
    if (!second.error) return { ok: true };
    console.error(`[${table}] sync_log upsert failed:`, second.error.message);
    return { ok: false };
  }
  if (payload.status === "failed" && isSyncLogStatusCheck(first.error)) {
    const fallback = await admin.from(table).upsert(
      { ...payload, status: "pending", reason: payload.reason ?? "failed" },
      { onConflict }
    );
    if (!fallback.error) return { ok: true };
    if (isMissingSyncLogReasonColumn(fallback.error.message)) {
      const rest = { ...payload };
      delete rest.reason;
      const bare = await admin.from(table).upsert({ ...rest, status: "pending" }, { onConflict });
      if (!bare.error) return { ok: true };
    }
  }
  console.error(`[${table}] sync_log upsert failed:`, first.error.message);
  return { ok: false };
}

function isSyncLogStatusCheck(error: { code?: string; message?: string }): boolean {
  return String(error.code ?? "") === "23514" || /check constraint/i.test(String(error.message ?? ""));
}
