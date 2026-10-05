import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { dryRunSupabase } from "@/lib/leads/arbox-daily-dry-run";
import {
  loadArboxTrialSyncBusiness,
  runArboxTrialSyncForBusiness,
} from "@/lib/leads/arbox-trial-sync-run";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * One Arbox business for the 15-minute trial sync.
 * Called by the dispatcher (and by ?dry_run=1). Same Bearer CRON_SECRET.
 * Scheduling stays on GET /api/cron/arbox-trial-sync via cron-job.org.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-trial-sync/business] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const businessId = Number(req.nextUrl.searchParams.get("business_id"));
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return NextResponse.json({ error: "invalid_business_id" }, { status: 400 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const started = Date.now();
  try {
    const admin = createSupabaseAdminClient();
    const business = await loadArboxTrialSyncBusiness(admin, businessId);
    if (!business) {
      return NextResponse.json({ error: "unknown_arbox_business" }, { status: 400 });
    }

    const result = await runArboxTrialSyncForBusiness({
      admin: dryRun ? dryRunSupabase(admin) : admin,
      business,
    });

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      elapsed_ms: Date.now() - started,
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
