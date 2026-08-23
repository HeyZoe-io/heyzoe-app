import { NextRequest, NextResponse } from "next/server";
import {
  businessQualifiesForArboxScheduleSync,
  markArboxScheduleSyncedAt,
  persistCronArboxScheduleSync,
  pullArboxWeeklyTimetable,
} from "@/lib/arbox-schedule-sync";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Daily Arbox timetable → product schedule_slots sync.
 * Scheduling: cron-job.org (not Vercel crons — Hobby).
 * GET + Authorization: Bearer CRON_SECRET
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/arbox-schedule-sync] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-schedule-sync] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: businessRows, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, crm_type, crm_api_key, crm_box_id")
    .eq("crm_type", "arbox")
    .not("crm_api_key", "is", null);

  if (bizErr) {
    console.error("[cron/arbox-schedule-sync] businesses query failed:", bizErr.message);
    return NextResponse.json({ ok: false, error: "businesses_query_failed" }, { status: 500 });
  }

  const summaries: Array<Record<string, unknown>> = [];
  let pulled = 0;
  let updated = 0;
  let cleared = 0;
  let notified = 0;
  let failed = 0;

  for (const row of businessRows ?? []) {
    const id = Number((row as { id?: unknown }).id);
    const slug = String((row as { slug?: unknown }).slug ?? "").trim().toLowerCase();
    const apiKey = String((row as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
    const locationId = String((row as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
    if (!Number.isFinite(id) || id <= 0 || !slug || !businessQualifiesForArboxScheduleSync(row)) {
      continue;
    }

    const pulledTt = await pullArboxWeeklyTimetable({
      apiKey,
      locationId: locationId || undefined,
    });
    if (!pulledTt.ok) {
      failed += 1;
      console.error("[cron/arbox-schedule-sync] pull failed", {
        slug,
        error: pulledTt.error,
        status: pulledTt.status ?? null,
      });
      summaries.push({ slug, ok: false, error: pulledTt.error });
      continue;
    }

    try {
      const result = await persistCronArboxScheduleSync({
        admin,
        businessId: id,
        classes: pulledTt.classes,
        catalog: pulledTt.catalog,
        nowIso,
      });
      await markArboxScheduleSyncedAt(admin, id, nowIso);
      pulled += 1;
      updated += result.updated;
      cleared += result.cleared;
      notified += result.notified;
      summaries.push({
        slug,
        ok: true,
        classes: pulledTt.classes.length,
        ...result,
      });
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-schedule-sync] persist failed", { slug, error: message });
      summaries.push({ slug, ok: false, error: "persist_failed" });
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    pulled,
    updated,
    cleared,
    notified,
    failed,
    businesses: summaries,
  });
}
