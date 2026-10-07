/**
 * Staff B2: trainer heads-up before a trial class.
 * Same bookingsReport + trial product-filter as trial_reminder (no name-fallback).
 * Recipient is bookingsReport.staff_member_phone — not a contacts row.
 *
 * IO (10 businesses): 0 extra bookingsReport GETs when the shared future prefetch
 * already runs; +1 GET when only this rule is live. +1 /v3/membershipTypes when
 * trial ids are set. +1 GET /v3/users/notes per newly notified trial when the
 * approved template includes {{4}}. No Claude. No contacts insert. No Conversations log.
 */
import {
  fetchAllArboxMembershipTypes,
  membershipTypeNameById,
} from "@/lib/arbox-membership-types";
import { decideActivationEventAction, ruleIdsActiveSinceActivation } from "@/lib/rule-activation";
import {
  isTrialReminderDue,
  trialReminderHasConfiguredIds,
  trialReminderMatchesSlot,
  normalizeTrialReminderClassNamePk,
  normalizeTrialReminderClassTimePk,
  parseTrialReminderUserId,
  trialReminderFutureWindow,
  trialReminderNormalSendAt,
  type TrialReminderSlot,
} from "@/lib/leads/arbox-trial-reminder";
import { prepareTrialBookingClasses } from "@/lib/leads/trial-booking-class";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { classStartHasPassed } from "@/lib/leads/arbox-class-cancelled-customer";
import { trialReminderBodyPlaceholderIndexes } from "@/lib/template-send-params";
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
} from "@/lib/scheduled-template-sends";
import { claimQueuedTemplateSend, settleQueuedTemplateSend } from "@/lib/leads/sync-log-claim";
import { dispatchStaffTemplateImmediate } from "@/lib/staff-template-dispatch";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { rulesForCompanionSend } from "@/lib/same-trigger-template-order";
import {
  loadEnabledTrainerTrialHeadsUpTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";

export type TrainerTrialHeadsUpDispatch =
  | "immediate"
  | "already"
  | "no_rule"
  | "no_phone"
  | "gated"
  | "send_failed"
  | "held"
  | "skipped";

export const TRAINER_TEMPLATE_PENDING = "trainer_template_pending";
export const TRAINER_CLASS_STARTED = "class_started";

export type TrainerTrialHeadsUpSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials" | "no_trial_scope" | "evening_needs_date";
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

/** Full client name for trainer_trial_heads_up {{3}}. */
export function clientFullNameFromBookingRow(row: ArboxBookingReportRow): string {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  return [first, last].filter(Boolean).join(" ").trim();
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
  clientFullName: string;
  className: string;
  classTime: string;
  userId: number;
  apiKey: string;
  classDateYmd: string;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
  bodyVarCount: number;
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
    clientFirstName: input.clientFullName,
    className: input.className,
  });

  const started = classStartHasPassed(input.classDateYmd, input.classTime, input.now);
  if (input.bodyVarCount === 1 && started) {
    console.info("[leads/arbox-trainer-trial-heads-up] skip", {
      businessId: input.businessId,
      user_id: input.userId,
      class_date: input.classDateYmd,
      reason: TRAINER_CLASS_STARTED,
    });
    return { dispatch: "skipped", ok: false };
  }
  if (input.bodyVarCount === 1) {
    const held = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey,
      recipientKind: "staff",
    });
    if (!held.ok) return { dispatch: "send_failed", ok: false };
    if (!isArboxDailyDryRun()) {
      await input.admin
        .from("scheduled_template_sends")
        .update({ last_error: TRAINER_TEMPLATE_PENDING, updated_at: input.now.toISOString() })
        .eq("dedup_key", dedupKey)
        .eq("status", "pending");
    }
    console.info("[leads/arbox-trainer-trial-heads-up] hold", {
      businessId: input.businessId,
      user_id: input.userId,
      class_date: input.classDateYmd,
      class_time: input.classTime,
      reason: TRAINER_TEMPLATE_PENDING,
    });
    return { dispatch: "held", ok: true };
  }
  if ((input.bodyVarCount === 4 || input.bodyVarCount === 5) && started) {
    if (!isArboxDailyDryRun()) {
      await input.admin
        .from("scheduled_template_sends")
        .update({
          status: "canceled",
          last_error: TRAINER_CLASS_STARTED,
          updated_at: input.now.toISOString(),
        })
        .eq("dedup_key", dedupKey)
        .eq("status", "pending");
    }
    console.info("[leads/arbox-trainer-trial-heads-up] skip", {
      businessId: input.businessId,
      user_id: input.userId,
      class_date: input.classDateYmd,
      reason: TRAINER_CLASS_STARTED,
    });
    return { dispatch: "skipped", ok: false };
  }

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
  let heldError: string | null = null;
  if (!enqueueResult.inserted) {
    if (input.bodyVarCount !== 5) return { dispatch: "already", ok: true };
    const { data: pendingHold } = await input.admin
      .from("scheduled_template_sends")
      .select("status, last_error")
      .eq("dedup_key", dedupKey)
      .maybeSingle();
    const row = pendingHold as { status?: string; last_error?: string } | null;
    if (row?.status !== "pending" || row.last_error !== TRAINER_TEMPLATE_PENDING) {
      return { dispatch: "already", ok: true };
    }
    heldError = TRAINER_TEMPLATE_PENDING;
  }

  const claim = await claimQueuedTemplateSend(input.admin, dedupKey);
  if (claim === "lost") return { dispatch: "already", ok: true };
  if (claim === "error") return { dispatch: "send_failed", ok: false };

  const send = await dispatchStaffTemplateImmediate({
    admin: input.admin,
    businessId: input.businessId,
    phone: input.phone,
    templateName,
    triggerType: "trainer_trial_heads_up",
    clientFullName: input.clientFullName,
    className: input.className,
    classTime: input.classTime,
    classDateYmd: input.classDateYmd,
    arboxApiKey: input.apiKey,
    arboxUserId: input.userId,
    now: input.now,
  });
  if (send === "sent") {
    await settleQueuedTemplateSend(input.admin, dedupKey, "sent");
    return { dispatch: "immediate", ok: true };
  }
  if (send === "gated") {
    await settleQueuedTemplateSend(input.admin, dedupKey, "release", heldError);
    return { dispatch: "gated", ok: false };
  }
  await settleQueuedTemplateSend(input.admin, dedupKey, "failed", heldError);
  return { dispatch: "send_failed", ok: false };
}

/** 5-placeholder bodies use the trial_reminder evening split. Other counts stay on the 09:00 run. */
export function trainerHeadsUpMatchesSlot(input: {
  classDateYmd: string;
  classTime: string;
  todayYmd: string;
  delayDays: number;
  slot: TrialReminderSlot;
  bodyVarCount: number;
}): boolean {
  if (input.bodyVarCount === 5) {
    return trialReminderMatchesSlot({
      classDateYmd: input.classDateYmd,
      classTime: input.classTime,
      todayYmd: input.todayYmd,
      delayDays: input.delayDays,
      slot: input.slot,
    });
  }
  if (input.slot === "evening") return false;
  return isTrialReminderDue({
    classDateYmd: input.classDateYmd,
    todayYmd: input.todayYmd,
    delayDays: Math.max(0, Math.trunc(input.delayDays)),
  });
}

function trainerBodyVarCount(components: unknown): number {
  const indexes = trialReminderBodyPlaceholderIndexes(components);
  const contiguous = indexes.every((n, i) => n === i + 1);
  return contiguous ? indexes.length : -1;
}

/**
 * A 1-placeholder body still says "היום" and puts the class name in {{1}}.
 * Hold it pending until the approved body has 5 placeholders. Then send only
 * if the class has not started.
 */
export function decideTrainerHeadsUpDelivery(input: {
  storedComponents: unknown;
  classDateYmd: string | null;
  classTime: string | null;
  now: Date;
}): "hold" | "send" | "class_started" | "unsupported" {
  const count = trainerBodyVarCount(input.storedComponents);
  const started =
    Boolean(input.classDateYmd && input.classTime) &&
    classStartHasPassed(String(input.classDateYmd), String(input.classTime), input.now);
  if (count === 1) return started ? "class_started" : "hold";
  if (count !== 4 && count !== 5) return "unsupported";
  if (started) return "class_started";
  return "send";
}

export async function syncArboxTrainerTrialHeadsUpForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  businessTrialIds?: unknown;
  now?: Date;
  /** Evening sends delay-0 classes before 10:00 only when the approved body has 5 placeholders. */
  slot?: TrialReminderSlot;
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
  const slot: TrialReminderSlot = input.slot === "evening" ? "evening" : "morning";

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

  const sendRules = rulesForCompanionSend(rulesWithTemplate);
  if (!sendRules.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  const templateNames = [...new Set(sendRules.map((rule) => String(rule.template_name ?? "").trim()).filter(Boolean))];
  const varCountByTemplate = new Map<string, number>();
  if (templateNames.length) {
    const { data: templateRows, error: templateErr } = await input.admin
      .from("whatsapp_templates")
      .select("name, components, status")
      .eq("business_id", businessId)
      .in("name", templateNames);
    if (templateErr) {
      console.error("[leads/arbox-trainer-trial-heads-up] template var count failed:", templateErr.message);
    } else {
      for (const row of templateRows ?? []) {
        const name = String((row as { name?: unknown }).name ?? "").trim();
        if (String((row as { status?: unknown }).status ?? "").toUpperCase() !== "APPROVED") continue;
        if (name) varCountByTemplate.set(name, trainerBodyVarCount((row as { components?: unknown }).components));
      }
    }
  }
  const varCountFor = (templateName: string) => varCountByTemplate.get(templateName.trim()) ?? 0;
  if (slot === "evening" && !sendRules.some((rule) => varCountFor(String(rule.template_name ?? "")) === 5)) {
    summary.skipped = true;
    summary.skip_reason = "evening_needs_date";
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
  const trialFilters = sendRules.map((item) => parseIdList(item.product_filter));
  const anyTrialCatchAll = trialFilters.some((ids) => ids.length === 0);
  const productFilterIds = anyTrialCatchAll ? [] : [...new Set(trialFilters.flat())];
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
  let classRun: Awaited<ReturnType<typeof prepareTrialBookingClasses>> | null = null;
  try {
    classRun = await prepareTrialBookingClasses({
      admin: input.admin,
      businessId,
      apiKey,
      rows: reportRows,
      trialTypeIds,
      todayYmd,
      phase: "pre_class",
      isCandidate: (row) => bookingMatchesTrialScope(row, trialScope),
    });
  } catch (error) {
    console.error("[leads/arbox-trainer-trial-heads-up] trial class failed, name match only", {
      businessId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const trialDecision = (userId: number, classDate: string, classTime: string) =>
    classRun?.forKeys(userId, classDate, classTime);

  const activeRuleIds = await ruleIdsActiveSinceActivation(
    input.admin,
    "scheduled_template_sends",
    businessId,
    sendRules,
    "updated_at"
  );
  if (!activeRuleIds) {
    summary.errors += 1;
    return summary;
  }
  const freshRules = sendRules.filter((rule) => rule.id && !activeRuleIds.has(rule.id));
  if (freshRules.length) {
    for (const row of reportRows) {
      const userId = parseTrialReminderUserId(row.user_id);
      const classDateYmd = parseClassDateYmd(row.date);
      const classTime = normalizeTrialReminderClassTimePk(row.time);
      const className = normalizeTrialReminderClassNamePk(row.class_name);
      const trainerPhone = staffPhoneFromBooking(row);
      if (userId == null || !classDateYmd || !classTime || !className || !trainerPhone) continue;
      if (!bookingMatchesTrialScope(row, trialScope, trialDecision(userId, classDateYmd, classTime))) continue;
      for (const rule of freshRules) {
        const templateName = String(rule.template_name ?? "").trim();
        if (!templateName) continue;
        const sendAt = trialReminderNormalSendAt({
          classDateYmd,
          classTime,
          delayDays: Math.max(0, Math.trunc(Number(rule.delay_days) || 0)),
        });
        if (decideActivationEventAction({ sendAt, now }) === "send") continue;
        const dedupKey = buildTrainerTrialHeadsUpScheduledDedupKey({
          businessId,
          triggerId: rule.id,
          trainerPhone,
          userId,
          classDateYmd,
          classTime,
          clientFirstName: clientFullNameFromBookingRow(row),
          className,
        });
        const { error } = await input.admin.from("scheduled_template_sends").upsert(
          {
            business_id: businessId,
            trigger_id: rule.id,
            contact_phone: trainerPhone,
            template_name: templateName,
            due_at: now.toISOString(),
            status: "canceled",
            dedup_key: dedupKey,
            last_error: "activation_seed",
            updated_at: now.toISOString(),
          },
          { onConflict: "dedup_key", ignoreDuplicates: true }
        );
        if (error) summary.errors += 1;
      }
    }
    for (const rule of freshRules) activeRuleIds.add(rule.id);
  }

  for (const row of reportRows) {
    const userId = parseTrialReminderUserId(row.user_id);
    const classDateYmd = parseClassDateYmd(row.date);
    const classTime = normalizeTrialReminderClassTimePk(row.time);
    const className = normalizeTrialReminderClassNamePk(row.class_name);
    if (userId == null || !classDateYmd || !classTime || !className) {
      summary.errors += 1;
      continue;
    }
    if (!bookingMatchesTrialScope(row, trialScope, trialDecision(userId, classDateYmd, classTime))) continue;
    summary.trial_rows += 1;

    const dueRules = sendRules.filter((item) => {
      if (!activeRuleIds.has(item.id)) return false;
      const ids = parseIdList(item.product_filter);
      if (ids.length) {
        const names = new Set<string>();
        for (const id of ids) {
          const name = nameById.get(id);
          if (name) names.add(normalizeMembershipTypeName(name));
        }
        if (
          !bookingMatchesTrialScope(row, {
            trialTypeIds: ids,
            trialTypeNamesNormalized: names,
          })
        ) {
          return false;
        }
      }
      return trainerHeadsUpMatchesSlot({
        classDateYmd,
        classTime,
        todayYmd,
        delayDays: Math.max(0, Math.trunc(Number(item.delay_days) || 0)),
        slot,
        bodyVarCount: varCountFor(String(item.template_name ?? "")),
      });
    });
    if (!dueRules.length) continue;
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

      const clientFullName = clientFullNameFromBookingRow(row);
      const freshClass = await classRun?.recheckBeforeSend({
        userId,
        classDate: classDateYmd,
        classTime,
        role: String((row as { user_role?: unknown; role?: unknown }).user_role ?? (row as { role?: unknown }).role ?? "") || null,
        firstWorkout: ["yes", "1", "true"].includes(
          String((row as { is_first_session?: unknown }).is_first_session ?? "").trim().toLowerCase()
        ),
      });
      if (freshClass === "not_trial" || freshClass === "unknown") {
        console.info("[leads/arbox-trainer-trial-heads-up] pre-send class skip", {
          businessId,
          userId,
          classDateYmd,
          classification: freshClass,
        });
        continue;
      }
      let send: { dispatch: string } = { dispatch: "skipped" };
      for (const rule of dueRules) {
        send = await dispatchTrainerTrialHeadsUp({
          admin: input.admin,
          businessId,
          phone: trainerPhone,
          clientFullName,
          className,
          classTime,
          userId,
          classDateYmd,
          apiKey,
          rule,
          now,
          bodyVarCount: varCountFor(String(rule.template_name ?? "")),
        });
      }

      console.info("[leads/arbox-trainer-trial-heads-up] dispatch", {
        businessId,
        user_id: userId,
        class_date: classDateYmd,
        class_time: classTime,
        class_name: className,
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
