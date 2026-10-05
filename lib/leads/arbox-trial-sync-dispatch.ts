import { resolveCronSecret } from "@/lib/server-env";

/**
 * Same fan-out as arbox-daily-triggers (28 Sep): the dispatcher returns immediately,
 * and each business runs in its own invocation. Abort stays under the dispatcher
 * maxDuration so "dispatch done" is logged while a slow worker keeps its own isolate.
 */
export const ARBOX_TRIAL_SYNC_WORKER_ABORT_MS = 285_000;

export type WorkerDispatchOutcome = "ok" | "failed" | "timeout_unknown_outcome";

export type WorkerDispatchResult = {
  business_id: number;
  http: number;
  elapsed_ms: number;
  ok: boolean;
  outcome: WorkerDispatchOutcome;
  body: unknown;
  error?: string;
};

export function resolveArboxTrialSyncWorkerOrigin(req: {
  headers: { get(name: string): string | null };
}): string {
  const host = (req.headers.get("host") ?? "").trim();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return site.replace(/\/$/, "");
  return "https://heyzoe.io";
}

export function arboxTrialSyncWorkerUrl(origin: string, businessId: number, dryRun: boolean): string {
  const base = origin.endsWith("/") ? origin : `${origin}/`;
  const url = new URL("/api/cron/arbox-trial-sync/business", base);
  url.searchParams.set("business_id", String(businessId));
  if (dryRun) url.searchParams.set("dry_run", "1");
  return url.toString();
}

export async function dispatchArboxTrialSyncWorkers(input: {
  origin: string;
  businessIds: number[];
  dryRun: boolean;
  authorization: string | null;
}): Promise<{ total_ms: number; businesses: WorkerDispatchResult[] }> {
  const started = Date.now();
  const settled = await Promise.allSettled(input.businessIds.map((id) => callWorker(input, id)));
  const businesses: WorkerDispatchResult[] = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const reason = result.reason;
    return {
      business_id: input.businessIds[index] ?? 0,
      http: 0,
      elapsed_ms: 0,
      ok: false,
      outcome: "failed",
      body: null,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  });
  const total_ms = Date.now() - started;
  console.info("[cron/arbox-trial-sync] dispatch done", {
    total_ms,
    dry_run: input.dryRun,
    businesses: businesses.map((row) => ({
      business_id: row.business_id,
      http: row.http,
      elapsed_ms: row.elapsed_ms,
      result: row.outcome,
      ...(row.error ? { error: row.error } : {}),
    })),
  });
  return { total_ms, businesses };
}

async function callWorker(
  input: {
    origin: string;
    dryRun: boolean;
    authorization: string | null;
  },
  businessId: number
): Promise<WorkerDispatchResult> {
  const started = Date.now();
  const url = arboxTrialSyncWorkerUrl(input.origin, businessId, input.dryRun);
  const secret = resolveCronSecret();
  const authorization = input.authorization ?? (secret ? `Bearer ${secret}` : null);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authorization ? { Authorization: authorization } : {},
      signal: AbortSignal.timeout(ARBOX_TRIAL_SYNC_WORKER_ABORT_MS),
    });
    const body = await res.json().catch(() => null);
    return {
      business_id: businessId,
      http: res.status,
      elapsed_ms: Date.now() - started,
      ok: res.ok,
      outcome: res.ok ? "ok" : "failed",
      body,
    };
  } catch (e) {
    const timedOut = isWorkerAbortTimeout(e);
    return {
      business_id: businessId,
      http: 0,
      elapsed_ms: Date.now() - started,
      ok: false,
      outcome: timedOut ? "timeout_unknown_outcome" : "failed",
      body: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function isWorkerAbortTimeout(e: unknown): boolean {
  if (!e || typeof e !== "object" || !("name" in e)) return false;
  const name = String((e as { name?: unknown }).name);
  return name === "TimeoutError" || name === "AbortError";
}
