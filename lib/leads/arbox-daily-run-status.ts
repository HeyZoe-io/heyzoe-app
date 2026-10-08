/**
 * Per business, per day, per slot: did the daily trigger run finish?
 * The 20:30 dispatcher retries an incomplete business once in the same run,
 * then records the outcome. The 20:50 pass (?slot=evening&pass=retry) reruns
 * only businesses still incomplete; sync-log claims keep it from sending twice.
 * IO: one upsert per business per run, one indexed read for the second pass.
 */
import { formatDateYmdIsrael } from "@/lib/leads/arbox-trial-attended";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const ARBOX_DAILY_RUN_STATUS_TABLE = "arbox_daily_run_status";

export type ArboxDailyRunPass = "main" | "retry";

type WorkerRow = {
  business_id: number;
  ok: boolean;
  outcome: string;
  body: unknown;
  error?: string;
};

function isMissingTable(message: string): boolean {
  return /does not exist|42P01|PGRST205|schema cache/i.test(message);
}

/** Steps whose Arbox read failed, so nothing was decided for them. */
export function stepsWithFetchError(summary: unknown): string[] {
  if (!summary || typeof summary !== "object") return [];
  const out: string[] = [];
  for (const [step, value] of Object.entries(summary as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const fetchError = (value as { fetch_error?: unknown }).fetch_error;
    if (typeof fetchError === "string" && fetchError.trim()) out.push(step);
  }
  return out.sort();
}

/** null = the business finished; otherwise why it did not. */
export function workerRunIncomplete(row: WorkerRow): string | null {
  if (row.outcome === "timeout_unknown_outcome") return "timeout_unknown_outcome";
  if (!row.ok) return row.error ? `failed: ${row.error}`.slice(0, 200) : "failed";
  const summary = (row.body as { summary?: unknown } | null)?.summary;
  const steps = stepsWithFetchError(summary);
  return steps.length ? `step_fetch_error: ${steps.join(",")}`.slice(0, 200) : null;
}

/** A timed-out worker may still be running, so only clear failures retry in the same run. */
export function retryableInRun(row: WorkerRow): boolean {
  const reason = workerRunIncomplete(row);
  return reason != null && reason !== "timeout_unknown_outcome";
}

export async function recordArboxDailyRunStatus(input: {
  admin: Admin;
  slot: "morning" | "evening";
  now: Date;
  pass: ArboxDailyRunPass;
  results: ReadonlyArray<WorkerRow & { attempts?: number }>;
}): Promise<{ ok: boolean; incomplete: number[] }> {
  const runDay = formatDateYmdIsrael(input.now);
  const updatedAt = input.now.toISOString();
  const incomplete: number[] = [];
  const rows = input.results.map((row) => {
    const reason = workerRunIncomplete(row);
    if (reason) incomplete.push(row.business_id);
    return {
      business_id: row.business_id,
      run_day: runDay,
      slot: input.slot,
      status: reason ? "incomplete" : "ok",
      reason,
      attempts: row.attempts ?? 1,
      pass: input.pass,
      updated_at: updatedAt,
    };
  });
  if (incomplete.length) {
    console.error("[cron/arbox-daily-triggers] businesses incomplete", {
      slot: input.slot,
      pass: input.pass,
      run_day: runDay,
      businesses: rows.filter((row) => row.reason).map((row) => ({ business_id: row.business_id, reason: row.reason })),
    });
  }
  if (!rows.length) return { ok: true, incomplete };
  const { error } = await input.admin
    .from(ARBOX_DAILY_RUN_STATUS_TABLE)
    .upsert(rows, { onConflict: "business_id,run_day,slot" });
  if (error) {
    console.error(
      isMissingTable(error.message)
        ? "[cron/arbox-daily-triggers] run status table missing, run supabase/arbox_daily_run_status.sql"
        : "[cron/arbox-daily-triggers] run status write failed:",
      error.message
    );
    return { ok: false, incomplete };
  }
  return { ok: true, incomplete };
}

export async function loadIncompleteBusinessIds(input: {
  admin: Admin;
  slot: "morning" | "evening";
  now: Date;
}): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  const { data, error } = await input.admin
    .from(ARBOX_DAILY_RUN_STATUS_TABLE)
    .select("business_id")
    .eq("run_day", formatDateYmdIsrael(input.now))
    .eq("slot", input.slot)
    .eq("status", "incomplete");
  if (error) {
    console.error("[cron/arbox-daily-triggers] run status read failed:", error.message);
    return { ok: false, error: isMissingTable(error.message) ? "run_status_table_missing" : error.message };
  }
  const ids = (data ?? [])
    .map((row) => Number((row as { business_id?: unknown }).business_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  return { ok: true, ids: [...new Set(ids)].sort((a, b) => a - b) };
}

/** Admin summary input: last 24h of runs that did not finish. */
export async function loadIncompleteRunsSince(
  admin: Admin,
  sinceIso: string
): Promise<Array<{ business_id: number; run_day: string; slot: string; reason: string; updated_at: string }>> {
  const { data, error } = await admin
    .from(ARBOX_DAILY_RUN_STATUS_TABLE)
    .select("business_id, run_day, slot, reason, updated_at")
    .eq("status", "incomplete")
    .gte("updated_at", sinceIso)
    .limit(200);
  if (error) {
    if (!isMissingTable(error.message)) console.error("[admin-daily-unsent] run status read failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    business_id: Number((row as { business_id?: unknown }).business_id),
    run_day: String((row as { run_day?: unknown }).run_day ?? ""),
    slot: String((row as { slot?: unknown }).slot ?? ""),
    reason: String((row as { reason?: unknown }).reason ?? ""),
    updated_at: String((row as { updated_at?: unknown }).updated_at ?? ""),
  }));
}
