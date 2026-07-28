import { NextRequest, NextResponse } from "next/server";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET יומי + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/arbox-trial-sync-cleanup] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * מוחק שורות ישנות מ-arbox_trial_sync_log (מעל 90 יום).
 * Scheduling: external cron-job.org (not Vercel crons).
 */
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-trial-sync-cleanup] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ranAt = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - RETENTION_MS).toISOString();

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("arbox_trial_sync_log")
      .delete()
      .lt("processed_at", cutoffIso)
      .select("business_id");

    if (error) {
      console.error("[cron/arbox-trial-sync-cleanup] delete failed:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const deletedCount = Array.isArray(data) ? data.length : 0;
    console.info("[cron/arbox-trial-sync-cleanup] done", {
      deleted_count: deletedCount,
      cutoff: cutoffIso,
      ran_at: ranAt,
    });

    return NextResponse.json({
      ok: true,
      deleted_count: deletedCount,
      ran_at: ranAt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-trial-sync-cleanup] unexpected error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
