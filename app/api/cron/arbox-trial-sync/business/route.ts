import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { acknowledgeCron, cronDryRunNow, rejectCronTimeOverride } from "@/lib/cron-clock";
import { dryRunSupabase } from "@/lib/leads/arbox-daily-dry-run";
import { arboxDailyContext, runArboxDailyContext } from "@/lib/leads/arbox-daily-run-context";
import {
  loadArboxTrialSyncBusiness,
  runArboxTrialSyncForBusiness,
} from "@/lib/leads/arbox-trial-sync-run";
import { runWithArboxCallCount } from "@/lib/crm/arbox-call-counter";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * One Arbox business for the 15-minute trial sync.
 * Called by the dispatcher (and by ?dry_run=1). Same Bearer CRON_SECRET.
 * Scheduling stays on GET /api/cron/arbox-trial-sync via cron-job.org.
 * maxDuration 60 covers one studio's Arbox reports on the paid plan.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-trial-sync/business] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rejected = rejectCronTimeOverride(req, true);
  if (rejected) return rejected;

  const businessId = Number(req.nextUrl.searchParams.get("business_id"));
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return NextResponse.json({ error: "invalid_business_id" }, { status: 400 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const now = cronDryRunNow(req);
  const started = Date.now();
  try {
    const admin = createSupabaseAdminClient();
    const business = await loadArboxTrialSyncBusiness(admin, businessId);
    if (!business) {
      return NextResponse.json({ error: "unknown_arbox_business" }, { status: 400 });
    }

    const run = () =>
      runArboxTrialSyncForBusiness({
        admin: dryRun ? dryRunSupabase(admin) : admin,
        business,
        now,
        dryRun,
      });
    let wouldSend: { template: string; phone_tail: string; params: string[] }[] = [];
    const result = await runWithArboxCallCount(
      { cron: "arbox-trial-sync", slug: business.slug, emitIfEmpty: true },
      () =>
        dryRun
          ? runArboxDailyContext(
              {
                businessId,
                dryRun: true,
                timeoutMs: 15_000,
                arboxCalls: 0,
                arboxReports: [],
                membershipTypesByKey: new Map(),
                wouldSend: [],
              },
              async () => {
                const summary = await run();
                wouldSend = arboxDailyContext()?.wouldSend ?? [];
                return summary;
              }
            )
          : run()
    );
    await acknowledgeCron(
      req,
      "/api/cron/arbox-trial-sync/business",
      dryRun ? wouldSend.length : null
    );

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      elapsed_ms: Date.now() - started,
      ...(dryRun ? { would_send: wouldSend } : {}),
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-trial-sync/business] FAILED", {
      business_id: businessId,
      error: message,
      elapsed_ms: Date.now() - started,
    });
    return NextResponse.json({ ok: false, error: "business_run_failed" }, { status: 500 });
  }
}
