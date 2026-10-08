import { getArboxApiKey } from "@/lib/business-secret-read";
import {
  ARBOX_BACKGROUND_PAUSE_COLUMN,
  ARBOX_BACKGROUND_PAUSED,
  rowArboxBackgroundPaused,
} from "@/lib/arbox-background-pause";
import {
  sharedFutureBookingsWindow,
  syncArboxAttendanceGapForBusiness,
} from "@/lib/leads/arbox-attendance-gap";
import { syncArboxBirthdaysForBusiness, businessNeedsBirthdayCustomerSet } from "@/lib/leads/arbox-birthday";
import {
  businessNeedsDaysInClubSync,
  syncArboxDaysInClubForBusiness,
} from "@/lib/leads/arbox-days-in-club";
import {
  businessNeedsNthWorkoutSync,
  nthWorkoutNeedsFutureBookings,
  syncArboxNthWorkoutForBusiness,
} from "@/lib/leads/arbox-nth-workout";
import { fetchArboxActiveProductKeys, type ActiveProductKeys } from "@/lib/leads/arbox-active-product";
import { memberFlagReportIsComplete, syncArboxMemberFlags } from "@/lib/leads/arbox-member-flag";
import {
  fetchArboxStaffMembers,
  loadStoredStaffIndex,
  loadTaughtStaffWindow,
  loadUpcomingStaffWindow,
  qualifyingStaffPeople,
  staffIndexFromPeople,
  staffTaughtBounds,
  staffTaughtFromBookings,
  staffUpcomingBounds,
  syncArboxStaffFlags,
  type StaffPerson,
} from "@/lib/leads/arbox-staff";
import { fetchArboxActiveMembershipsReport } from "@/lib/leads/arbox-customer-set";
import {
  businessNeedsFreezeSync,
  syncArboxFreezeForBusiness,
} from "@/lib/leads/arbox-freeze";
import { syncArboxLeadStatusForBusiness } from "@/lib/leads/arbox-lead-status-change";
import { syncArboxLostLeadForBusiness } from "@/lib/leads/arbox-lost-lead";
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
  businessNeedsTrainerTrialHeadsUpSync,
  syncArboxTrainerTrialHeadsUpForBusiness,
} from "@/lib/leads/arbox-trainer-trial-heads-up";
import { syncArboxClassCancelledStaffForBusiness } from "@/lib/leads/arbox-class-cancelled-staff";
import {
  fetchArboxBookingsReport,
  rememberSharedFutureBookings,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { ARBOX_DAILY_ACTIVE_PRODUCT_TRIGGER_TYPES, ARBOX_DAILY_TRIGGER_TYPES } from "@/lib/leads/arbox-daily-triggers-dispatch";
import { arboxDailyContext, isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-context";
import { resolveCronNow } from "@/lib/cron-clock";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const BUSINESS_SELECT =
  "id, slug, crm_type, crm_api_key, crm_api_key_enc, crm_box_id, arbox_cancellation_seeded, arbox_missed_class_seeded, arbox_attendance_gap_seeded, arbox_post_trial_followup_seeded, arbox_freeze_seeded, arbox_lost_lead_seeded, arbox_trial_reminder_seeded, arbox_days_in_club_seeded, arbox_nth_workout_seeded, arbox_trial_membership_type_ids";

export type ArboxDailyBusiness = {
  id: number;
  slug: string;
  apiKey: string;
  crm_box_id: string;
  arbox_cancellation_seeded: boolean;
  arbox_missed_class_seeded: boolean;
  arbox_attendance_gap_seeded: boolean;
  arbox_post_trial_followup_seeded: boolean;
  arbox_freeze_seeded: boolean;
  arbox_lost_lead_seeded: boolean;
  arbox_trial_reminder_seeded: boolean;
  arbox_days_in_club_seeded: boolean;
  arbox_nth_workout_seeded: boolean;
  arbox_trial_membership_type_ids: unknown;
  arbox_background_paused?: boolean;
};

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ArboxDailyStepTiming = {
  step: string;
  business_id: number;
  ms: number;
  rows: number;
  sent: number;
  enqueued: number;
  skipped: number;
};

const SKIP_KEYS = [
  "dedup",
  "already",
  "gated",
  "no_phone",
  "skipped_renewed",
  "skipped_cancelled",
  "skipped_past_due",
  "skipped_expired_end",
  "skipped_no_end_date",
  "skipped_outside_horizon",
  "skipped_filter",
  "skipped_rejoined",
  "skipped_active",
  "skipped_recent_checkin",
  "abandoned",
] as const;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stepCounts(summary: unknown): {
  rows: number;
  sent: number;
  enqueued: number;
  skipped: number;
} {
  const record =
    summary && typeof summary === "object" ? (summary as Record<string, unknown>) : {};
  const rows =
    num(record.fetched) ||
    num(record.fetched_bookings) ||
    num(record.fetched_past) ||
    num(record.fetched_holds) ||
    num(record.fetched_memberships) ||
    num(record.fetched_cancelled) ||
    0;
  let skipped = 0;
  for (const key of SKIP_KEYS) skipped += num(record[key]);
  if (record.skipped === true && skipped === 0) skipped = 1;
  return { rows, sent: num(record.notified), enqueued: num(record.deferred), skipped };
}

function noteStep(
  timings: ArboxDailyStepTiming[],
  businessId: number,
  step: string,
  ms: number,
  summary: unknown
): void {
  const counts = stepCounts(summary);
  timings.push({ step, business_id: businessId, ms, ...counts });
  console.info("[cron/arbox-daily-triggers/business] step", {
    step,
    business_id: businessId,
    ms,
    rows: counts.rows,
    sent: counts.sent,
    enqueued: counts.enqueued,
    skipped: counts.skipped,
  });
}

async function timeStep<T>(
  timings: ArboxDailyStepTiming[],
  businessId: number,
  step: string,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    noteStep(timings, businessId, step, Date.now() - started, result);
    return result;
  } catch (e) {
    noteStep(timings, businessId, step, Date.now() - started, { errors: 1 });
    throw e;
  }
}

function flag(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true;
}

export function parseArboxDailyBusiness(row: Record<string, unknown>, apiKey: string): ArboxDailyBusiness | null {
  const id = Number(row.id);
  const slug = String(row.slug ?? "").trim().toLowerCase();
  const key = apiKey.trim();
  const boxId = String(row.crm_box_id ?? "").trim();
  const crmType = String(row.crm_type ?? "").trim().toLowerCase();
  if (crmType !== "arbox") return null;
  if (!Number.isFinite(id) || id <= 0 || !slug || !key || !boxId) return null;
  return {
    id,
    slug,
    apiKey: key,
    crm_box_id: boxId,
    arbox_cancellation_seeded: flag(row, "arbox_cancellation_seeded"),
    arbox_missed_class_seeded: flag(row, "arbox_missed_class_seeded"),
    arbox_attendance_gap_seeded: flag(row, "arbox_attendance_gap_seeded"),
    arbox_post_trial_followup_seeded: flag(row, "arbox_post_trial_followup_seeded"),
    arbox_freeze_seeded: flag(row, "arbox_freeze_seeded"),
    arbox_lost_lead_seeded: flag(row, "arbox_lost_lead_seeded"),
    arbox_trial_reminder_seeded: flag(row, "arbox_trial_reminder_seeded"),
    arbox_days_in_club_seeded: flag(row, "arbox_days_in_club_seeded"),
    arbox_nth_workout_seeded: flag(row, "arbox_nth_workout_seeded"),
    arbox_trial_membership_type_ids: row.arbox_trial_membership_type_ids,
    arbox_background_paused: rowArboxBackgroundPaused(row),
  };
}

/** Arbox businesses with a key, a box, and at least one enabled rule this cron runs. */
export async function listArboxDailyBusinessIds(
  admin: Admin,
  opts?: { slot?: "morning" | "evening" }
): Promise<{ ok: true; ids: number[]; paused: number[] } | { ok: false; error: string }> {
  const { data: businessRows, error: bizErr } = await admin
    .from("businesses")
    .select(`id, slug, crm_type, crm_api_key, crm_api_key_enc, crm_box_id, ${ARBOX_BACKGROUND_PAUSE_COLUMN}`)
    .eq("crm_type", "arbox")
    .or("crm_api_key.not.is.null,crm_api_key_enc.not.is.null")
    .not("crm_box_id", "is", null);
  if (bizErr) return { ok: false, error: bizErr.message };

  const eligible: number[] = [];
  const paused: number[] = [];
  for (const row of (businessRows ?? []) as unknown as Record<string, unknown>[]) {
    const parsed = parseArboxDailyBusiness(
      {
        ...(row as Record<string, unknown>),
        crm_type: "arbox",
      },
      getArboxApiKey(row)
    );
    if (!parsed) continue;
    if (parsed.arbox_background_paused) paused.push(parsed.id);
    else eligible.push(parsed.id);
  }
  if (!eligible.length) return { ok: true, ids: [], paused };

  const evening = opts?.slot === "evening";
  const ruleQuery = admin
    .from("template_triggers")
    .select(
      evening
        ? "business_id, template_name, trigger_type, delay_direction"
        : "business_id, template_name"
    )
    .in("business_id", eligible)
    .eq("enabled", true);
  const { data: rules, error: ruleErr } = evening
    ? await ruleQuery.in("trigger_type", [
        "trial_reminder",
        "trainer_trial_heads_up",
        "nth_workout",
        "lead_status_changed",
        "registered_after_trial",
        "not_registered_after_trial",
      ])
    : await ruleQuery.in("trigger_type", [...ARBOX_DAILY_TRIGGER_TYPES]);
  if (ruleErr) return { ok: false, error: ruleErr.message };

  const withRule = new Set<number>();
  for (const row of rules ?? []) {
    if (!String((row as { template_name?: unknown }).template_name ?? "").trim()) continue;
    if (evening) {
      const type = String((row as { trigger_type?: unknown }).trigger_type ?? "");
      const direction = String((row as { delay_direction?: unknown }).delay_direction ?? "")
        .trim()
        .toLowerCase();
      if (type === "nth_workout" && direction !== "before") continue;
    }
    const id = Number((row as { business_id?: unknown }).business_id);
    if (Number.isFinite(id)) withRule.add(id);
  }
  return { ok: true, ids: eligible.filter((id) => withRule.has(id)), paused };
}

export async function loadArboxDailyBusiness(
  admin: Admin,
  businessId: number
): Promise<ArboxDailyBusiness | null> {
  const { data, error } = await admin
    .from("businesses")
    .select(`${BUSINESS_SELECT}, ${ARBOX_BACKGROUND_PAUSE_COLUMN}`)
    .eq("id", businessId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;
  return parseArboxDailyBusiness(row, getArboxApiKey(row));
}

export type ArboxDailyBusinessRun = {
  business_id: number;
  slug: string;
  elapsed_ms: number;
  arbox_calls: number;
  arbox_reports: string[];
  steps: ArboxDailyStepTiming[];
  summary: { business_id: number; slug: string; [step: string]: unknown };
  would_send?: { template: string; phone_tail: string; params: string[] }[];
};

/**
 * One business, same step order as the previous sequential cron.
 * Future bookingsReport is fetched at most once (widest window) and reused.
 * Active-product keys are fetched only when a suppress step is enabled.
 */
async function runLeadStatusChangedStep(input: {
  admin: Admin;
  business: ArboxDailyBusiness;
  now: Date;
  slot: "morning" | "evening";
  timings: ArboxDailyStepTiming[];
  entry: { [step: string]: unknown };
}): Promise<void> {
  try {
    input.entry.lead_status_changed = await timeStep(input.timings, input.business.id, "lead_status_changed", () =>
      syncArboxLeadStatusForBusiness({
        admin: input.admin,
        businessId: input.business.id,
        businessSlug: input.business.slug,
        apiKey: input.business.apiKey,
        boxId: input.business.crm_box_id,
        now: input.now,
        slot: input.slot,
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-daily-triggers] lead_status_changed step threw", {
      slug: input.business.slug,
      error: message,
    });
    input.entry.lead_status_changed = { errors: 1, fetch_error: message, notified: 0 };
  }
}

export async function runArboxDailyTriggersForBusiness(input: {
  admin: Admin;
  business: ArboxDailyBusiness;
  now?: Date;
  /**
   * EVENING_SLOT_IL Asia/Jerusalem via ?slot=evening. Trial reminder, trainer heads-up,
   * nth_workout before-rules, post-trial C5/C6 catch-up, and lead_status_changed.
   * Clock hour is not checked here.
   */
  slot?: "morning" | "evening";
}): Promise<ArboxDailyBusinessRun> {
  const admin = input.admin;
  const business = input.business;
  const slot = input.slot === "evening" ? "evening" : "morning";
  const resolvedNow = resolveCronNow(input.now, isArboxDailyDryRun());
  if (!resolvedNow.ok) {
    console.error("[cron/arbox-daily-triggers] refused time override without dry run", {
      slug: business.slug,
      slot,
    });
    return {
      business_id: business.id,
      slug: business.slug,
      elapsed_ms: 0,
      arbox_calls: 0,
      arbox_reports: [],
      steps: [],
      summary: {
        business_id: business.id,
        slug: business.slug,
        slot,
        skip_reason: resolvedNow.error,
      },
      would_send: [],
    };
  }
  const now = resolvedNow.now;
  if (business.arbox_background_paused) {
    console.info("[cron/arbox-daily-triggers] arbox background paused", { slug: business.slug, slot });
    return {
      business_id: business.id,
      slug: business.slug,
      elapsed_ms: 0,
      arbox_calls: 0,
      arbox_reports: [],
      steps: [],
      summary: {
        business_id: business.id,
        slug: business.slug,
        slot,
        skip_reason: ARBOX_BACKGROUND_PAUSED,
      },
      would_send: [],
    };
  }
  const timings: ArboxDailyStepTiming[] = [];
  const started = Date.now();
  const entry: { business_id: number; slug: string; [step: string]: unknown } = {
    business_id: business.id,
    slug: business.slug,
    slot,
  };

  const staffCtx = arboxDailyContext();
  let morningRoster: StaffPerson[] | null = null;
  let morningRosterPages = 0;
  if (slot === "morning") {
    const roster = await fetchArboxStaffMembers({
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
    });
    if (roster.ok) {
      morningRoster = roster.people;
      morningRosterPages = roster.pages;
    } else {
      console.error("[arbox-staff] fetch failed — keep previous flags", {
        slug: business.slug,
        error: roster.error,
        pages: roster.pages,
      });
    }
  } else if (staffCtx && staffCtx.businessId === business.id) {
    const stored = await loadStoredStaffIndex(admin, business.id);
    if (stored.ready) staffCtx.staffIndex = stored;
  }

  if (slot === "evening") {
    try {
      entry.trial_reminder = await timeStep(timings, business.id, "trial_reminder", () =>
        syncArboxTrialReminderForBusiness({
          admin,
          businessId: business.id,
          businessSlug: business.slug,
          apiKey: business.apiKey,
          boxId: business.crm_box_id,
          trialReminderSeeded: business.arbox_trial_reminder_seeded,
          businessTrialIds: business.arbox_trial_membership_type_ids,
          now,
          slot: "evening",
        })
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] evening trial_reminder threw", {
        slug: business.slug,
        error: message,
      });
      entry.trial_reminder = { errors: 1, fetch_error: message };
    }
    try {
      entry.trainer_trial_heads_up = await timeStep(timings, business.id, "trainer_trial_heads_up", () =>
        syncArboxTrainerTrialHeadsUpForBusiness({
          admin,
          businessId: business.id,
          businessSlug: business.slug,
          apiKey: business.apiKey,
          boxId: business.crm_box_id,
          businessTrialIds: business.arbox_trial_membership_type_ids,
          now,
          slot: "evening",
        })
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] evening trainer_trial_heads_up threw", {
        slug: business.slug,
        error: message,
      });
      entry.trainer_trial_heads_up = { errors: 1, fetch_error: message };
    }
    try {
      entry.nth_workout = await timeStep(timings, business.id, "nth_workout", () =>
        syncArboxNthWorkoutForBusiness({
          admin,
          businessId: business.id,
          businessSlug: business.slug,
          apiKey: business.apiKey,
          boxId: business.crm_box_id,
          nthWorkoutSeeded: business.arbox_nth_workout_seeded,
          now,
          slot: "evening",
        })
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] evening nth_workout threw", {
        slug: business.slug,
        error: message,
      });
      entry.nth_workout = {
        fetched_memberships: 0,
        fetched_bookings: 0,
        pages_fetched: 0,
        new_members: 0,
        due: 0,
        seeded: 0,
        soft_seeded: 0,
        processed: 0,
        already: 0,
        notified: 0,
        gated: 0,
        no_phone: 0,
        abandoned: 0,
        errors: 1,
        fetch_error: message,
      };
    }
    // C5/C6: due-today still sends; wrongly soft-seeded decision-day rows reopen.
    // History seeds (decision day already past) stay blocked. IO only when a rule
    // is enabled: bookings lookback + salesReport (+ active product for C6).
    try {
      entry.post_trial_followup = await timeStep(timings, business.id, "post_trial_followup", () =>
        syncArboxPostTrialFollowupForBusiness({
          admin,
          businessId: business.id,
          businessSlug: business.slug,
          apiKey: business.apiKey,
          boxId: business.crm_box_id,
          postTrialFollowupSeeded: business.arbox_post_trial_followup_seeded,
          now,
        })
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-daily-triggers] evening post_trial_followup threw", {
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
    await runLeadStatusChangedStep({ admin, business, now, slot: "evening", timings, entry });
    const ctx = arboxDailyContext();
    return {
      business_id: business.id,
      slug: business.slug,
      elapsed_ms: Date.now() - started,
      arbox_calls: ctx?.arboxCalls ?? 0,
      arbox_reports: [...(ctx?.arboxReports ?? [])],
      steps: timings,
      summary: entry,
      would_send: ctx?.wouldSend ?? [],
    };
  }

  // --- Shared activeMembershipsReport (birthday customer set + C8 days-in-club + C7 nth_workout) ---
  let prefetchedMembershipRows: Record<string, unknown>[] | undefined;
  let prefetchedMembershipPages = 0;
  let prefetchedMembershipsHitPageCap = false;
  let prefetchedSessionRows: Record<string, unknown>[] | undefined;
  let prefetchedSessionsHitPageCap = false;
  let sessionsLoaded = false;
  let membershipFlagReport: {
    ok: boolean;
    hitPageCap: boolean;
    rows: Record<string, unknown>[];
  } | null = null;
  try {
    const [needsBirthday, needsDaysInClub, needsNthWorkout] = await Promise.all([
      businessNeedsBirthdayCustomerSet(admin, business.id),
      businessNeedsDaysInClubSync(admin, business.id),
      businessNeedsNthWorkoutSync(admin, business.id),
    ]);
    if (needsBirthday || needsDaysInClub || needsNthWorkout) {
      const memberships = await fetchArboxActiveMembershipsReport({
        apiKey: business.apiKey,
        boxId: business.crm_box_id,
        now,
      });
      prefetchedMembershipPages = memberships.pagesFetched;
      if (memberships.ok) {
        prefetchedMembershipRows = memberships.rows;
        prefetchedMembershipsHitPageCap = memberships.hitPageCap;
        membershipFlagReport = {
          ok: true,
          hitPageCap: memberships.hitPageCap,
          rows: memberships.rows,
        };
      } else {
        membershipFlagReport = { ok: false, hitPageCap: false, rows: [] };
        console.error("[cron/arbox-daily-triggers] shared activeMembershipsReport failed", {
          slug: business.slug,
          error: memberships.error,
        });
      }
    }
  } catch (e) {
    console.error("[cron/arbox-daily-triggers] shared memberships prefetch threw", {
      slug: business.slug,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  let sharedActiveKeys: ActiveProductKeys | undefined;
  let prefetchedFutureRows: ArboxBookingReportRow[] | undefined;
  let prefetchedFuturePages = 0;
  let freezePlan = { needsFreeze: false, needsEndingFuture: false };
  let trialReminderPlan = { needsTrialReminder: false, hasTrialProductIds: false };
  let trainerHeadsUpPlan = { needsTrainerTrialHeadsUp: false, hasTrialProductIds: false };
  let needsActiveProduct = false;
  let nthBefore = false;
  try {
    const [suppressRes, freeze, trial, trainer, nthBeforePlan] = await Promise.all([
      admin
        .from("template_triggers")
        .select("trigger_type, template_name")
        .eq("business_id", business.id)
        .eq("enabled", true)
        .in("trigger_type", [...ARBOX_DAILY_ACTIVE_PRODUCT_TRIGGER_TYPES]),
      businessNeedsFreezeSync(admin, business.id),
      businessNeedsTrialReminderSync(
        admin,
        business.id,
        business.arbox_trial_membership_type_ids
      ),
      businessNeedsTrainerTrialHeadsUpSync(
        admin,
        business.id,
        business.arbox_trial_membership_type_ids
      ),
      nthWorkoutNeedsFutureBookings(admin, business.id),
    ]);
    freezePlan = freeze;
    trialReminderPlan = trial;
    trainerHeadsUpPlan = trainer;
    nthBefore = nthBeforePlan;
    if (suppressRes.error) {
      console.error("[cron/arbox-daily-triggers/business] active-product rule lookup failed", {
        business_id: business.id,
        error: suppressRes.error.message,
      });
      needsActiveProduct = true;
    } else {
      needsActiveProduct = (suppressRes.data ?? []).some((row) =>
        String((row as { template_name?: unknown }).template_name ?? "").trim()
      );
    }
  } catch (e) {
    needsActiveProduct = true;
    console.error("[cron/arbox-daily-triggers/business] prefetch plan threw", {
      business_id: business.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Widest future bookings window needed by any consumer this run.
  // includeToday → today…+14 (active product, trial reminder, trainer heads-up, nth before).
  // freeze-only → today+1…+14. Freeze ignores class dates <= today, so a wider
  // payload does not change booked vs unbooked.
  // nth before adds one Arbox bookings GET per business per day only while a before rule is live.
  const futureIncludeToday =
    needsActiveProduct ||
    nthBefore ||
    (trialReminderPlan.needsTrialReminder && trialReminderPlan.hasTrialProductIds) ||
    (trainerHeadsUpPlan.needsTrainerTrialHeadsUp && trainerHeadsUpPlan.hasTrialProductIds);
  const needsFuture = futureIncludeToday || freezePlan.needsEndingFuture;
  if (needsFuture) {
    const futureStarted = Date.now();
    const futureWindow = sharedFutureBookingsWindow(now, { includeToday: futureIncludeToday });
    try {
      const futureReport = await fetchArboxBookingsReport({
        apiKey: business.apiKey,
        fromDate: futureWindow.fromDate,
        toDate: futureWindow.toDate,
        locationId: business.crm_box_id,
      });
      rememberSharedFutureBookings(
        futureReport.ok
          ? {
              ok: true,
              rows: futureReport.rows,
              pagesFetched: futureReport.pagesFetched,
              fromDate: futureWindow.fromDate,
              toDate: futureWindow.toDate,
            }
          : {
              ok: false,
              error: futureReport.error,
              pagesFetched: futureReport.pagesFetched,
              fromDate: futureWindow.fromDate,
              toDate: futureWindow.toDate,
            }
      );
      prefetchedFuturePages = futureReport.pagesFetched;
      if (futureReport.ok) {
        prefetchedFutureRows = futureReport.rows;
      } else {
        console.error("[cron/arbox-daily-triggers] shared future bookings failed", {
          slug: business.slug,
          error: futureReport.error,
        });
      }
      noteStep(timings, business.id, "prefetch_future_bookings", Date.now() - futureStarted, {
        fetched: futureReport.ok ? futureReport.rows.length : 0,
        pages_fetched: futureReport.pagesFetched,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      rememberSharedFutureBookings({
        ok: false,
        error: message,
        pagesFetched: 0,
        fromDate: futureWindow.fromDate,
        toDate: futureWindow.toDate,
      });
      console.error("[cron/arbox-daily-triggers] shared future prefetch threw", {
        slug: business.slug,
        error: message,
      });
      noteStep(timings, business.id, "prefetch_future_bookings", Date.now() - futureStarted, {
        errors: 1,
        fetch_error: message,
      });
    }
  }

  if (needsActiveProduct) {
    const productStarted = Date.now();
    try {
      const products = await fetchArboxActiveProductKeys({
        apiKey: business.apiKey,
        boxId: business.crm_box_id,
        now,
        trialMembershipTypeIds: business.arbox_trial_membership_type_ids,
        ...(prefetchedMembershipRows
          ? { prefetchedMembershipRows, prefetchedMembershipsHitPageCap }
          : {}),
        ...(prefetchedFutureRows ? { prefetchedFutureRows } : {}),
      });
      if (products.ok) {
        sharedActiveKeys = products.keys;
        membershipFlagReport = {
          ok: true,
          hitPageCap: products.membershipsHitPageCap,
          rows: products.membershipRows,
        };
        prefetchedSessionRows = products.sessionRows;
        prefetchedSessionsHitPageCap = products.sessionsHitPageCap;
        sessionsLoaded = true;
      } else {
        if (!membershipFlagReport?.ok) {
          membershipFlagReport = { ok: false, hitPageCap: false, rows: [] };
        }
        console.error("[cron/arbox-daily-triggers] active product fetch failed", {
          slug: business.slug,
          error: products.error,
        });
      }
      noteStep(timings, business.id, "prefetch_active_product", Date.now() - productStarted, {
        fetched: products.ok ? products.membershipRows.length : 0,
      });
    } catch (e) {
      console.error("[cron/arbox-daily-triggers] active product prefetch threw", {
        slug: business.slug,
        error: e instanceof Error ? e.message : String(e),
      });
      noteStep(timings, business.id, "prefetch_active_product", Date.now() - productStarted, {
        errors: 1,
      });
    }
  } else {
    noteStep(timings, business.id, "prefetch_active_product", 0, { skipped: true });
  }
  // Member flags only after a complete activeMembershipsReport. A failed or
  // page-capped report leaves existing true/false values untouched.
  if (membershipFlagReport && memberFlagReportIsComplete(membershipFlagReport)) {
    try {
      const flags = await syncArboxMemberFlags({
        admin,
        businessId: business.id,
        membershipRows: membershipFlagReport.rows,
        reportComplete: true,
        now,
      });
      console.info("[cron/arbox-daily-triggers] member flags", {
        slug: business.slug,
        ...flags,
      });
    } catch (e) {
      console.error("[cron/arbox-daily-triggers] member flags threw", {
        slug: business.slug,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // --- Shared bookingsReport fetch (trial + missed_* + attendance_gap past) ---
  let prefetchedRows: ArboxBookingReportRow[] | undefined;
  let prefetchedPages = 0;
  let lookbackFrom: string | undefined;
  let lookbackTo: string | undefined;
  let hasAttendanceGapRule = false;
  let pastBookingsFailed = false;
  try {
    const plan = await businessNeedsBookingsReportFetch(admin, business.id);
    hasAttendanceGapRule = plan.hasAttendanceGapRule;
    if (plan.needsFetch) {
      const window = bookingsReportSharedLookbackWindow({
        now,
        missedNeedsSeed: plan.hasMissedRule && !business.arbox_missed_class_seeded,
        forceWidePast:
          plan.hasAttendanceGapRule || plan.hasPostTrialFollowupRule || plan.hasNthWorkoutRule,
      });
      lookbackFrom = window.fromDate;
      lookbackTo = window.toDate;
      const report = await fetchArboxBookingsReport({
        apiKey: business.apiKey,
        fromDate: window.fromDate,
        toDate: window.toDate,
        locationId: business.crm_box_id,
      });
      prefetchedPages = report.pagesFetched;
      if (report.ok) {
        prefetchedRows = report.rows;
      } else {
        pastBookingsFailed = true;
        console.error("[cron/arbox-daily-triggers] shared bookingsReport failed", {
          slug: business.slug,
          error: report.error,
        });
      }
    }
  } catch (e) {
    pastBookingsFailed = true;
    console.error("[cron/arbox-daily-triggers] shared bookings prefetch threw", {
      slug: business.slug,
      error: e instanceof Error ? e.message : String(e),
    });
  }


  if (slot === "morning" && morningRoster) {
    const futureMissing = needsFuture && prefetchedFutureRows == null;
    if (pastBookingsFailed || futureMissing) {
      console.error("[arbox-staff] bookings trainer read failed — keep previous flags", {
        slug: business.slug,
        past: pastBookingsFailed,
        future: futureMissing,
      });
    } else {
      const taught = await loadTaughtStaffWindow(admin, business.id, now);
      if (!taught.ok) {
        console.error("[arbox-staff] snapshot read failed — bookings still count", {
          slug: business.slug,
          error: taught.error,
        });
      }
      const upcomingSnap = await loadUpcomingStaffWindow(admin, business.id, now);
      if (!upcomingSnap.ok) {
        console.error("[arbox-staff] upcoming snapshot read failed — bookings still count", {
          slug: business.slug,
          error: upcomingSnap.error,
        });
      }
      const bounds = staffTaughtBounds(now);
      const ahead = staffUpcomingBounds(now);
      const booking = staffTaughtFromBookings({
        roster: morningRoster,
        rows: (prefetchedRows ?? []) as unknown as Record<string, unknown>[],
        todayYmd: bounds.todayYmd,
        nowMinutes: bounds.nowMinutes,
        fromYmd: bounds.fromYmd,
      });
      const upcoming = staffTaughtFromBookings({
        roster: morningRoster,
        rows: (prefetchedFutureRows ?? []) as unknown as Record<string, unknown>[],
        todayYmd: ahead.todayYmd,
        nowMinutes: ahead.nowMinutes,
        fromYmd: ahead.todayYmd,
        toYmd: ahead.toYmd,
        span: "upcoming",
      });
      const qualifying = qualifyingStaffPeople(morningRoster, [
        ...(taught.ok ? taught.teachers : []),
        ...(upcomingSnap.ok ? upcomingSnap.teachers : []),
        ...booking.teachers,
        ...upcoming.teachers,
      ]);
      const returned = qualifying.filter((person) => !person.active);
      const index = staffIndexFromPeople(qualifying, true);
      if (staffCtx && staffCtx.businessId === business.id) staffCtx.staffIndex = index;
      const flags = await syncArboxStaffFlags({
        admin,
        businessId: business.id,
        people: qualifying,
        reportComplete: true,
        now,
      });
      console.info("[arbox-staff] roster", {
        slug: business.slug,
        pages: morningRosterPages,
        roster_count: morningRoster.length,
        qualifying: qualifying.length,
        active: morningRoster.filter((person) => person.active).length,
        trainer_fields: booking.match.fields,
        trainer_has_id: booking.match.hasId,
        matched_by_id: booking.match.byId,
        matched_by_name: booking.match.byName,
        unmatched: booking.match.unmatched,
        bookings_from: lookbackFrom ?? null,
        bookings_to: lookbackTo ?? null,
        future_fetched: needsFuture,
        future_rows: prefetchedFutureRows?.length ?? null,
        upcoming_fields: upcoming.match.fields,
        upcoming_has_id: upcoming.match.hasId,
        upcoming_by_id: upcoming.match.byId,
        upcoming_by_name: upcoming.match.byName,
        upcoming_unmatched: upcoming.match.unmatched,
        upcoming_to: ahead.toYmd,
        returned: returned.map((person) => `${person.userId} ${person.name}`.trim()),
        names: qualifying.map((person) => `${person.userId} ${person.name}`.trim()),
        ...flags,
      });
    }
  }

  // --- Step: birthday ---
  try {
    entry.birthday = await timeStep(timings, business.id, "birthday", () => syncArboxBirthdaysForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      now,
      ...(prefetchedMembershipRows
        ? {
            prefetchedMembershipRows,
            prefetchedMembershipPages,
          }
        : {}),
      ...(sharedActiveKeys ? { activeProductKeys: sharedActiveKeys } : {}),
    }));
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

  // --- Step: days-in-club (C8 milestones) ---
  try {
    entry.days_in_club = await timeStep(timings, business.id, "days_in_club", () => syncArboxDaysInClubForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      daysInClubSeeded: business.arbox_days_in_club_seeded,
      now,
      ...(prefetchedMembershipRows
        ? {
            prefetchedMembershipRows,
            prefetchedMembershipPages,
          }
        : {}),
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-daily-triggers] days_in_club step threw", {
      slug: business.slug,
      error: message,
    });
    entry.days_in_club = {
      fetched: 0,
      pages_fetched: 0,
      members: 0,
      due: 0,
      seeded: 0,
      soft_seeded: 0,
      processed: 0,
      already: 0,
      notified: 0,
      gated: 0,
      no_phone: 0,
      abandoned: 0,
      errors: 1,
      fetch_error: message,
    };
  }

  // One activeMembershipsReport for both expiry steps when a rule is on.
  // Reuse the birthday/C8/C7 prefetch when it already ran. Not per lead.
  let expiryActiveRows: Record<string, unknown>[] | null | undefined = prefetchedMembershipRows;
  try {
    const { data: expiryRules, error: expiryRulesErr } = await admin
      .from("template_triggers")
      .select("trigger_type, template_name")
      .eq("business_id", business.id)
      .eq("enabled", true)
      .in("trigger_type", ["membership_expiring", "sessions_expiring"]);
    const needsExpiryIndex =
      !expiryRulesErr &&
      (expiryRules ?? []).some((row) => String((row as { template_name?: unknown }).template_name ?? "").trim());
    if (expiryRulesErr) {
      console.error("[cron/arbox-daily-triggers] expiry rule lookup failed", {
        slug: business.slug,
        error: expiryRulesErr.message,
      });
    }
    if (needsExpiryIndex && expiryActiveRows === undefined) {
      const memberships = await fetchArboxActiveMembershipsReport({
        apiKey: business.apiKey,
        boxId: business.crm_box_id,
        now,
      });
      expiryActiveRows = memberships.ok ? memberships.rows : null;
      if (!memberships.ok) {
        console.error("[cron/arbox-daily-triggers] expiry activeMembershipsReport failed", {
          slug: business.slug,
          error: memberships.error,
        });
      }
    }
  } catch (e) {
    console.error("[cron/arbox-daily-triggers] expiry membership prefetch threw", {
      slug: business.slug,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // --- Step: membership_expiring ---
  try {
    entry.membership_expiring = await timeStep(timings, business.id, "membership_expiring", () => syncArboxMembershipExpiringForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      now,
      activeMembershipRows: expiryActiveRows,
    }));
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

  // --- Step: post-trial C5/C6 (bookings × sales) ---
  try {
    entry.post_trial_followup = await timeStep(timings, business.id, "post_trial_followup", () => syncArboxPostTrialFollowupForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
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
      ...(sharedActiveKeys ? { activeProductKeys: sharedActiveKeys } : {}),
    }));
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
    entry.missed_class = await timeStep(timings, business.id, "missed_class", () => syncArboxMissedClassForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      missedClassSeeded: business.arbox_missed_class_seeded,
      now,
      prefetchedRows,
      prefetchedPages,
      lookbackFrom,
      lookbackTo,
      ...(sharedActiveKeys ? { activeProductKeys: sharedActiveKeys } : {}),
    }));
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
      class_unmarked: 0,
      class_unmarked_classes: 0,
      single_attendee_unmarked_14d: 0,
      errors: 1,
      fetch_error: message,
    };
  }

  // --- Step: attendance_gap ---
  try {
    entry.attendance_gap = await timeStep(timings, business.id, "attendance_gap", () => syncArboxAttendanceGapForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
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
      activeMembershipRows: membershipFlagReport?.rows,
      activeMembershipsComplete: memberFlagReportIsComplete(membershipFlagReport),
      activeSessionRows: prefetchedSessionRows,
      activeSessionsComplete: sessionsLoaded && !prefetchedSessionsHitPageCap,
      trialMembershipTypeIds: Array.isArray(business.arbox_trial_membership_type_ids)
        ? business.arbox_trial_membership_type_ids.filter(
            (id): id is number => typeof id === "number" && Number.isFinite(id)
          )
        : [],
    }));
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
      class_unmarked: 0,
      frozen: 0,
      freeze_report_calls: 0,
      freeze_unavailable: 0,
      not_active_member: 0,
      staff: 0,
      member_unavailable: 0,
      has_future_booking: 0,
      future_booking_calls: 0,
      future_unavailable: 0,
      gap_delays: [],
      lookback_covers_delays: false,
      errors: 1,
      fetch_error: message,
    };
  }

  // --- Step: nth_workout (C7) ---
  try {
    entry.nth_workout = await timeStep(timings, business.id, "nth_workout", () => syncArboxNthWorkoutForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      nthWorkoutSeeded: business.arbox_nth_workout_seeded,
      now,
      ...(prefetchedMembershipRows
        ? {
            prefetchedMembershipRows,
            prefetchedMembershipPages,
          }
        : {}),
      ...(prefetchedRows
        ? {
            prefetchedBookingRows: prefetchedRows,
            prefetchedBookingPages: prefetchedPages,
            bookingsFromYmd: lookbackFrom,
            bookingsToYmd: lookbackTo,
          }
        : {}),
      ...(nthBefore && prefetchedFutureRows ? { prefetchedFutureRows } : {}),
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-daily-triggers] nth_workout step threw", {
      slug: business.slug,
      error: message,
    });
    entry.nth_workout = {
      fetched_memberships: 0,
      fetched_bookings: 0,
      pages_fetched: 0,
      new_members: 0,
      due: 0,
      seeded: 0,
      soft_seeded: 0,
      processed: 0,
      already: 0,
      notified: 0,
      gated: 0,
      no_phone: 0,
      abandoned: 0,
      errors: 1,
      fetch_error: message,
    };
  }

  // --- Step: freeze_ending_* only. freeze_created runs on arbox-trial-sync. ---
  try {
    entry.freeze = await timeStep(timings, business.id, "freeze", () => syncArboxFreezeForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      freezeSeeded: business.arbox_freeze_seeded,
      part: "ending",
      now,
      ...(freezePlan.needsEndingFuture && prefetchedFutureRows
        ? {
            prefetchedFutureRows,
            prefetchedFuturePages,
          }
        : {}),
    }));
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
    entry.trial_reminder = await timeStep(timings, business.id, "trial_reminder", () => syncArboxTrialReminderForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      trialReminderSeeded: business.arbox_trial_reminder_seeded,
      businessTrialIds: business.arbox_trial_membership_type_ids,
      now,
      slot: "morning",
      ...(trialReminderPlan.needsTrialReminder &&
      trialReminderPlan.hasTrialProductIds &&
      prefetchedFutureRows
        ? {
            prefetchedFutureRows,
            prefetchedFuturePages,
          }
        : {}),
    }));
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

  // --- Step: trainer_trial_heads_up (staff B2) ---
  try {
    entry.trainer_trial_heads_up = await timeStep(timings, business.id, "trainer_trial_heads_up", () => syncArboxTrainerTrialHeadsUpForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      businessTrialIds: business.arbox_trial_membership_type_ids,
      now,
      slot: "morning",
      ...(trainerHeadsUpPlan.needsTrainerTrialHeadsUp &&
      trainerHeadsUpPlan.hasTrialProductIds &&
      prefetchedFutureRows
        ? {
            prefetchedFutureRows,
            prefetchedFuturePages,
          }
        : {}),
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-daily-triggers] trainer_trial_heads_up step threw", {
      slug: business.slug,
      error: message,
    });
    entry.trainer_trial_heads_up = {
      fetched: 0,
      pages_fetched: 0,
      trial_rows: 0,
      due: 0,
      processed: 0,
      already: 0,
      notified: 0,
      gated: 0,
      no_phone: 0,
      errors: 1,
      fetch_error: message,
    };
  }

  // --- Step: class_cancelled_staff (staff B5) ---
  try {
    entry.class_cancelled_staff = await timeStep(timings, business.id, "class_cancelled_staff", () => syncArboxClassCancelledStaffForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      now,
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/arbox-daily-triggers] class_cancelled_staff step threw", {
      slug: business.slug,
      error: message,
    });
    entry.class_cancelled_staff = {
      fetched_cancelled: 0,
      fetched_summary: 0,
      pages_fetched: 0,
      cancelled_rows: 0,
      processed: 0,
      already: 0,
      notified: 0,
      gated: 0,
      no_phone: 0,
      errors: 1,
      fetch_error: message,
    };
  }

  // --- Step: sessions_expiring ---
  try {
    entry.sessions_expiring = await timeStep(timings, business.id, "sessions_expiring", () => syncArboxSessionsExpiringForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      now,
      activeMembershipRows: expiryActiveRows,
      trialMembershipTypeIds: Array.isArray(business.arbox_trial_membership_type_ids)
        ? business.arbox_trial_membership_type_ids.filter(
            (id): id is number => typeof id === "number" && Number.isFinite(id)
          )
        : [],
    }));
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

  // membership_cancelled runs on arbox-trial-sync (15 min, 08:00–21:00), not here.

  // --- Step: lost_lead (A7) ---
  try {
    entry.lost_lead = await timeStep(timings, business.id, "lost_lead", () => syncArboxLostLeadForBusiness({
      admin,
      businessId: business.id,
      businessSlug: business.slug,
      apiKey: business.apiKey,
      boxId: business.crm_box_id,
      lostLeadSeeded: business.arbox_lost_lead_seeded,
      lane: "daily",
      now,
      ...(sharedActiveKeys ? { activeProductKeys: sharedActiveKeys } : {}),
      ...(prefetchedRows ? { recentCheckInRows: prefetchedRows } : {}),
    }));
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
      skipped_active: 0,
      skipped_recent_checkin: 0,
      notified: 0,
      deferred: 0,
      gated: 0,
      no_phone: 0,
      abandoned: 0,
      errors: 1,
      fetch_error: message,
    };
  }

  await runLeadStatusChangedStep({ admin, business, now, slot, timings, entry });

  const ctx = arboxDailyContext();
  return {
    business_id: business.id,
    slug: business.slug,
    elapsed_ms: Date.now() - started,
    arbox_calls: ctx?.arboxCalls ?? 0,
    arbox_reports: [...(ctx?.arboxReports ?? [])],
    steps: timings,
    summary: entry,
    would_send: ctx?.wouldSend ?? [],
  };
}
