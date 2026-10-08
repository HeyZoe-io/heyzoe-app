import { after, NextRequest, NextResponse } from "next/server";
import { holdArboxBackgroundClocks } from "@/lib/arbox-background-pause";
import { authorizeCron } from "@/lib/cron-auth";
import {
  countNotifiedSends,
  cronDryRunNow,
  isInternalCronCall,
  logCronInvocation,
  noteUnexpectedCronCaller,
  rejectCronTimeOverride,
} from "@/lib/cron-clock";
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
 * query param, not the clock hour. It runs trial reminders, trainer heads-up,
 * nth_workout rules whose direction is before, post-trial C5/C6 catch-up, and
 * lead_status_changed. It must finish before the 21:00 night hold.
 * No param (or slot=morning) is the existing 09:00 job. Scheduling: cron-job.org.
 * A business with arbox_background_paused gets no worker and its
 * catch-up clocks move to now (lib/arbox-background-pause.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-daily-triggers] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rejected = rejectCronTimeOverride(req, true);
  if (rejected) return rejected;

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const slot = parseTrialReminderSlot(req.nextUrl.searchParams.get("slot"));
  if (slot === "invalid") {
    return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
  }
  const now = cronDryRunNow(req);
  const userAgent = req.headers.get("user-agent");
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
      nowIso: now?.toISOString(),
    });

  if (dryRun) {
    const dispatched = await fanOut();
    const sends = dispatched.businesses.reduce((sum, row) => {
      const body = row.body as { summary?: unknown; would_send?: unknown[] } | null;
      if (Array.isArray(body?.would_send)) return sum + body.would_send.length;
      return sum + countNotifiedSends(body?.summary);
    }, 0);
    logCronInvocation({
      route: "/api/cron/arbox-daily-triggers",
      slot,
      userAgent,
      dryRun: true,
      sends,
    });
    return NextResponse.json({
      accepted: true,
      dry_run: true,
      slot,
      businesses: ids,
      arbox_background_paused: listed.paused,
      started_at: startedAt,
      total_ms: dispatched.total_ms,
      sends,
      results: dispatched.businesses,
    });
  }

  if (ids.length) after(() => fanOut());
  if (listed.paused.length) await holdArboxBackgroundClocks(admin, listed.paused, new Date());

  logCronInvocation({
    route: "/api/cron/arbox-daily-triggers",
    slot,
    userAgent,
    dryRun: false,
    sends: null,
  });
  await noteUnexpectedCronCaller({
    route: "/api/cron/arbox-daily-triggers",
    slot,
    userAgent,
    dryRun: false,
    internal: isInternalCronCall(req),
  });

  return NextResponse.json({
    accepted: true,
    slot,
    businesses: ids,
    arbox_background_paused: listed.paused,
    started_at: startedAt,
  });
}
