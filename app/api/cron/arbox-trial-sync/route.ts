import { after, NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import {
  acknowledgeCron,
  cronDryRunNow,
  rejectCronTimeOverride,
} from "@/lib/cron-clock";
import {
  dispatchArboxTrialSyncWorkers,
  resolveArboxTrialSyncWorkerOrigin,
} from "@/lib/leads/arbox-trial-sync-dispatch";
import { holdArboxBackgroundClocks } from "@/lib/arbox-background-pause";
import { listArboxTrialSyncBusinessIds } from "@/lib/leads/arbox-trial-sync-run";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Frequent Arbox dispatcher (purchase, credit refusal, new lead, trial booking).
 * Delay-0 «נרשם אחרי ניסיון» reuses this run's sales rows; bookings are fetched
 * only when that batch has a non-trial plan/session sale.
 * Scheduling: cron-job.org GET (not Vercel crons — Hobby). Bearer CRON_SECRET.
 * Returns immediately. Each eligible business runs in its own worker via after()
 * → GET /api/cron/arbox-trial-sync/business. Same URL cron-job.org already calls.
 * ?dry_run=1 awaits the workers in this request and does not write.
 * A business with arbox_background_paused gets no worker. Each live tick
 * moves its catch-up clocks to now (lib/arbox-background-pause.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-trial-sync] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rejected = rejectCronTimeOverride(req, true);
  if (rejected) return rejected;

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const now = cronDryRunNow(req);
  const startedAt = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  const listed = await listArboxTrialSyncBusinessIds(admin);
  if (!listed.ok) {
    console.error("[cron/arbox-trial-sync] businesses query failed:", listed.error);
    return NextResponse.json({ ok: false, error: "businesses_query_failed" }, { status: 500 });
  }

  const ids = listed.ids;
  const origin = resolveArboxTrialSyncWorkerOrigin(req);
  const authorization = req.headers.get("authorization");
  const fanOut = () =>
    dispatchArboxTrialSyncWorkers({
      origin,
      businessIds: ids,
      dryRun,
      authorization,
      nowIso: now?.toISOString(),
    });

  if (dryRun) {
    const dispatched = await fanOut();
    await acknowledgeCron(req, "/api/cron/arbox-trial-sync", null);
    return NextResponse.json({
      accepted: true,
      dry_run: true,
      businesses: ids,
      arbox_background_paused: listed.paused,
      started_at: startedAt,
      total_ms: dispatched.total_ms,
      results: dispatched.businesses,
    });
  }

  if (ids.length) after(() => fanOut());
  if (listed.paused.length) await holdArboxBackgroundClocks(admin, listed.paused, new Date());

  await acknowledgeCron(req, "/api/cron/arbox-trial-sync", null);

  return NextResponse.json({
    accepted: true,
    businesses: ids,
    arbox_background_paused: listed.paused,
    started_at: startedAt,
  });
}
