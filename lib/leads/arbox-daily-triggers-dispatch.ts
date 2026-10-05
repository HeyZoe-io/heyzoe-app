import { resolveCronSecret } from "@/lib/server-env";

/**
 * Under the dispatcher maxDuration (300s) so "dispatch done" is always logged.
 * A worker that is still running keeps going on its own invocation.
 */
export const ARBOX_DAILY_WORKER_ABORT_MS = 285_000;

/**
 * Trigger types this cron's steps actually run.
 * no_response, arbox_new_lead, incoming_lead, and credit_refusal are other jobs.
 */
export const ARBOX_DAILY_TRIGGER_TYPES = [
  "birthday",
  "birthday_former",
  "milestones",
  "membership_expiring",
  "missed_class",
  "missed_trial",
  "attendance_gap",
  "registered_after_trial",
  "not_registered_after_trial",
  "nth_workout",
  "freeze_created",
  "freeze_ending_booked",
  "freeze_ending_unbooked",
  "trial_reminder",
  "trainer_trial_heads_up",
  "class_cancelled_staff",
  "sessions_expiring",
  "lost_lead",
] as const;

/**
 * Steps in this cron that suppress a send when the person has an active Arbox product
 * (ef962ef7). no_response / arbox_new_lead / incoming_lead are in the shared constant
 * but are not steps of this cron, so they do not trigger the prefetch here.
 */
export const ARBOX_DAILY_ACTIVE_PRODUCT_TRIGGER_TYPES = [
  "birthday_former",
  "lost_lead",
  "missed_trial",
  "not_registered_after_trial",
] as const;

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

/**
 * Production uses NEXT_PUBLIC_SITE_URL (same host cron-job.org already calls;
 * falls back to https://heyzoe.io, matching conversation-quota). Not VERCEL_URL:
 * that hostname is the deployment URL and Deployment Protection blocks preview
 * self-calls. Localhost uses the incoming host so dry_run hits this process.
 */
export function resolveArboxDailyWorkerOrigin(req: {
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

export function arboxDailyWorkerUrl(origin: string, businessId: number, dryRun: boolean): string {
  const base = origin.endsWith("/") ? origin : `${origin}/`;
  const url = new URL("/api/cron/arbox-daily-triggers/business", base);
  url.searchParams.set("business_id", String(businessId));
  if (dryRun) url.searchParams.set("dry_run", "1");
  return url.toString();
}

export async function dispatchArboxDailyWorkers(input: {
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
  console.info("[cron/arbox-daily-triggers] dispatch done", {
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
  const url = arboxDailyWorkerUrl(input.origin, businessId, input.dryRun);
  const secret = resolveCronSecret();
  const authorization =
    input.authorization ?? (secret ? `Bearer ${secret}` : null);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authorization ? { Authorization: authorization } : {},
      signal: AbortSignal.timeout(ARBOX_DAILY_WORKER_ABORT_MS),
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

/** AbortSignal.timeout rejects with TimeoutError, or AbortError on some runtimes. */
function isWorkerAbortTimeout(e: unknown): boolean {
  if (!e || typeof e !== "object" || !("name" in e)) return false;
  const name = String((e as { name?: unknown }).name);
  return name === "TimeoutError" || name === "AbortError";
}
