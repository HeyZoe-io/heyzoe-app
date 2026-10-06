import { after, NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import {
  dispatchArboxDailyWorkers,
  resolveArboxDailyWorkerOrigin,
} from "@/lib/leads/arbox-daily-triggers-dispatch";
import { parseTrialReminderSlot } from "@/lib/leads/arbox-trial-reminder";
import { listArboxDailyBusinessIds } from "@/lib/leads/arbox-daily-triggers-run";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Daily Arbox trigger dispatcher.
 * Scheduling: cron-job.org GET (not Vercel crons — Hobby). Bearer CRON_SECRET.
 * Returns immediately. Each eligible business runs in its own worker invocation
 * via after() → GET /api/cron/arbox-daily-triggers/business.
 * ?dry_run=1 awaits the workers in this request and does not send or write.
 * ?slot=evening is the 20:30 Asia/Jerusalem job (cron-job.org). The slot is the
 * query param, not the clock hour. It must finish before the 21:00 night hold.
 * No param (or slot=morning) is the existing 09:00 job. Scheduling: cron-job.org.
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
  const slot = parseTrialReminderSlot(req.nextUrl.searchParams.get("slot"));
  if (slot === "invalid") {
    return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
  }
  const startedAt = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  const listed = await listArboxDailyBusinessIds(admin, { slot });
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
      slot,
    });

  if (dryRun) {
    const dispatched = await fanOut();
    return NextResponse.json({
      accepted: true,
      dry_run: true,
      slot,
      businesses: ids,
      started_at: startedAt,
      total_ms: dispatched.total_ms,
      results: dispatched.businesses,
    });
  }

  if (ids.length) after(() => fanOut());

  return NextResponse.json({
    accepted: true,
    slot,
    businesses: ids,
    started_at: startedAt,
  });
}
