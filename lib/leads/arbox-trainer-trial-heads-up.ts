/**
 * Staff B2: trainer heads-up before a trial class.
 * Same bookingsReport + trial product-filter as trial_reminder (no name-fallback).
 * Recipient is bookingsReport.staff_member_phone — not a contacts row.
 *
 * IO (10 businesses): 0 extra bookingsReport GETs when the shared future prefetch
 * already runs; +1 GET when only this rule is live. +1 /v3/membershipTypes when
 * trial ids are set. No Claude. No contacts insert. No Conversations log.
 */
import {
  fetchAllArboxMembershipTypes,
  membershipTypeNameById,
} from "@/lib/arbox-membership-types";
import { firstNameFromFullName } from "@/lib/lead-template";
import {
  isTrialReminderDue,
  trialReminderHasConfiguredIds,
  normalizeTrialReminderClassNamePk,
  normalizeTrialReminderClassTimePk,
  parseTrialReminderUserId,
  trialReminderFutureWindow,
} from "@/lib/leads/arbox-trial-reminder";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  normalizeMembershipTypeName,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { normalizePhone } from "@/lib/phone-normalize";
import {
  buildTrainerTrialHeadsUpScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
  markScheduledTemplateSendSentByDedupKey,
} from "@/lib/scheduled-template-sends";
import { dispatchStaffTemplateImmediate } from "@/lib/staff-template-dispatch";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledTrainerTrialHeadsUpTemplateTriggers,
  pickTrainerTrialHeadsUpTemplateTriggerRule,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";

export type TrainerTrialHeadsUpDispatch =
  | "immediate"
  | "already"
  | "no_rule"
  | "no_phone"
  | "gated"
  | "send_failed";

export type TrainerTrialHeadsUpSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials" | "no_trial_scope";
  lookback_from?: string;
  lookback_to?: string;
  fetched: number;
  pages_fetched: number;
  trial_rows: number;
  due: number;
  processed: number;
  already: number;
  notified: number;
  gated: number;
  no_phone: number;
  errors: number;
  fetch_error?: string;
  trial_match_mode?: "product_filter_names" | "business_trial_ids_names";
};

export type TrainerTrialHeadsUpPrefetchPlan = {
  needsTrainerTrialHeadsUp: boolean;
  hasTrialProductIds: boolean;
};

function parseIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n))
    ),
  ];
}

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

function staffPhoneFromBooking(row: ArboxBookingReportRow): string | null {
  const raw = row.staff_member_phone;
  return normalizePhone(raw) ?? (String(raw ?? "").replace(/\D/g, "").trim() || null);
}

export function clientFirstNameFromBookingRow(row: ArboxBookingReportRow): string {
  const first = String(row.first_name ?? "").trim();
  if (first) return firstNameFromFullName(first);
  const full = String(row.full_name ?? "").trim();
  if (full) return firstNameFromFullName(full);
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined ? firstNameFromFullName(combined) : "";
}

async function fetchMembershipTypeNameById(apiKey: string): Promise<Map<number, string>> {
  const result = await fetchAllArboxMembershipTypes({
    apiKey,
    logLabel: "leads/arbox-trainer-trial-heads-up",
  });
  if (!result.ok) return new Map();
  return membershipTypeNameById(result.types);
}

export async function businessNeedsTrainerTrialHeadsUpSync(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  businessTrialIds?: unknown
): Promise<TrainerTrialHeadsUpPrefetchPlan> {
  const rules = await loadEnabledTrainerTrialHeadsUpTemplateTriggers(admin, businessId);
  const live = rules.filter((r) => Boolean(r.template_name?.trim()));
  if (!live.length) {
    return { needsTrainerTrialHeadsUp: false, hasTrialProductIds: false };
  }
  let trialIds = businessTrialIds;
  if (trialIds === undefined) {
    const { data, error } = await admin
      .from("businesses")
      .select("arbox_trial_membership_type_ids")
      .eq("id", businessId)
      .maybeSingle();
    if (error) {
      console.error(
        "[leads/arbox-trainer-trial-heads-up] trial-ids lookup failed:",
        error.message
      );
      return { needsTrainerTrialHeadsUp: true, hasTrialProductIds: true };
    }
    trialIds = (data as { arbox_trial_membership_type_ids?: unknown } | null)
      ?.arbox_trial_membership_type_ids;
  }
  const hasTrialProductIds = live.some((r) =>
    trialReminderHasConfiguredIds(r.product_filter, trialIds)
  );
  return { needsTrainerTrialHeadsUp: true, hasTrialProductIds };
}

async function dispatchTrainerTrialHeadsUp(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
  clientFirstName: string;
  className: string;
  classTime: string;
  userId: number;
  classDateYmd: string;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: TrainerTrialHeadsUpDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const dueAt = computeDueAt({ delay_days: 0, delay_direction: "after" }, input.now);
  const dedupKey = buildTrainerTrialHeadsUpScheduledDedupKey({
    businessId: input.businessId,
    triggerId: input.rule.id,
    trainerPhone: input.phone,
    userId: input.userId,
    classDateYmd: input.classDateYmd,
    classTime: input.classTime,
    clientFirstName: input.clientFirstName,
    className: input.className,
  });

  const enqueueResult = await enqueueScheduledTemplateSend({
    admin: input.admin,
    businessId: input.businessId,
    triggerId: input.rule.id,
    contactPhone: input.phone,
    templateName,
    dueAt,
    dedupKey,
    recipientKind: "staff",
  });
  if (!enqueueResult.ok) {
    console.error("[leads/arbox-trainer-trial-heads-up] enqueue failed:", enqueueResult.error);
    return { dispatch: "send_failed", ok: false };
  }
  if (!enqueueResult.inserted) return { dispatch: "already", ok: true };

  const send = await dispatchStaffTemplateImmediate({
    admin: input.admin,
    businessId: input.businessId,
    phone: input.phone,
    templateName,
    triggerType: "trainer_trial_heads_up",
    firstName: input.clientFirstName,
    className: input.className,
    classTime: input.classTime,
  });
  if (send === "sent") {
    const marked = await markScheduledTemplateSendSentByDedupKey({
      admin: input.admin,
      dedupKey,
    });
    if (!marked.ok) {
      console.error("[leads/arbox-trainer-trial-heads-up] mark sent failed:", marked.error);
    }
    return { dispatch: "immediate", ok: true };
  }
  if (send === "gated") return { dispatch: "gated", ok: false };
  return { dispatch: "send_failed", ok: false };
}

export async function syncArboxTrainerTrialHeadsUpForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  businessTrialIds?: unknown;
  now?: Date;
  prefetchedFutureRows?: ArboxBookingReportRow[];
  prefetchedFuturePages?: number;
}): Promise<TrainerTrialHeadsUpSyncSummary> {
  const summary: TrainerTrialHeadsUpSyncSummary = {
    fetched: 0,
    pages_fetched: 0,
    trial_rows: 0,
    due: 0,
    processed: 0,
    already: 0,
    notified: 0,
    gated: 0,
    no_phone: 0,
    errors: 0,
  };

  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const now = input.now ?? new Date();
  const todayYmd = formatDateYmdIsrael(now);

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const rules = await loadEnabledTrainerTrialHeadsUpTemplateTriggers(input.admin, businessId);
  const rulesWithTemplate = rules.filter((r) => Boolean(r.template_name?.trim()));
  if (!rulesWithTemplate.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-trainer-trial-heads-up] skip — no enabled rule", {
      businessId,
      businessSlug,
    });
    return summary;
  }

  const rule = pickTrainerTrialHeadsUpTemplateTriggerRule(rulesWithTemplate);
  if (!rule?.template_name?.trim()) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  let businessTrialIds = input.businessTrialIds;
  if (businessTrialIds === undefined) {
    const { data: bizRow } = await input.admin
      .from("businesses")
      .select("arbox_trial_membership_type_ids")
      .eq("id", businessId)
      .maybeSingle();
    businessTrialIds = (bizRow as { arbox_trial_membership_type_ids?: unknown } | null)
      ?.arbox_trial_membership_type_ids;
  }
  const productFilterIds = parseIdList(rule.product_filter);
  const businessIds = parseIdList(businessTrialIds);

  let trialTypeIds: number[];
  let trialMatchMode: NonNullable<TrainerTrialHeadsUpSyncSummary["trial_match_mode"]>;
  if (productFilterIds.length) {
    trialTypeIds = productFilterIds;
    trialMatchMode = "product_filter_names";
  } else if (businessIds.length) {
    trialTypeIds = businessIds;
    trialMatchMode = "business_trial_ids_names";
  } else {
    summary.skipped = true;
    summary.skip_reason = "no_trial_scope";
    console.info("[leads/arbox-trainer-trial-heads-up] skip — no trial products configured", {
      businessId,
      businessSlug,
    });
    return summary;
  }
  summary.trial_match_mode = trialMatchMode;

  const nameById = await fetchMembershipTypeNameById(apiKey);
  const trialTypeNamesNormalized = new Set<string>();
  for (const id of trialTypeIds) {
    const name = nameById.get(id);
    if (name) trialTypeNamesNormalized.add(normalizeMembershipTypeName(name));
  }
  if (!trialTypeNamesNormalized.size) {
    summary.skipped = true;
    summary.skip_reason = "no_trial_scope";
    console.warn("[leads/arbox-trainer-trial-heads-up] trial type names unresolved — no-op", {
      businessId,
      businessSlug,
      trialTypeIds,
    });
    return summary;
  }

  const window = trialReminderFutureWindow(now);
  summary.lookback_from = window.fromDate;
  summary.lookback_to = window.toDate;

  let reportRows: ArboxBookingReportRow[];
  if (input.prefetchedFutureRows) {
    reportRows = input.prefetchedFutureRows.filter((row) => {
      const ymd = parseClassDateYmd(row.date);
      return Boolean(ymd && ymd >= window.fromDate && ymd <= window.toDate);
    });
    summary.pages_fetched = input.prefetchedFuturePages ?? 0;
    summary.fetched = reportRows.length;
  } else {
    const report = await fetchArboxBookingsReport({
      apiKey,
      fromDate: window.fromDate,
      toDate: window.toDate,
      locationId: boxId,
    });
    summary.pages_fetched = report.pagesFetched;
    if (!report.ok) {
      summary.fetch_error = report.error;
      summary.errors += 1;
      return summary;
    }
    reportRows = report.rows;
    summary.fetched = reportRows.length;
  }

  const trialScope = { trialTypeIds, trialTypeNamesNormalized };
  const delayDays = Math.max(0, Math.trunc(Number(rule.delay_days) || 0));

  for (const row of reportRows) {
    const userId = parseTrialReminderUserId(row.user_id);
    const classDateYmd = parseClassDateYmd(row.date);
    const classTime = normalizeTrialReminderClassTimePk(row.time);
    const className = normalizeTrialReminderClassNamePk(row.class_name);
    if (userId == null || !classDateYmd || !classTime || !className) {
      summary.errors += 1;
      continue;
    }
    if (!bookingMatchesTrialScope(row, trialScope)) continue;
    summary.trial_rows += 1;

    if (!isTrialReminderDue({ classDateYmd, todayYmd, delayDays })) continue;
    summary.due += 1;
    summary.processed += 1;

    try {
      const trainerPhone = staffPhoneFromBooking(row);
      if (!trainerPhone) {
        summary.no_phone += 1;
        console.info("[leads/arbox-trainer-trial-heads-up] no_phone", {
          businessId,
          user_id: userId,
          class_date: classDateYmd,
        });
        continue;
      }

      const clientFirstName = clientFirstNameFromBookingRow(row);
      const send = await dispatchTrainerTrialHeadsUp({
        admin: input.admin,
        businessId,
        phone: trainerPhone,
        clientFirstName,
        className,
        classTime,
        userId,
        classDateYmd,
        rule,
        now,
      });

      console.info("[leads/arbox-trainer-trial-heads-up] dispatch", {
        businessId,
        user_id: userId,
        class_date: classDateYmd,
        class_time: classTime,
        phone: maskPhoneForLog(trainerPhone),
        dispatch: send.dispatch,
      });

      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "already") summary.already += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "no_phone") summary.no_phone += 1;
      else if (send.dispatch === "send_failed") summary.errors += 1;
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-trainer-trial-heads-up] row threw", {
        businessId,
        user_id: userId,
        class_date: classDateYmd,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return summary;
}
