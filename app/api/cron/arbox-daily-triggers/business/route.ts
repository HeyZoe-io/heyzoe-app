import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import {
  countNotifiedSends,
  cronDryRunNow,
  isInternalCronCall,
  logCronInvocation,
  noteUnexpectedCronCaller,
  rejectCronTimeOverride,
} from "@/lib/cron-clock";
import { dryRunSupabase } from "@/lib/leads/arbox-daily-dry-run";
import { runArboxDailyContext } from "@/lib/leads/arbox-daily-run-context";
import {
  loadArboxDailyBusiness,
  runArboxDailyTriggersForBusiness,
} from "@/lib/leads/arbox-daily-triggers-run";
import { parseTrialReminderSlot } from "@/lib/leads/arbox-trial-reminder";
import { runWithArboxCallCount } from "@/lib/crm/arbox-call-counter";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { SendPlanCollector } from "@/lib/send-plan/collector";
import { dispatchInstant, planDayOf } from "@/lib/send-plan/checks";

/**
 * One Arbox business for the daily trigger cron.
 * Called by the dispatcher (and by ?dry_run=1). Same Bearer CRON_SECRET.
 * Scheduling stays on GET /api/cron/arbox-daily-triggers via cron-job.org.
 * ?phase=plan: the same run, but every send is written to the PLAN (lib/send-plan) instead of
 * Meta. Without it the run sends as before; rows it queues get the plan checks when queued.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ARBOX_REQUEST_TIMEOUT_MS = 15_000;

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-daily-triggers/business] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rejected = rejectCronTimeOverride(req, true);
  if (rejected) return rejected;

  const businessId = Number(req.nextUrl.searchParams.get("business_id"));
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return NextResponse.json({ error: "invalid_business_id" }, { status: 400 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const slot = parseTrialReminderSlot(req.nextUrl.searchParams.get("slot"));
  if (slot === "invalid") {
    return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
  }
  const phaseParam = req.nextUrl.searchParams.get("phase");
  if (phaseParam != null && phaseParam !== "plan") {
    return NextResponse.json({ error: "invalid_phase" }, { status: 400 });
  }
  const planPhase = phaseParam === "plan";
  const now = cronDryRunNow(req);
  const userAgent = req.headers.get("user-agent");
  const started = Date.now();
  try {
    const admin = createSupabaseAdminClient();
    const business = await loadArboxDailyBusiness(admin, businessId);
    if (!business) {
      return NextResponse.json({ error: "unknown_arbox_business" }, { status: 400 });
    }

    const planNow = now ?? new Date();
    const planDay = planDayOf(planNow);
    const planSlot = slot === "evening" ? "evening" : "morning";
    const dispatchAt = dispatchInstant(planDay, planSlot) ?? planNow;
    const collector = new SendPlanCollector(
      admin,
      businessId,
      planSlot,
      planDay,
      dispatchAt,
      dryRun,
      planNow,
      planPhase ? "plan" : "legacy"
    );

    const result = await runWithArboxCallCount(
      { cron: "arbox-daily-triggers", slug: business.slug, emitIfEmpty: true },
      () =>
        runArboxDailyContext(
          {
            businessId,
            dryRun,
            timeoutMs: ARBOX_REQUEST_TIMEOUT_MS,
            arboxCalls: 0,
            arboxReports: [],
            membershipTypesByKey: new Map(),
            wouldSend: [],
            sendPlan: collector,
          },
          () =>
            runArboxDailyTriggersForBusiness({
              admin: dryRun ? dryRunSupabase(admin) : admin,
              business,
              slot,
              now,
            })
        )
    );
    const plan = await collector.finalize();

    const sends = dryRun ? (result.would_send?.length ?? 0) : countNotifiedSends(result.summary);
    logCronInvocation({
      route: "/api/cron/arbox-daily-triggers/business",
      slot,
      userAgent,
      dryRun,
      sends,
    });
    await noteUnexpectedCronCaller({
      route: "/api/cron/arbox-daily-triggers/business",
      slot,
      userAgent,
      dryRun,
      internal: isInternalCronCall(req),
    });

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      ...(planPhase ? { phase: "plan" } : {}),
      ...result,
      plan,
      ...(dryRun ? { plan_items: collector.items } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-daily-triggers/business] FAILED", {
      business_id: businessId,
      error: message,
      elapsed_ms: Date.now() - started,
    });
    return NextResponse.json({ ok: false, error: "business_run_failed" }, { status: 500 });
  }
}
