import { after, NextRequest, NextResponse } from "next/server";
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
import { loadIncompleteBusinessIds, recordArboxDailyRunStatus } from "@/lib/leads/arbox-daily-run-status";
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
 * The evening run retries a failed business once in the same run and records
 * each business in arbox_daily_run_status. ?slot=evening&pass=retry (cron-job.org,
 * 20:50) reruns only the businesses still incomplete, before the 21:00 night hold.
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
  const passParam = req.nextUrl.searchParams.get("pass");
  if (passParam != null && passParam !== "main" && passParam !== "retry") {
    return NextResponse.json({ error: "invalid_pass" }, { status: 400 });
  }
  const pass = passParam === "retry" ? "retry" : "main";
  if (pass === "retry" && slot !== "evening") {
    return NextResponse.json({ error: "retry_pass_is_evening_only" }, { status: 400 });
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

  let ids = listed.ids;
  if (pass === "retry") {
    const incomplete = await loadIncompleteBusinessIds({ admin, slot, now: now ?? new Date() });
    if (!incomplete.ok) {
      return NextResponse.json({ ok: false, error: incomplete.error }, { status: 500 });
    }
    const wanted = new Set(incomplete.ids);
    ids = ids.filter((id) => wanted.has(id));
    console.info("[cron/arbox-daily-triggers] retry pass", { slot, businesses: ids });
  }
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
      retryIncomplete: slot === "evening",
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
      pass,
      businesses: ids,
      started_at: startedAt,
      total_ms: dispatched.total_ms,
      sends,
      results: dispatched.businesses,
    });
  }

  if (ids.length) {
    after(async () => {
      const dispatched = await fanOut();
      await recordArboxDailyRunStatus({
        admin,
        slot,
        now: new Date(),
        pass,
        results: dispatched.businesses,
      });
    });
  }

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
    pass,
    businesses: ids,
    started_at: startedAt,
  });
}
