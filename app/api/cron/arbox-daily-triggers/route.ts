import { NextRequest, NextResponse } from "next/server";
import {
  sharedFutureBookingsWindow,
  syncArboxAttendanceGapForBusiness,
} from "@/lib/leads/arbox-attendance-gap";
import { syncArboxBirthdaysForBusiness } from "@/lib/leads/arbox-birthday";
import {
  businessNeedsFreezeSync,
  syncArboxFreezeForBusiness,
} from "@/lib/leads/arbox-freeze";
import { syncArboxLostLeadForBusiness } from "@/lib/leads/arbox-lost-lead";
import { syncArboxMembershipCancelledForBusiness } from "@/lib/leads/arbox-membership-cancelled";
import { syncArboxMembershipExpiringForBusiness } from "@/lib/leads/arbox-membership-expiring";
import {
  bookingsReportSharedLookbackWindow,
  businessNeedsBookingsReportFetch,
  syncArboxMissedClassForBusiness,
} from "@/lib/leads/arbox-missed-class";
import { syncArboxPostTrialFollowupForBusiness } from "@/lib/leads/arbox-post-trial-followup";
import { syncArboxSessionsExpiringForBusiness } from "@/lib/leads/arbox-sessions-expiring";
import {
  businessNeedsTrialReminderSync,
  syncArboxTrialReminderForBusiness,
} from "@/lib/leads/arbox-trial-reminder";
import {
  fetchArboxBookingsReport,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Shared daily Arbox / Zoe-native trigger detection.
 * Steps: birthday, membership_expiring, bookingsReport (missed_* + attendance_gap +
 * post-trial C5/C6), freeze cluster A8/C14/C15, trial_reminder, sessions_expiring,
 * membership_cancelled, lost_lead (A7).
 * Future bookings GET when freeze_ending or trial_reminder needs it
 * (attendance_gap does not need it). trial_reminder widens the window to today…+14.
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
  arbox_attendance_gap_seeded: boolean;
  arbox_post_trial_followup_seeded: boolean;
  arbox_freeze_seeded: boolean;
  arbox_lost_lead_seeded: boolean;
  arbox_trial_reminder_seeded: boolean;
  arbox_trial_membership_type_ids: unknown;
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
      "id, slug, crm_api_key, crm_box_id, arbox_cancellation_seeded, arbox_missed_class_seeded, arbox_attendance_gap_seeded, arbox_post_trial_followup_seeded, arbox_freeze_seeded, arbox_lost_lead_seeded, arbox_trial_reminder_seeded, arbox_trial_membership_type_ids"
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
    const attendanceGapSeeded =
      (row as { arbox_attendance_gap_seeded?: unknown }).arbox_attendance_gap_seeded === true;
    const postTrialFollowupSeeded =
      (row as { arbox_post_trial_followup_seeded?: unknown }).arbox_post_trial_followup_seeded ===
      true;
    const freezeSeeded =
      (row as { arbox_freeze_seeded?: unknown }).arbox_freeze_seeded === true;
    const lostLeadSeeded =
      (row as { arbox_lost_lead_seeded?: unknown }).arbox_lost_lead_seeded === true;
    const trialReminderSeeded =
      (row as { arbox_trial_reminder_seeded?: unknown }).arbox_trial_reminder_seeded === true;
    const trialMembershipTypeIds = (row as { arbox_trial_membership_type_ids?: unknown })
      .arbox_trial_membership_type_ids;
    if (!Number.isFinite(id) || id <= 0 || !slug || !apiKey || !boxId) continue;
    businesses.push({
      id,
      slug,
      crm_api_key: apiKey,
      crm_box_id: boxId,
      arbox_cancellation_seeded: cancellationSeeded,
      arbox_missed_class_seeded: missedClassSeeded,
      arbox_attendance_gap_seeded: attendanceGapSeeded,
      arbox_post_trial_followup_seeded: postTrialFollowupSeeded,
      arbox_freeze_seeded: freezeSeeded,
      arbox_lost_lead_seeded: lostLeadSeeded,
      arbox_trial_reminder_seeded: trialReminderSeeded,
      arbox_trial_membership_type_ids: trialMembershipTypeIds,
    });
  }

  const summaries: Array<{
    business_id: number;
    slug: string;
    birthday?: Awaited<ReturnType<typeof syncArboxBirthdaysForBusiness>>;
    membership_expiring?: Awaited<ReturnType<typeof syncArboxMembershipExpiringForBusiness>>;
    post_trial_followup?: Awaited<ReturnType<typeof syncArboxPostTrialFollowupForBusiness>>;
    missed_class?: Awaited<ReturnType<typeof syncArboxMissedClassForBusiness>>;
    attendance_gap?: Awaited<ReturnType<typeof syncArboxAttendanceGapForBusiness>>;
    freeze?: Awaited<ReturnType<typeof syncArboxFreezeForBusiness>>;
    sessions_expiring?: Awaited<ReturnType<typeof syncArboxSessionsExpiringForBusiness>>;
    membership_cancelled?: Awaited<ReturnType<typeof syncArboxMembershipCancelledForBusiness>>;
    lost_lead?: Awaited<ReturnType<typeof syncArboxLostLeadForBusiness>>;
    trial_reminder?: Awaited<ReturnType<typeof syncArboxTrialReminderForBusiness>>;
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

    // --- Shared bookingsReport fetch (trial + missed_* + attendance_gap past) ---
    let prefetchedRows: ArboxBookingReportRow[] | undefined;
    let prefetchedPages = 0;
    let lookbackFrom: string | undefined;
    let lookbackTo: string | undefined;
    let hasAttendanceGapRule = false;
    try {
      const plan = await businessNeedsBookingsReportFetch(admin, business.id);
      hasAttendanceGapRule = plan.hasAttendanceGapRule;
      if (plan.needsFetch) {
        const window = bookingsReportSharedLookbackWindow({
          now,
          missedNeedsSeed: plan.hasMissedRule && !business.arbox_missed_class_seeded,
          forceWidePast: plan.hasAttendanceGapRule || plan.hasPostTrialFollowupRule,
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

    // --- Shared future bookings (C14/C15 freeze ending + trial_reminder) ---
    let prefetchedFutureRows: ArboxBookingReportRow[] | undefined;
    let prefetchedFuturePages = 0;
    let freezePlan = { needsFreeze: false, needsEndingFuture: false };
    let trialReminderPlan = { needsTrialReminder: false, hasTrialProductIds: false };
    try {
      freezePlan = await businessNeedsFreezeSync(admin, business.id);
      trialReminderPlan = await businessNeedsTrialReminderSync(
        admin,
        business.id,
        business.arbox_trial_membership_type_ids
      );
      const includeToday =
        trialReminderPlan.needsTrialReminder && trialReminderPlan.hasTrialProductIds;
      const needsFuture = freezePlan.needsEndingFuture || includeToday;
      if (needsFuture) {
        const futureWindow = sharedFutureBookingsWindow(now, { includeToday });
        const futureReport = await fetchArboxBookingsReport({
          apiKey: business.crm_api_key,
          fromDate: futureWindow.fromDate,
          toDate: futureWindow.toDate,
          locationId: business.crm_box_id,
        });
        prefetchedFuturePages = futureReport.pagesFetched;
        if (futureReport.ok) {
          prefetchedFutureRows = futureReport.rows;
        } else {
          console.error("[cron/arbox-daily-triggers] shared future bookings failed", {
            slug: business.slug,
            error: futureReport.error,
          });
        }
      }
    } catch (e) {
      console.error("[cron/arbox-daily-triggers] shared future prefetch threw", {
        slug: business.slug,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // --- Step: post-trial C5/C6 (bookings × sales) ---
    try {
      entry.post_trial_followup = await syncArboxPostTrialFollowupForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        postTrialFollowupSeeded: business.arbox_post_trial_followup_seeded,
        now,
        ...(prefetchedRows
          ? {
              prefetchedPastRows: prefetchedRows,
              prefetchedPastPages: prefetchedPages,
              lookbackFrom,
              lookbackTo,
            }
          : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] post_trial_followup step threw", {
        slug: business.slug,
        error: message,
      });
      entry.post_trial_followup = {
        fetched_bookings: 0,
        fetched_sales: 0,
        pages_fetched: 0,
        trial_attended: 0,
        due: 0,
        seeded: 0,
        soft_seeded: 0,
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

    // --- Step: attendance_gap ---
    try {
      entry.attendance_gap = await syncArboxAttendanceGapForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        attendanceGapSeeded: business.arbox_attendance_gap_seeded,
        now,
        ...(hasAttendanceGapRule && prefetchedRows
          ? {
              prefetchedPastRows: prefetchedRows,
              prefetchedPastPages: prefetchedPages,
              lookbackFrom,
              lookbackTo,
            }
          : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] attendance_gap step threw", {
        slug: business.slug,
        error: message,
      });
      entry.attendance_gap = {
        fetched_past: 0,
        pages_fetched: 0,
        users_with_gap: 0,
        seeded: 0,
        soft_seeded: 0,
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

    // --- Step: freeze_created + freeze_ending_* (A8 / C14 / C15) ---
    try {
      entry.freeze = await syncArboxFreezeForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        freezeSeeded: business.arbox_freeze_seeded,
        now,
        ...(freezePlan.needsEndingFuture && prefetchedFutureRows
          ? {
              prefetchedFutureRows,
              prefetchedFuturePages,
            }
          : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] freeze step threw", {
        slug: business.slug,
        error: message,
      });
      entry.freeze = {
        fetched_holds: 0,
        fetched_future: 0,
        pages_fetched: 0,
        created_seeded: 0,
        ending_seeded: 0,
        soft_seeded: 0,
        created_processed: 0,
        ending_processed: 0,
        already: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        no_phone: 0,
        abandoned: 0,
        skipped_ended: 0,
        errors: 1,
        fetch_error: message,
      };
    }

    // --- Step: trial_reminder ---
    try {
      entry.trial_reminder = await syncArboxTrialReminderForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        trialReminderSeeded: business.arbox_trial_reminder_seeded,
        businessTrialIds: business.arbox_trial_membership_type_ids,
        now,
        ...(trialReminderPlan.needsTrialReminder &&
        trialReminderPlan.hasTrialProductIds &&
        prefetchedFutureRows
          ? {
              prefetchedFutureRows,
              prefetchedFuturePages,
            }
          : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] trial_reminder step threw", {
        slug: business.slug,
        error: message,
      });
      entry.trial_reminder = {
        fetched: 0,
        pages_fetched: 0,
        trial_rows: 0,
        due: 0,
        seeded: 0,
        soft_seeded: 0,
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
        skipped_rejoined: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        no_phone: 0,
        abandoned: 0,
        errors: 1,
        fetch_error: message,
      };
    }

    // --- Step: lost_lead (A7) ---
    try {
      entry.lost_lead = await syncArboxLostLeadForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        lostLeadSeeded: business.arbox_lost_lead_seeded,
        now,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] lost_lead step threw", {
        slug: business.slug,
        error: message,
      });
      entry.lost_lead = {
        fetched: 0,
        pages_fetched: 0,
        seeded: 0,
        soft_seeded: 0,
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
