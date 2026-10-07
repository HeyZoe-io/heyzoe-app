import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingSyncLogReasonColumn } from "@/lib/leads/sync-log-reason";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type WriteError = { code?: string; message?: string } | null;

/**
 * Claim the sync-log row before the Graph call.
 * `sending` is terminal: a worker that dies after the claim is not retried.
 * If the status check does not allow `sending` yet, the same claim is stored
 * as `sent` with reason `sending` (same no-retry rule, visible in the daily summary).
 */
export async function claimSyncLogBeforeSend(input: {
  admin: Admin;
  table: string;
  row: Record<string, unknown>;
  filters: Array<[string, string | number]>;
}): Promise<"won" | "lost" | "error"> {
  const inserted = await insertClaim(input.admin, input.table, input.row, "sending");
  if (inserted === "ok") return "won";
  if (inserted === "check") {
    const fallback = await insertClaim(input.admin, input.table, input.row, "sent");
    if (fallback === "ok") return "won";
    if (fallback === "duplicate") return upgradeRetryable(input);
    return "error";
  }
  if (inserted === "duplicate") return upgradeRetryable(input);
  return "error";
}

async function insertClaim(
  admin: Admin,
  table: string,
  row: Record<string, unknown>,
  status: "sending" | "sent"
): Promise<"ok" | "duplicate" | "check" | "error"> {
  const withReason = { ...row, status, reason: "sending" };
  const first = await admin.from(table).insert(withReason);
  if (!first.error) return "ok";
  if (isMissingSyncLogReasonColumn(first.error.message)) {
    const second = await admin.from(table).insert({ ...row, status });
    if (!second.error) return "ok";
    return classify(second.error);
  }
  return classify(first.error);
}

function classify(error: WriteError): "duplicate" | "check" | "error" {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  if (code === "23505" || /duplicate/i.test(message)) return "duplicate";
  if (code === "23514" || /check constraint/i.test(message)) return "check";
  return "error";
}

async function upgradeRetryable(input: {
  admin: Admin;
  table: string;
  row: Record<string, unknown>;
  filters: Array<[string, string | number]>;
}): Promise<"won" | "lost" | "error"> {
  const sending = await updateRetryable(input, "sending");
  if (sending === "won" || sending === "error") return sending;
  if (sending === "check") {
    const fallback = await updateRetryable(input, "sent");
    if (fallback === "won" || fallback === "lost") return fallback;
    return "error";
  }
  return "lost";
}

async function updateRetryable(
  input: {
    admin: Admin;
    table: string;
    filters: Array<[string, string | number]>;
  },
  status: "sending" | "sent"
): Promise<"won" | "lost" | "check" | "error"> {
  const patch: Record<string, unknown> = {
    status,
    reason: "sending",
    processed_at: new Date().toISOString(),
  };
  const first = await filteredUpdate(input, patch);
  if (first.kind === "missing_reason") {
    const rest = { ...patch };
    delete rest.reason;
    const second = await filteredUpdate(input, rest);
    if (second.kind === "ok") return second.won ? "won" : "lost";
    if (second.kind === "check") return "check";
    return "error";
  }
  if (first.kind === "ok") return first.won ? "won" : "lost";
  if (first.kind === "check") return "check";
  return "error";
}

async function filteredUpdate(
  input: {
    admin: Admin;
    table: string;
    filters: Array<[string, string | number]>;
  },
  patch: Record<string, unknown>
): Promise<{ kind: "ok"; won: boolean } | { kind: "missing_reason" } | { kind: "check" } | { kind: "error" }> {
  let query = input.admin.from(input.table).update(patch);
  for (const [column, value] of input.filters) {
    query = query.eq(column, value);
  }
  const { data, error } = await query.in("status", ["pending", "skipped"]).select("status");
  if (!error) return { kind: "ok", won: Array.isArray(data) && data.length > 0 };
  if (isMissingSyncLogReasonColumn(error.message)) return { kind: "missing_reason" };
  if (classify(error) === "check") return { kind: "check" };
  return { kind: "error" };
}
