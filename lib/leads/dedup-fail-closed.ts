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
  if (input.existingAttempts == null) {
    const { error } = await input.admin.from(input.table).insert(input.insertRow);
    return claimInsertOutcome(error);
  }
  let query = input.admin.from(input.table).update({
    attempts: input.existingAttempts + 1,
    processed_at: input.nowIso,
  });
  for (const [column, value] of input.filters) {
    query = query.eq(column, value);
  }
  const { data, error } = await query
    .eq("status", "pending")
    .eq("attempts", input.existingAttempts)
    .select("status");
  if (error) return "error";
  return Array.isArray(data) && data.length > 0 ? "won" : "lost";
}
