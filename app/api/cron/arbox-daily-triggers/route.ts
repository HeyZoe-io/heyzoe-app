import { after, NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import {
  dispatchArboxDailyWorkers,
  resolveArboxDailyWorkerOrigin,
} from "@/lib/leads/arbox-daily-triggers-dispatch";
import { listArboxDailyBusinessIds } from "@/lib/leads/arbox-daily-triggers-run";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Daily Arbox trigger dispatcher.
 * Scheduling: cron-job.org GET (not Vercel crons — Hobby). Bearer CRON_SECRET.
 * Returns immediately. Each eligible business runs in its own worker invocation
 * via after() → GET /api/cron/arbox-daily-triggers/business.
 * ?dry_run=1 awaits the workers in this request and does not send or write.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-daily-triggers] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const startedAt = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  const listed = await listArboxDailyBusinessIds(admin);
  if (!listed.ok) {
    console.error("[cron/arbox-daily-triggers] businesses query failed:", listed.error);
    return NextResponse.json({ ok: false, error: "businesses_query_failed" }, { status: 500 });
  }

  const ids = listed.ids;
  const origin = resolveArboxDailyWorkerOrigin(req);
  const authorization = req.headers.get("authorization");
  const fanOut = () =>
    dispatchArboxDailyWorkers({
      origin,
      businessIds: ids,
      dryRun,
      authorization,
    });

  if (dryRun) {
    const dispatched = await fanOut();
    return NextResponse.json({
      accepted: true,
      dry_run: true,
      businesses: ids,
      started_at: startedAt,
      total_ms: dispatched.total_ms,
      results: dispatched.businesses,
    });
  }

  if (ids.length) after(() => fanOut());

  return NextResponse.json({
    accepted: true,
    businesses: ids,
    started_at: startedAt,
  });
}
