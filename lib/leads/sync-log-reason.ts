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
  const payload = reason ? { ...row, reason } : row;
  const first = await admin.from(table).upsert(payload, { onConflict });
  if (!first.error) return { ok: true };
  if (reason && isMissingSyncLogReasonColumn(first.error.message)) {
    const second = await admin.from(table).upsert(row, { onConflict });
    if (!second.error) return { ok: true };
    console.error(`[${table}] sync_log upsert failed:`, second.error.message);
    return { ok: false };
  }
  console.error(`[${table}] sync_log upsert failed:`, first.error.message);
  return { ok: false };
}
