import { NextRequest, NextResponse } from "next/server";
import { syncNoResponseReengageForBusiness } from "@/lib/leads/no-response-reengage";
import { isBusinessSubscriptionActive } from "@/lib/notifications/business-notification-eligibility";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Daily no_response template re-engage (non-Arbox).
 * Scheduling: cron-job.org daily (NOT Vercel crons — Hobby).
 * GET + Authorization: Bearer CRON_SECRET
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn(
      "[cron/no-response-reengage] CRON_SECRET not set — allowing request in dev only"
    );
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/no-response-reengage] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const ranAt = now.toISOString();

  const { data: ruleRows, error: rulesErr } = await admin
    .from("template_triggers")
    .select("business_id")
    .eq("trigger_type", "no_response")
    .eq("enabled", true)
    .not("template_name", "is", null);

  if (rulesErr) {
    console.error("[cron/no-response-reengage] rules query failed:", rulesErr.message);
    return NextResponse.json({ ok: false, error: rulesErr.message }, { status: 500 });
  }

  const businessIds = [
    ...new Set(
      (ruleRows ?? [])
        .map((r) => Number((r as { business_id?: unknown }).business_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];

  if (!businessIds.length) {
    return NextResponse.json({
      ok: true,
      ran_at: ranAt,
      businesses: 0,
      note: "no_enabled_no_response_rules",
    });
  }

  const { data: bizRows, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, is_active")
    .in("id", businessIds);

  if (bizErr) {
    console.error("[cron/no-response-reengage] businesses query failed:", bizErr.message);
    return NextResponse.json({ ok: false, error: bizErr.message }, { status: 500 });
  }

  const perBusiness: Record<string, unknown>[] = [];
  let totalSent = 0;
  let totalDeferred = 0;
  let totalGated = 0;
  let totalExamined = 0;

  for (const biz of bizRows ?? []) {
    const businessId = Number((biz as { id?: unknown }).id);
    const slug = String((biz as { slug?: unknown }).slug ?? "")
      .trim()
      .toLowerCase();
    if (!Number.isFinite(businessId) || businessId <= 0 || !slug) continue;

    if (!isBusinessSubscriptionActive(biz as { is_active?: boolean | null })) {
      perBusiness.push({ business_id: businessId, slug, skipped: "business_inactive" });
      continue;
    }

    try {
      const summary = await syncNoResponseReengageForBusiness({
        admin,
        businessId,
        businessSlug: slug,
        now,
      });
      totalSent += summary.sent;
      totalDeferred += summary.deferred;
      totalGated += summary.gated;
      totalExamined += summary.examined;
      perBusiness.push({ business_id: businessId, slug, ...summary });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/no-response-reengage] business threw", {
        business_id: businessId,
        slug,
        error: message,
      });
      perBusiness.push({ business_id: businessId, slug, error: message });
    }
  }

  console.info("[cron/no-response-reengage] done", {
    ran_at: ranAt,
    businesses: perBusiness.length,
    examined: totalExamined,
    sent: totalSent,
    deferred: totalDeferred,
    gated: totalGated,
  });

  return NextResponse.json({
    ok: true,
    ran_at: ranAt,
    businesses: perBusiness.length,
    examined: totalExamined,
    sent: totalSent,
    deferred: totalDeferred,
    gated: totalGated,
    per_business: perBusiness,
  });
}
