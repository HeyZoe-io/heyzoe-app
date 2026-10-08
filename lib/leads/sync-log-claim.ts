import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { activeSendPlan, isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { isMissingSyncLogReasonColumn, syncLogStatusFallbacks } from "@/lib/leads/sync-log-reason";
import { isSendsHoldError } from "@/lib/business-sends-hold";
import { isSendOutcomeUnknown, SEND_OUTCOME_UNKNOWN } from "@/lib/notifications/graph-whatsapp-send";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type WriteError = { code?: string; message?: string } | null;

type Filters = Array<[string, string | number]>;

/** skipped / abandoned / canceled / unknown are final for the event key. */
const DEFAULT_RETRYABLE: readonly string[] = ["pending", "failed"];

/** Meta failures before a claim is abandoned. Same cap as the cancellation log. */
export const SYNC_LOG_SEND_ATTEMPT_CAP = 3;

/** Column named in a PostgREST (PGRST204) or Postgres (42703) missing-column error. */
export function missingColumnFromError(error: WriteError): string | null {
  const message = String(error?.message ?? "");
  const cache = /could not find the '([^']+)' column/i.exec(message);
  if (cache) return cache[1]!;
  const pg = /column "?(?:[a-z0-9_]+\.)?([a-z0-9_]+)"?(?: of relation "[^"]+")? does not exist/i.exec(message);
  if (pg) return pg[1]!;
  if (isMissingSyncLogReasonColumn(message)) return "reason";
  return null;
}

/**
 * Retry the same write without a column the table does not have yet.
 * Identity columns are never dropped. `dropped` tells the caller what was removed.
 */
async function writeWithoutMissingColumns(
  payload: Record<string, unknown>,
  keep: ReadonlySet<string>,
  run: (payload: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: WriteError }>
): Promise<{ data?: unknown; error: WriteError; dropped: Set<string> }> {
  const current = { ...payload };
  const dropped = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    const result = await run(current);
    if (!result.error) return { data: result.data, error: null, dropped };
    const column = missingColumnFromError(result.error);
    if (!column || keep.has(column) || !(column in current)) {
      return { error: result.error, dropped };
    }
    delete current[column];
    dropped.add(column);
  }
  return { error: { message: "too_many_missing_columns" }, dropped };
}

function classify(error: WriteError): "duplicate" | "check" | "error" {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  if (code === "23505" || /duplicate/i.test(message)) return "duplicate";
  if (code === "23514" || /check constraint/i.test(message)) return "check";
  return "error";
}

function identity(filters: Filters): Set<string> {
  return new Set(filters.map(([column]) => column));
}

/**
 * Claim the sync-log row before the Graph call.
 * `sending` is terminal: a worker that dies after the claim is not retried.
 * If the status check does not allow `sending` yet, the same claim is stored
 * as `sent` with reason `sending` (same no-retry rule, visible in the daily summary).
 * A table without a status column: the inserted row is the claim, and any
 * existing row means the event was handled.
 */
export async function claimSyncLogBeforeSend(input: {
  admin: Admin;
  table: string;
  row: Record<string, unknown>;
  filters: Filters;
  /** Existing statuses a new run may take over. Default: pending, failed. */
  retryable?: readonly string[];
}): Promise<"won" | "lost" | "error"> {
  const inserted = await insertClaim(input, "sending");
  if (inserted === "ok") return "won";
  if (inserted === "legacy_duplicate") return "lost";
  if (inserted === "check") {
    const fallback = await insertClaim(input, "sent");
    if (fallback === "ok") return "won";
    if (fallback === "duplicate") return upgradeRetryable(input);
    return "error";
  }
  if (inserted === "duplicate") return upgradeRetryable(input);
  return "error";
}

async function insertClaim(
  input: { admin: Admin; table: string; row: Record<string, unknown>; filters: Filters },
  status: "sending" | "sent"
): Promise<"ok" | "duplicate" | "legacy_duplicate" | "check" | "error"> {
  const result = await writeWithoutMissingColumns(
    { ...input.row, status, reason: "sending" },
    identity(input.filters),
    (payload) => input.admin.from(input.table).insert(payload)
  );
  if (!result.error) return "ok";
  const kind = classify(result.error);
  if (kind === "duplicate" && result.dropped.has("status")) return "legacy_duplicate";
  if (kind === "error") {
    console.error(`[sync-log-claim] ${input.table} claim insert failed:`, result.error.message);
  }
  return kind;
}

async function upgradeRetryable(input: {
  admin: Admin;
  table: string;
  filters: Filters;
  retryable?: readonly string[];
}): Promise<"won" | "lost" | "error"> {
  if (input.retryable && input.retryable.length === 0) return "lost";
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
  input: { admin: Admin; table: string; filters: Filters; retryable?: readonly string[] },
  status: "sending" | "sent"
): Promise<"won" | "lost" | "check" | "error"> {
  const keep = identity(input.filters);
  keep.add("status");
  const result = await writeWithoutMissingColumns(
    { status, reason: "sending", processed_at: new Date().toISOString() },
    keep,
    (patch) => {
      let query = input.admin.from(input.table).update(patch);
      for (const [column, value] of input.filters) query = query.eq(column, value);
      return query.in("status", [...(input.retryable ?? DEFAULT_RETRYABLE)]).select("status");
    }
  );
  if (!result.error) return Array.isArray(result.data) && result.data.length > 0 ? "won" : "lost";
  if (classify(result.error) === "check") return "check";
  console.error(`[sync-log-claim] ${input.table} claim upgrade failed:`, result.error.message);
  return "error";
}

/** unknown: the request may have reached Meta. Final, never retried. */
export type SyncLogSettle = "sent" | "failed" | "skipped" | "release" | "unknown";

/** A row the next run may claim again. Missing status (older tables) means handled. */
export function syncLogRowRetryable(status: unknown): boolean {
  const value = String(status ?? "").trim();
  return value === "failed" || value === "pending";
}

/**
 * Trigger dispatch → claim outcome. gated (hold, mute, no channel, template
 * not approved) releases the claim so a later run can send.
 */
export function claimSettleForDispatch(dispatch: string): SyncLogSettle {
  if (dispatch === "immediate" || dispatch === "deferred") return "sent";
  if (dispatch === "send_failed") return "failed";
  if (dispatch === "send_unknown") return "unknown";
  if (dispatch === "gated") return "release";
  return "skipped";
}

/** A send error → claim outcome: hold releases, unknown is final, a Meta error is retried. */
export function settleForSendError(error: unknown): SyncLogSettle {
  if (isSendsHoldError(error)) return "release";
  if (isSendOutcomeUnknown(error)) return "unknown";
  return "failed";
}

/**
 * Close a claim this worker won.
 * sent / skipped / unknown: final. failed: retried by the next run until the attempt cap,
 * then abandoned. release: the claim row is removed (a hold, not a send).
 */
export async function settleSyncLogClaim(input: {
  admin: Admin;
  table: string;
  row: Record<string, unknown>;
  filters: Filters;
  outcome: SyncLogSettle;
  reason?: string | null;
  attemptCap?: number;
}): Promise<boolean> {
  if (input.outcome === "release") return releaseSyncLogClaim(input);
  let attemptsSoFar = Math.max(0, Math.trunc(Number(input.row.attempts) || 0));
  if (input.outcome === "failed") attemptsSoFar = Math.max(attemptsSoFar, await storedAttempts(input));
  let status: string = input.outcome;
  let attempts = attemptsSoFar;
  if (input.outcome === "failed") {
    attempts = attemptsSoFar + 1;
    if (attempts >= (input.attemptCap ?? SYNC_LOG_SEND_ATTEMPT_CAP)) status = "abandoned";
  }
  const onConflict = input.filters.map(([column]) => column).join(",");
  const upsert = (payload: Record<string, unknown>) =>
    writeWithoutMissingColumns(payload, identity(input.filters), (body) =>
      input.admin.from(input.table).upsert(body, { onConflict })
    );
  const processedAt = new Date().toISOString();
  let lastMessage = "";
  for (const attempt of syncLogStatusFallbacks(status, input.reason ?? null)) {
    const result = await upsert({
      ...input.row,
      status: attempt.status,
      attempts,
      reason: attempt.reason ?? null,
      processed_at: processedAt,
    });
    if (!result.error) {
      // No status column yet: a failed send leaves no row, as before the claim existed.
      if ((status === "failed" || status === "abandoned") && result.dropped.has("status")) {
        return releaseSyncLogClaim(input);
      }
      return true;
    }
    lastMessage = String(result.error.message ?? "");
    if (classify(result.error) !== "check") break;
  }
  console.error(`[sync-log-claim] ${input.table} settle ${status} failed:`, lastMessage);
  return false;
}

/** Attempts already on the claimed row, so a caller that did not pass them still reaches the cap. */
async function storedAttempts(input: { admin: Admin; table: string; filters: Filters }): Promise<number> {
  let query = input.admin.from(input.table).select("attempts");
  for (const [column, value] of input.filters) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) return 0;
  return Math.max(0, Math.trunc(Number((data as { attempts?: unknown } | null)?.attempts) || 0));
}

async function releaseSyncLogClaim(input: {
  admin: Admin;
  table: string;
  filters: Filters;
}): Promise<boolean> {
  const remove = (extra: Array<[string, string]>) => {
    let query = input.admin.from(input.table).delete();
    for (const [column, value] of input.filters) query = query.eq(column, value);
    for (const [column, value] of extra) query = query.eq(column, value);
    return query;
  };
  const first = await remove([["status", "sending"]]);
  if (first.error) {
    if (missingColumnFromError(first.error) === "status") {
      const bare = await remove([]);
      if (!bare.error) return true;
      console.error(`[sync-log-claim] ${input.table} release failed:`, bare.error.message);
      return false;
    }
    console.error(`[sync-log-claim] ${input.table} release failed:`, first.error.message);
    return false;
  }
  const fallback = await remove([
    ["status", "sent"],
    ["reason", "sending"],
  ]);
  if (fallback.error && missingColumnFromError(fallback.error) !== "reason") {
    console.error(`[sync-log-claim] ${input.table} release failed:`, fallback.error.message);
    return false;
  }
  return true;
}

/**
 * Claim, send once, settle. A send that throws leaves the claim at `sending`,
 * so it is never sent again. Dry-run skips the claim and the settle.
 */
export async function sendWithSyncLogClaim<T>(input: {
  admin: Admin;
  table: string;
  row: Record<string, unknown>;
  filters: Filters;
  retryable?: readonly string[];
  attemptCap?: number;
  send: () => Promise<{
    settle: SyncLogSettle;
    reason?: string | null;
    value: T;
    /** Extra columns written with the settle (e.g. confirm_status). */
    row?: Record<string, unknown>;
  }>;
}): Promise<{ claim: "won" | "lost" | "error"; value?: T }> {
  if (isArboxDailyDryRun()) {
    const result = await input.send();
    return { claim: "won", value: result.value };
  }
  const claim = await claimSyncLogBeforeSend(input);
  if (claim !== "won") return { claim };
  const result = await input.send();
  await settleSyncLogClaim({
    ...input,
    row: { ...input.row, ...result.row },
    outcome: result.settle,
    reason: result.reason,
  });
  return { claim, value: result.value };
}

/**
 * A queued template the immediate path sends itself: pending → sending before
 * the Graph call, so the Stage C drain (pending only) cannot send it too.
 */
export async function claimQueuedTemplateSend(
  admin: Admin,
  dedupKey: string,
  /** pending (Stage C) or planned (DISPATCH of a PLAN row). */
  from: "pending" | "planned" = "pending"
): Promise<"won" | "lost" | "error"> {
  const key = dedupKey.trim();
  if (!key) return "error";
  if (from === "pending") activeSendPlan()?.noteQueueClaim(key);
  if (isArboxDailyDryRun()) return "won";
  const { data, error } = await admin
    .from("scheduled_template_sends")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("dedup_key", key)
    .eq("status", from)
    .select("id");
  if (error) {
    console.error("[sync-log-claim] queued claim failed:", error.message);
    return "error";
  }
  return Array.isArray(data) && data.length > 0 ? "won" : "lost";
}

/**
 * sent: final. failed / release: back to pending so the drain retries it
 * with `lastError` (failed defaults to send_failed). unknown: final
 * (`unknown`, or `failed` + send_outcome_unknown before the status SQL).
 * Only a row this worker holds at `sending` moves.
 */
export async function settleQueuedTemplateSend(
  admin: Admin,
  dedupKey: string,
  outcome: "sent" | "failed" | "release" | "unknown",
  lastError?: string | null,
  /** The status this worker holds the row at. A path that sends without claiming passes pending. */
  heldAt: "sending" | "pending" = "sending"
): Promise<boolean> {
  const key = dedupKey.trim();
  if (!key || isArboxDailyDryRun()) return true;
  const patches: Array<Record<string, unknown>> =
    outcome === "sent"
      ? [{ status: "sent", last_error: null }]
      : outcome === "unknown"
        ? [
            { status: "unknown", last_error: lastError || SEND_OUTCOME_UNKNOWN },
            { status: "failed", last_error: lastError || SEND_OUTCOME_UNKNOWN },
          ]
        : [{ status: "pending", last_error: outcome === "failed" ? lastError || "send_failed" : lastError ?? null }];
  let lastMessage = "";
  for (const patch of patches) {
    const { error } = await admin
      .from("scheduled_template_sends")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("dedup_key", key)
      .eq("status", heldAt);
    if (!error) return true;
    lastMessage = error.message;
    if (classify(error) !== "check") break;
  }
  console.error("[sync-log-claim] queued settle failed:", lastMessage);
  return false;
}
