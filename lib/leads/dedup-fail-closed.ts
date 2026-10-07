import { noteDuplicateBlockAlarm } from "@/lib/leads/duplicate-block-alarm";
import { claimSyncLogBeforeSend } from "@/lib/leads/sync-log-claim";

/** A dedup read or claim failed. Callers must not send. */
export function logDedupBlockedSend(input: {
  log: string;
  businessId: number | string | null;
  triggerId?: string | null;
  reason: string;
}): void {
  console.error(input.log, "dedup blocked send", {
    business_id: input.businessId,
    trigger_id: input.triggerId ?? null,
    reason: input.reason,
  });
  noteDuplicateBlockAlarm({
    businessId: input.businessId,
    triggerId: input.triggerId,
    reason: input.reason,
  });
}

type ClaimError = { code?: string; message?: string };

type ClaimResult = PromiseLike<{ data?: unknown; error: ClaimError | null }>;

type ClaimQuery = {
  eq: (column: string, value: unknown) => ClaimQuery;
  select: (columns: string) => ClaimResult;
};

type ClaimTable = {
  insert: (row: Record<string, unknown>) => ClaimResult;
  update: (row: Record<string, unknown>) => ClaimQuery;
};

/** First insert wins. A conflict or any other error means this run must not send. */
export function claimInsertOutcome(error: ClaimError | null): "won" | "lost" | "error" {
  if (!error) return "won";
  if (String(error.code ?? "") === "23505" || /duplicate/i.test(error.message ?? "")) return "lost";
  return "error";
}

/**
 * Claim a sync-log row before sending.
 * No row yet → insert `pending`. An existing `pending` row → one worker bumps
 * `attempts` under a matching filter; the others lose and must not send.
 */
export async function claimPendingSyncLog(input: {
  admin: { from: (table: string) => ClaimTable };
  table: string;
  insertRow: Record<string, unknown>;
  filters: Array<[string, string | number]>;
  existingAttempts: number | null;
  nowIso: string;
}): Promise<"won" | "lost" | "error"> {
  const row = { ...input.insertRow };
  delete row.status;
  delete row.reason;
  if (input.existingAttempts != null) row.attempts = input.existingAttempts;
  return claimSyncLogBeforeSend({
    admin: input.admin as never,
    table: input.table,
    row,
    filters: input.filters,
  });
}
