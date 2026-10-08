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
import { loadIncompleteBusinessIds, recordArboxDailyRunStatus } from "@/lib/leads/arbox-daily-run-status";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { planDayOf, type PlanSlot } from "@/lib/send-plan/checks";
import { cancelExpiredHolds, dispatchPlannedSends } from "@/lib/send-plan/dispatch";
import {
  alertHeldAfterPlan,
  loadSendPlanRuns,
  markSendPlanDispatched,
  planSummaryOf,
  planTooLate,
  recordSendPlanRuns,
} from "@/lib/send-plan/runs";

/**
 * Daily Arbox trigger dispatcher.
 * Scheduling: cron-job.org GET (not Vercel crons — Hobby). Bearer CRON_SECRET.
 * Returns immediately. Each eligible business runs in its own worker invocation
 * via after() → GET /api/cron/arbox-daily-triggers/business.
 * ?dry_run=1 awaits the workers in this request and does not send or write.
 * ?slot=evening is the EVENING_SLOT_IL (20:00) Asia/Jerusalem job (cron-job.org). The slot is the
 * query param, not the clock hour. It runs trial reminders, trainer heads-up,
 * nth_workout rules whose direction is before, post-trial C5/C6 catch-up, and
 * lead_status_changed. It must finish before the 21:00 night hold.
 * No param (or slot=morning) is the existing 09:00 job. Scheduling: cron-job.org.
 * A business with arbox_background_paused gets no worker and its
 * catch-up clocks move to now (lib/arbox-background-pause.ts).
 * The evening run retries a failed business once in the same run and records
 * each business in arbox_daily_run_status. ?slot=evening&pass=retry (cron-job.org,
 * 20:20, EVENING_RETRY_SLOT_IL) reruns only the businesses still incomplete, before the 21:00 night hold.
 * PLAN before send: ?phase=plan (cron-job.org 08:00 / 19:00) writes the plan. The 09:00 / 20:00
 * jobs (same URLs) then send the planned rows of businesses with a PLAN, and run the legacy
 * worker only for businesses without an ok PLAN. No PLAN at all = today's behavior.
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
  const phaseParam = req.nextUrl.searchParams.get("phase");
  if (phaseParam != null && phaseParam !== "plan") {
    return NextResponse.json({ error: "invalid_phase" }, { status: 400 });
  }
  if (phaseParam === "plan" && pass === "retry") {
    return NextResponse.json({ error: "retry_pass_is_dispatch_only" }, { status: 400 });
  }
  const now = cronDryRunNow(req);
  const userAgent = req.headers.get("user-agent");
  const startedAt = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  if (phaseParam === "plan") {
    return runPlanPhase({ req, admin, slot, dryRun, now, userAgent, startedAt });
  }
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
  const planSlot: PlanSlot = slot === "evening" ? "evening" : "morning";
  const clock = now ?? new Date();
  const planDay = planDayOf(clock);
  const planRuns =
    pass === "main" ? await loadSendPlanRuns(admin, planDay, planSlot) : { ok: new Set<number>(), incomplete: new Set<number>() };
  const planned = ids.filter((id) => planRuns.ok.has(id) || planRuns.incomplete.has(id));
  const legacyIds = ids.filter((id) => !planRuns.ok.has(id));
  const dispatchPlanned = () =>
    planned.length
      ? dispatchPlannedSends({ admin, slot: planSlot, now: dryRun ? clock : new Date(), dryRun })
      : Promise.resolve(null);

  const origin = resolveArboxDailyWorkerOrigin(req);
  const authorization = req.headers.get("authorization");
  const fanOut = () =>
    dispatchArboxDailyWorkers({
      origin,
      businessIds: legacyIds,
      dryRun,
      authorization,
      slot,
      nowIso: now?.toISOString(),
      retryIncomplete: slot === "evening",
    });

  if (dryRun) {
    const dispatch = await dispatchPlanned();
    const dispatched = await fanOut();
    const sends = dispatched.businesses.reduce((sum, row) => {
      const body = row.body as { summary?: unknown; would_send?: unknown[] } | null;
      if (Array.isArray(body?.would_send)) return sum + body.would_send.length;
      return sum + countNotifiedSends(body?.summary);
    }, dispatch?.would_send?.filter((row) => row.outcome === "sent").length ?? 0);
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
      planned_businesses: planned,
      legacy_businesses: legacyIds,
      arbox_background_paused: listed.paused,
      started_at: startedAt,
      total_ms: dispatched.total_ms,
      sends,
      plan_dispatch: dispatch,
      results: dispatched.businesses,
    });
  }

  if (ids.length) {
    after(async () => {
      if (planned.length) {
        await dispatchPlanned();
        await markSendPlanDispatched(admin, planDay, planSlot, planned);
      }
      if (legacyIds.length) {
        const dispatched = await fanOut();
        await recordArboxDailyRunStatus({
          admin,
          slot,
          now: new Date(),
          pass,
          results: dispatched.businesses,
        });
        // A PLAN that finished while the legacy workers ran.
        if (planned.length) await dispatchPlanned();
      }
    });
  }
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
    pass,
    businesses: ids,
    planned_businesses: planned,
    legacy_businesses: legacyIds,
    arbox_background_paused: listed.paused,
    started_at: startedAt,
  });
}

/**
 * PLAN (?phase=plan, cron-job.org 08:00 / 19:00 IL): the same workers write every send to
 * scheduled_template_sends as planned / held / blocked / skipped. Nothing goes to Meta.
 * Too close to DISPATCH it does nothing, and DISPATCH runs the legacy worker instead.
 */
async function runPlanPhase(input: {
  req: NextRequest;
  admin: ReturnType<typeof createSupabaseAdminClient>;
  slot: "morning" | "evening";
  dryRun: boolean;
  now: Date | undefined;
  userAgent: string | null;
  startedAt: string;
}): Promise<NextResponse> {
  const { req, admin, slot, dryRun, now } = input;
  const planSlot: PlanSlot = slot === "evening" ? "evening" : "morning";
  const clock = now ?? new Date();
  const planDay = planDayOf(clock);
  if (planTooLate(planDay, planSlot, clock)) {
    console.warn("[cron/arbox-daily-triggers] plan too late, dispatch runs legacy", { planDay, slot });
    return NextResponse.json({ accepted: false, phase: "plan", slot, error: "plan_too_late" });
  }
  const listed = await listArboxDailyBusinessIds(admin, { slot });
  if (!listed.ok) {
    console.error("[cron/arbox-daily-triggers] businesses query failed:", listed.error);
    return NextResponse.json({ ok: false, error: "businesses_query_failed" }, { status: 500 });
  }
  const ids = listed.ids;
  const fanOut = () =>
    dispatchArboxDailyWorkers({
      origin: resolveArboxDailyWorkerOrigin(req),
      businessIds: ids,
      dryRun,
      authorization: req.headers.get("authorization"),
      slot,
      nowIso: now?.toISOString(),
      retryIncomplete: true,
      phase: "plan",
    });

  logCronInvocation({
    route: "/api/cron/arbox-daily-triggers?phase=plan",
    slot,
    userAgent: input.userAgent,
    dryRun,
    sends: null,
  });

  if (dryRun) {
    const dispatched = await fanOut();
    const totals = { planned: 0, held: 0, blocked: 0, skipped: 0 };
    for (const row of dispatched.businesses) {
      const plan = planSummaryOf(row);
      totals.planned += plan?.planned ?? 0;
      totals.held += plan?.held ?? 0;
      totals.blocked += plan?.blocked ?? 0;
      totals.skipped += plan?.skipped ?? 0;
    }
    return NextResponse.json({
      accepted: true,
      dry_run: true,
      phase: "plan",
      slot,
      plan_day: planDay,
      businesses: ids,
      started_at: input.startedAt,
      total_ms: dispatched.total_ms,
      totals,
      results: dispatched.businesses,
    });
  }

  await noteUnexpectedCronCaller({
    route: "/api/cron/arbox-daily-triggers?phase=plan",
    slot,
    userAgent: input.userAgent,
    dryRun: false,
    internal: isInternalCronCall(req),
  });
  if (ids.length) {
    after(async () => {
      const dispatched = await fanOut();
      await recordSendPlanRuns({ admin, planDay, slot: planSlot, results: dispatched.businesses });
      await cancelExpiredHolds(admin, new Date());
      await alertHeldAfterPlan({ admin, slot: planSlot, results: dispatched.businesses }).catch((e) =>
        console.error("[cron/arbox-daily-triggers] held alert threw:", e instanceof Error ? e.message : e)
      );
    });
  }
  return NextResponse.json({ accepted: true, phase: "plan", slot, plan_day: planDay, businesses: ids, started_at: input.startedAt });
}
