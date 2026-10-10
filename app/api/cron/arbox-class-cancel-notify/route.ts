import { NextRequest, NextResponse } from "next/server";
import { acknowledgeCron, rejectCronTimeOverride } from "@/lib/cron-clock";
import { maybeSendAdminDailyUnsentSummary } from "@/lib/admin-daily-unsent-summary";
import { runWithArboxCallCount } from "@/lib/crm/arbox-call-counter";
import { ARBOX_BACKGROUND_PAUSE_COLUMN, ARBOX_BACKGROUND_PAUSED, rowArboxBackgroundPaused } from "@/lib/arbox-background-pause";
import { syncArboxClassCancelledCustomerForBusiness } from "@/lib/leads/arbox-class-cancelled-customer";
import { getArboxApiKey } from "@/lib/business-secrets";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Hourly: snapshot future Arbox registrations and notify them when that
 * occurrence is cancelled.
 * Scheduling: cron-job.org every hour (NOT vercel.json — Hobby).
 * Same run, at or after 09:30 Asia/Jerusalem, also sends the admin unsent
 * summary once per day when there is something to report.
 * Same run, on Tuesday at or after 10:30 Asia/Jerusalem, also sends the weekly
 * knowledge-update template once per ISO week. A failure there is logged and
 * does not stop the rest of this cron.
 * GET + Authorization: Bearer CRON_SECRET
 * Optional: ?dry_run=1 or CLASS_CANCEL_NOTIFY_DRY_RUN=1 — real reads, no writes, no sends.
 *
 * IO when the rule is enabled (10 businesses): about 3–5 Arbox GETs per
 * business per hour (cancelledSessionsReport + bookingsReport + classesSummaryReport;
 * bookings can be a second page). The trainer phone is taken from that same
 * classesSummaryReport fetch (0 extra Arbox calls) and upserted into
 * arbox_class_trainer_snapshot. No Claude. No Arbox calls when the business
 * has no enabled class_cancelled_customer rule, or arbox_background_paused.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn(
      "[cron/arbox-class-cancel-notify] CRON_SECRET not set — allowing request in dev only"
    );
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function dryRunRequested(req: NextRequest): boolean {
  if (process.env.CLASS_CANCEL_NOTIFY_DRY_RUN === "1") return true;
  return req.nextUrl.searchParams.get("dry_run") === "1";
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-class-cancel-notify] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rejectedClock = rejectCronTimeOverride(req);
  if (rejectedClock) return rejectedClock;


  const dryRun = dryRunRequested(req);
  await acknowledgeCron(req, "/api/cron/arbox-class-cancel-notify");
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const ranAt = now.toISOString();

  const { data: businessRows, error: bizErr } = await admin
    .from("businesses")
    .select(`id, slug, crm_api_key, crm_api_key_enc, crm_box_id, ${ARBOX_BACKGROUND_PAUSE_COLUMN}`)
    .eq("crm_type", "arbox")
    .or("crm_api_key.not.is.null,crm_api_key_enc.not.is.null")
    .not("crm_box_id", "is", null);

  if (bizErr) {
    console.error("[cron/arbox-class-cancel-notify] businesses query failed:", bizErr.message);
    return NextResponse.json({ ok: false, error: "businesses_query_failed" }, { status: 500 });
  }

  const businesses: Array<{
    business_id: number;
    slug: string;
    dry_run: boolean;
    skipped?: boolean;
    skip_reason?: string;
    gets?: number;
    inserted?: number;
    cancel_marked?: number;
    sent?: number;
    refresh_aborted?: boolean;
    fetch_error?: string;
    trainer_sent?: number;
    trainer_skipped_no_phone?: number;
    trainer_skipped_no_snapshot?: number;
    trainer_held_quiet_hours?: number;
  }> = [];

  for (const row of (businessRows ?? []) as unknown as Record<string, unknown>[]) {
    const businessId = Number((row as { id?: unknown }).id);
    const slug = String((row as { slug?: unknown }).slug ?? "").trim().toLowerCase();
    const apiKey = getArboxApiKey(row as Record<string, unknown>);
    const boxId = String((row as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
    if (!Number.isFinite(businessId) || businessId <= 0 || !slug || !apiKey || !boxId) continue;
    if (rowArboxBackgroundPaused(row)) {
      businesses.push({
        business_id: businessId,
        slug,
        dry_run: dryRun,
        skipped: true,
        skip_reason: ARBOX_BACKGROUND_PAUSED,
      });
      continue;
    }

    try {
      const result = await runWithArboxCallCount(
        { cron: "arbox-class-cancel-notify", slug, emitIfEmpty: true },
        () =>
          syncArboxClassCancelledCustomerForBusiness({
            admin,
            businessId,
            businessSlug: slug,
            apiKey,
            boxId,
            now,
            dryRun,
          })
      );
      businesses.push({
        business_id: businessId,
        slug,
        dry_run: dryRun,
        skipped: result.skipped,
        skip_reason: result.skip_reason,
        gets: result.pages.length,
        inserted: result.inserted,
        cancel_marked: result.cancel_marked,
        sent: result.sent,
        refresh_aborted: result.refresh_aborted,
        fetch_error: result.fetch_error,
        trainer_sent: result.trainer_sent,
        trainer_skipped_no_phone: result.trainer_skipped_no_phone,
        trainer_skipped_no_snapshot: result.trainer_skipped_no_snapshot,
        trainer_held_quiet_hours: result.trainer_held_quiet_hours,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-class-cancel-notify] business threw", {
        businessId,
        slug,
        error: message,
      });
      businesses.push({
        business_id: businessId,
        slug,
        dry_run: dryRun,
        fetch_error: message,
      });
    }
  }

  let adminUnsent: { sent: boolean; reason: string; count: number } = {
    sent: false,
    reason: "not_run",
    count: 0,
  };
  try {
    const summary = await maybeSendAdminDailyUnsentSummary({ admin, now, dryRun });
    adminUnsent = { sent: summary.sent, reason: summary.reason, count: summary.count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/arbox-class-cancel-notify] admin unsent summary failed", message);
    adminUnsent = { sent: false, reason: "threw", count: 0 };
  }

  let knowledgeUpdates: { reason: string; count: number } = { reason: "not_run", count: 0 };
  try {
    const { runWeeklyKnowledgeUpdates } = await import("@/lib/knowledge-updates-run");
    knowledgeUpdates = await runWeeklyKnowledgeUpdates({ admin, now, dryRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/arbox-class-cancel-notify] knowledge updates failed", message);
    knowledgeUpdates = { reason: "threw", count: 0 };
  }

  console.info("[cron/arbox-class-cancel-notify] done", {
    ran_at: ranAt,
    dry_run: dryRun,
    businesses: businesses.length,
    admin_unsent: adminUnsent.reason,
    knowledge_updates: knowledgeUpdates.reason,
  });

  return NextResponse.json({
    ok: true,
    ran_at: ranAt,
    dry_run: dryRun,
    businesses,
    admin_unsent: adminUnsent,
    knowledge_updates: knowledgeUpdates,
  });
}
