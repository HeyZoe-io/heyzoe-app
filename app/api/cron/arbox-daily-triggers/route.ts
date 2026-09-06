import { NextRequest, NextResponse } from "next/server";
import { syncArboxBirthdaysForBusiness } from "@/lib/leads/arbox-birthday";
import { syncArboxMembershipCancelledForBusiness } from "@/lib/leads/arbox-membership-cancelled";
import { syncArboxMembershipExpiringForBusiness } from "@/lib/leads/arbox-membership-expiring";
import {
  bookingsReportSharedLookbackWindow,
  businessNeedsBookingsReportFetch,
  syncArboxMissedClassForBusiness,
} from "@/lib/leads/arbox-missed-class";
import { syncArboxSessionsExpiringForBusiness } from "@/lib/leads/arbox-sessions-expiring";
import {
  fetchArboxBookingsReport,
  syncArboxTrialAttendedForBusiness,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Shared daily Arbox / Zoe-native trigger detection.
 * Steps: birthday, membership_expiring, bookingsReport (trial_attended + missed_*),
 * sessions_expiring, membership_cancelled.
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
  arbox_cancellation_seeded: boolean;
  arbox_missed_class_seeded: boolean;
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
    .select(
      "id, slug, crm_api_key, crm_box_id, arbox_cancellation_seeded, arbox_missed_class_seeded"
    )
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
    const cancellationSeeded =
      (row as { arbox_cancellation_seeded?: unknown }).arbox_cancellation_seeded === true;
    const missedClassSeeded =
      (row as { arbox_missed_class_seeded?: unknown }).arbox_missed_class_seeded === true;
    if (!Number.isFinite(id) || id <= 0 || !slug || !apiKey || !boxId) continue;
    businesses.push({
      id,
      slug,
      crm_api_key: apiKey,
      crm_box_id: boxId,
      arbox_cancellation_seeded: cancellationSeeded,
      arbox_missed_class_seeded: missedClassSeeded,
    });
  }

  const summaries: Array<{
    business_id: number;
    slug: string;
    birthday?: Awaited<ReturnType<typeof syncArboxBirthdaysForBusiness>>;
    membership_expiring?: Awaited<ReturnType<typeof syncArboxMembershipExpiringForBusiness>>;
    trial_attended?: Awaited<ReturnType<typeof syncArboxTrialAttendedForBusiness>>;
    missed_class?: Awaited<ReturnType<typeof syncArboxMissedClassForBusiness>>;
    sessions_expiring?: Awaited<ReturnType<typeof syncArboxSessionsExpiringForBusiness>>;
    membership_cancelled?: Awaited<ReturnType<typeof syncArboxMembershipCancelledForBusiness>>;
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
        customer_membership_pages: 0,
        customer_session_pages: 0,
        due_today: 0,
        processed: 0,
        dedup: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        no_phone: 0,
        errors: 1,
        members_due: 0,
        former_due: 0,
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

    // --- Shared bookingsReport fetch (trial_attended + missed_class + missed_trial) ---
    let prefetchedRows: ArboxBookingReportRow[] | undefined;
    let prefetchedPages = 0;
    let lookbackFrom: string | undefined;
    let lookbackTo: string | undefined;
    try {
      const plan = await businessNeedsBookingsReportFetch(admin, business.id);
      if (plan.needsFetch) {
        const window = bookingsReportSharedLookbackWindow({
          now,
          missedNeedsSeed: plan.hasMissedRule && !business.arbox_missed_class_seeded,
        });
        lookbackFrom = window.fromDate;
        lookbackTo = window.toDate;
        const report = await fetchArboxBookingsReport({
          apiKey: business.crm_api_key,
          fromDate: window.fromDate,
          toDate: window.toDate,
          locationId: business.crm_box_id,
        });
        prefetchedPages = report.pagesFetched;
        if (report.ok) {
          prefetchedRows = report.rows;
        } else {
          console.error("[cron/arbox-daily-triggers] shared bookingsReport failed", {
            slug: business.slug,
            error: report.error,
          });
        }
      }
    } catch (e) {
      console.error("[cron/arbox-daily-triggers] shared bookings prefetch threw", {
        slug: business.slug,
        error: e instanceof Error ? e.message : String(e),
      });
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
        prefetchedRows,
        prefetchedPages,
        lookbackFrom,
        lookbackTo,
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
        trial_attended: 0,
        skipped_non_trial: 0,
        processed: 0,
        dedup: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        not_attended: 0,
        no_phone: 0,
        errors: 1,
        fetch_error: message,
      };
    }

    // --- Step: missed_class + missed_trial (shared handler) ---
    try {
      entry.missed_class = await syncArboxMissedClassForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        missedClassSeeded: business.arbox_missed_class_seeded,
        now,
        prefetchedRows,
        prefetchedPages,
        lookbackFrom,
        lookbackTo,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] missed_class step threw", {
        slug: business.slug,
        error: message,
      });
      entry.missed_class = {
        fetched: 0,
        pages_fetched: 0,
        seeded: 0,
        missed_rows: 0,
        routed_class: 0,
        routed_trial: 0,
        processed: 0,
        already: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        no_phone: 0,
        abandoned: 0,
        errors: 1,
        fetch_error: message,
      };
    }

    // --- Step: sessions_expiring ---
    try {
      entry.sessions_expiring = await syncArboxSessionsExpiringForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        now,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] sessions_expiring step threw", {
        slug: business.slug,
        error: message,
      });
      entry.sessions_expiring = {
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
        skipped_no_end_date: 0,
        skipped_outside_horizon: 0,
        no_phone: 0,
        errors: 1,
        fetch_error: message,
      };
    }

    // --- Step: membership_cancelled ---
    try {
      entry.membership_cancelled = await syncArboxMembershipCancelledForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        cancellationSeeded: business.arbox_cancellation_seeded,
        now,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] membership_cancelled step threw", {
        slug: business.slug,
        error: message,
      });
      entry.membership_cancelled = {
        fetched: 0,
        pages_fetched: 0,
        seeded: 0,
        processed: 0,
        already: 0,
        skipped_filter: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        no_phone: 0,
        abandoned: 0,
        errors: 1,
        fetch_error: message,
      };
    }

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
