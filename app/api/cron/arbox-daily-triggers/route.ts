import { NextRequest, NextResponse } from "next/server";
import { syncArboxBirthdaysForBusiness } from "@/lib/leads/arbox-birthday";
import { syncArboxMembershipExpiringForBusiness } from "@/lib/leads/arbox-membership-expiring";
import { syncArboxTrialAttendedForBusiness } from "@/lib/leads/arbox-trial-attended";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Shared daily Arbox / Zoe-native trigger detection.
 * Steps: birthday, membership_expiring, trial_attended. Later: sessions_expiring / Zoe-native.
 * Scheduling: cron-job.org daily (not Vercel crons — Hobby).
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
      "[cron/arbox-daily-triggers] CRON_SECRET not set — allowing request in dev only"
    );
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

type BusinessRow = {
  id: number;
  slug: string;
  crm_api_key: string;
  crm_box_id: string;
};

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    console.warn("[cron/arbox-daily-triggers] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const ranAt = now.toISOString();

  const { data: businessRows, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, crm_api_key, crm_box_id")
    .eq("crm_type", "arbox")
    .not("crm_api_key", "is", null)
    .not("crm_box_id", "is", null);

  if (bizErr) {
    console.error("[cron/arbox-daily-triggers] businesses query failed:", bizErr.message);
    return NextResponse.json({ ok: false, error: "businesses_query_failed" }, { status: 500 });
  }

  const businesses: BusinessRow[] = [];
  for (const row of businessRows ?? []) {
    const id = Number((row as { id?: unknown }).id);
    const slug = String((row as { slug?: unknown }).slug ?? "").trim().toLowerCase();
    const apiKey = String((row as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
    const boxId = String((row as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
    if (!Number.isFinite(id) || id <= 0 || !slug || !apiKey || !boxId) continue;
    businesses.push({ id, slug, crm_api_key: apiKey, crm_box_id: boxId });
  }

  const summaries: Array<{
    business_id: number;
    slug: string;
    birthday?: Awaited<ReturnType<typeof syncArboxBirthdaysForBusiness>>;
    membership_expiring?: Awaited<ReturnType<typeof syncArboxMembershipExpiringForBusiness>>;
    trial_attended?: Awaited<ReturnType<typeof syncArboxTrialAttendedForBusiness>>;
    // future: sessions_expiring?: ...; zoe_native?: ...
  }> = [];

  for (const business of businesses) {
    const entry: (typeof summaries)[number] = {
      business_id: business.id,
      slug: business.slug,
    };

    // --- Step: birthday ---
    try {
      entry.birthday = await syncArboxBirthdaysForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        now,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] birthday step threw", {
        slug: business.slug,
        error: message,
      });
      entry.birthday = {
        fetched: 0,
        pages_fetched: 0,
        due_today: 0,
        processed: 0,
        dedup: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        no_phone: 0,
        errors: 1,
        fetch_error: message,
      };
    }

    // --- Step: membership_expiring ---
    try {
      entry.membership_expiring = await syncArboxMembershipExpiringForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        now,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] membership_expiring step threw", {
        slug: business.slug,
        error: message,
      });
      entry.membership_expiring = {
        fetched: 0,
        pages_fetched: 0,
        processed: 0,
        dedup: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        skipped_renewed: 0,
        skipped_cancelled: 0,
        skipped_past_due: 0,
        skipped_expired_end: 0,
        no_phone: 0,
        errors: 1,
        fetch_error: message,
      };
    }

    // --- Step: trial_attended ---
    try {
      entry.trial_attended = await syncArboxTrialAttendedForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        now,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] trial_attended step threw", {
        slug: business.slug,
        error: message,
      });
      entry.trial_attended = {
        fetched: 0,
        pages_fetched: 0,
        attended: 0,
        processed: 0,
        dedup: 0,
        notified: 0,
        gated: 0,
        not_attended: 0,
        no_phone: 0,
        errors: 1,
        fetch_error: message,
      };
    }

    // --- Step: sessions_expiring (future) ---
    // --- Step: zoe_native (future) ---

    summaries.push(entry);
  }

  console.info("[cron/arbox-daily-triggers] done", {
    ran_at: ranAt,
    businesses: summaries.length,
  });

  return NextResponse.json({
    ok: true,
    ran_at: ranAt,
    businesses: summaries,
  });
}
