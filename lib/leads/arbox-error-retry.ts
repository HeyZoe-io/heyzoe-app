/**
 * An Arbox check that fails in the middle of a decision leaves a retryable row
 * (status pending, reason arbox_error) instead of a silent `continue`.
 * The check is retried once in the same run; the row is retried by the next run
 * and listed in the admin daily summary until it is decided.
 * IO: one extra Arbox read only when the first one failed.
 */
import { upsertOptionalReason } from "@/lib/leads/sync-log-reason";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const ARBOX_ERROR_REASON = "arbox_error";

export async function retryArboxOnce<T extends { ok: boolean }>(label: string, load: () => Promise<T>): Promise<T> {
  const first = await load();
  if (first.ok) return first;
  console.warn(`[${label}] Arbox check failed, retrying once in this run`);
  return load();
}

/** Insert-only: a row already written for this event (sent, sending, skipped, …) is kept. */
export async function writeArboxErrorRows(input: {
  admin: Admin;
  table: string;
  onConflict: string;
  rows: Record<string, unknown>[];
}): Promise<number> {
  let failed = 0;
  for (const row of input.rows) {
    const result = await upsertOptionalReason(
      input.admin,
      input.table,
      { ...row, status: "pending" },
      input.onConflict,
      ARBOX_ERROR_REASON,
      { ignoreDuplicates: true }
    );
    if (!result.ok) failed += 1;
  }
  if (failed) console.error("[arbox-error-retry] row write failed", { table: input.table, failed });
  return failed;
}
