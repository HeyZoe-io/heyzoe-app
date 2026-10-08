/**
 * C3 missed_class (members) + C4 missed_trial (leads): bookingsReport past rows with check_in="No".
 * "No" is Arbox's default before attendance is marked. A class with zero "Yes"
 * is unmarked: seed class_unmarked and do not send.
 * Shares bookingsReport fetch with trial_attended (cron prefetch). Shared sync_log (no event_kind).
 */
import {
  fetchArboxActiveProductKeys,
  matchesActiveProduct,
  type ActiveProductKeys,
} from "@/lib/leads/arbox-active-product";
import { logMessage } from "@/lib/analytics";
import {
  decideActivationEventAction,
  eventBeforeRuleActivation,
} from "@/lib/rule-activation";
import {
  fetchAllArboxMembershipTypes,
  membershipTypeNameById,
} from "@/lib/arbox-membership-types";
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import {
  isCancellationSyncLogTerminal,
  nextCancellationSyncLogAfterDispatch,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import { closeRetentionEvent, markRetentionSent, retentionAlreadySentToday } from "@/lib/leads/retention-daily-cap";
import { isRetentionStaff, retentionStaffIndex } from "@/lib/leads/arbox-staff";
import { REGISTERED_VIA_ZOE_REASON, registeredViaZoe } from "@/lib/leads/registered-via-zoe";
import { upsertOptionalReason } from "@/lib/leads/sync-log-reason";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  isBookingCheckedIn,
  membershipTypeNameLooksLikeTrial,
  normalizeMembershipTypeName,
  parseClassDateYmd,
  trialAttendedLookbackDays,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import {
  postClassNormalSendAt,
  prepareTrialBookingClasses,
  reclassifiedPostClassPastDue,
} from "@/lib/leads/trial-booking-class";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { DUPLICATE_GUARD_ERROR } from "@/lib/notifications/template-duplicate-guard";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { claimSyncLogBeforeSend } from "@/lib/leads/sync-log-claim";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildMissedClassScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import {
  companionTemplateAlreadySent,
  recordCompanionTemplateSent,
  settleCompanionTemplateSent,
  rulesForCompanionSend,
  runCompanionTemplateSends,
} from "@/lib/same-trigger-template-order";
import {
  loadEnabledMissedClassTemplateTriggers,
  loadEnabledMissedTrialTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { delayDirectionForTrigger } from "@/lib/template-trigger-types";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MISSED_SEED_SPAN_DAYS = 30;
export const TEMPLATE_CLASS_NAME_FALLBACK = "השיעור";

export type MissedClassKind = "missed_class" | "missed_trial";

export type MissedClassSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  lookback_from?: string;
  lookback_to?: string;
  fetched: number;
  pages_fetched: number;
  seeded: number;
  missed_rows: number;
  routed_class: number;
  routed_trial: number;
  processed: number;
  already: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  abandoned: number;
  /** Bookings not sent because the class had zero check_in Yes. */
  class_unmarked: number;
  class_unmarked_classes: number;
  /** Past 14 days: a class with exactly one booking, and that booking is No. */
  single_attendee_unmarked_14d: number;
  errors: number;
  fetch_error?: string;
};

/** Explicit string "No" (case-insensitive). Empty / Yes / other → not a no-show. */
export function isBookingCheckInNo(checkIn: unknown): boolean {
  return String(checkIn ?? "").trim().toLowerCase() === "no";
}

export function normalizeMissedClassTimePk(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export function normalizeMissedClassNamePk(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export function parseMissedClassUserId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/** Past calendar day only (Israel YMD) — do not fire for today's/future bookings. */
export function isMissedClassDatePast(classDateYmd: string, now: Date = new Date()): boolean {
  const today = formatDateYmdIsrael(now);
  return classDateYmd < today;
}

export function missedClassOccurrenceKey(classDate: string, classTime: string, className: string): string {
  return `${classDate}|${classTime}|${className}`;
}

/**
 * Arbox writes check_in "No" before anyone marks attendance.
 * A class occurrence is marked only when at least one booking in it is "Yes".
 */
export function missedOccurrenceYesCount(
  rows: readonly Pick<ArboxBookingReportRow, "check_in" | "date" | "time" | "class_name">[]
): Map<string, number> {
  const yes = new Map<string, number>();
  for (const row of rows) {
    if (!isBookingCheckedIn(row.check_in)) continue;
    const classDate = parseClassDateYmd(row.date);
    const classTime = normalizeMissedClassTimePk(row.time);
    const className = normalizeMissedClassNamePk(row.class_name);
    if (!classDate || !classTime || !className) continue;
    const key = missedClassOccurrenceKey(classDate, classTime, className);
    yes.set(key, (yes.get(key) ?? 0) + 1);
  }
  return yes;
}

/** No Yes in the occurrence → do not send. One Yes → explicit No still sends. */
export function missedAttendanceDecision(input: {
  checkIn: unknown;
  occurrenceYes: number;
}): "ignore" | "send" | "class_unmarked" {
  if (!isBookingCheckInNo(input.checkIn)) return "ignore";
  return input.occurrenceYes > 0 ? "send" : "class_unmarked";
}

/** One booking, check_in No, class date in [today-14, today). */
export function countSingleAttendeeUnmarkedClasses(
  rows: readonly Pick<ArboxBookingReportRow, "check_in" | "date" | "time" | "class_name">[],
  todayYmd: string
): number {
  const from = addCalendarDaysYmd(todayYmd, -14);
  if (!from) return 0;
  const counts = new Map<string, { total: number; no: number }>();
  for (const row of rows) {
    const classDate = parseClassDateYmd(row.date);
    const classTime = normalizeMissedClassTimePk(row.time);
    const className = normalizeMissedClassNamePk(row.class_name);
    if (!classDate || !classTime || !className) continue;
    if (classDate < from || classDate >= todayYmd) continue;
    const key = missedClassOccurrenceKey(classDate, classTime, className);
    const bucket = counts.get(key) ?? { total: 0, no: 0 };
    bucket.total += 1;
    if (isBookingCheckInNo(row.check_in)) bucket.no += 1;
    counts.set(key, bucket);
  }
  let classes = 0;
  for (const bucket of counts.values()) {
    if (bucket.total === 1 && bucket.no === 1) classes += 1;
  }
  return classes;
}

function addCalendarDaysYmd(ymd: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseClassDateAsEventDate(classDateYmd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(classDateYmd);
  if (!m) return new Date();
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
}

/** Shared lookback for trial_attended + missed_* + attendance_gap (seed/gap use 30d). */
export function bookingsReportSharedLookbackWindow(input: {
  now: Date;
  missedNeedsSeed: boolean;
  /** attendance_gap needs the full past span whenever a gap rule is live (not only on seed). */
  forceWidePast?: boolean;
  lookbackDays?: number;
}): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(input.now);
  const days =
    input.missedNeedsSeed || input.forceWidePast
      ? MISSED_SEED_SPAN_DAYS
      : Math.min(30, Math.max(1, Math.trunc(input.lookbackDays ?? trialAttendedLookbackDays())));
  const [y, m, d] = toDate.split("-").map((n) => Number(n));
  const toUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const fromUtc = new Date(toUtc.getTime() - (days - 1) * MS_PER_DAY);
  const yy = fromUtc.getUTCFullYear();
  const mm = String(fromUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fromUtc.getUTCDate()).padStart(2, "0");
  return { fromDate: `${yy}-${mm}-${dd}`, toDate };
}

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

async function fetchMembershipTypeNameById(apiKey: string): Promise<Map<number, string>> {
  const result = await fetchAllArboxMembershipTypes({
    apiKey,
    logLabel: "leads/arbox-missed-class",
  });
  if (!result.ok) return new Map();
  return membershipTypeNameById(result.types);
}

function resolveReportFullName(row: ArboxBookingReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

type ContactRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  arbox_user_id: string | null;
  trial_registered?: boolean | null;
  session_phase?: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxBookingReportRow;
  source: string;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const contactSelect = "id, phone, full_name, arbox_user_id, trial_registered, session_phase";
  const arboxUserId = String(input.row.user_id ?? "").trim();
  let phoneNorm = normalizePhone(input.row.phone);
  const fullName = resolveReportFullName(input.row);

  let existing: ContactRow | undefined;
  if (arboxUserId) {
    const { data } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", input.businessId)
      .eq("arbox_user_id", arboxUserId)
      .order("updated_at", { ascending: false })
      .limit(1);
    existing = data?.[0] as ContactRow | undefined;
  }
  if (!existing && phoneNorm) {
    const variants = contactPhoneLookupVariants(phoneNorm);
    const { data } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", input.businessId)
      .in("phone", variants.length ? variants : [phoneNorm])
      .order("updated_at", { ascending: false })
      .limit(1);
    existing = data?.[0] as ContactRow | undefined;
  }
  if (existing?.id) {
    phoneNorm = normalizePhone(existing.phone) ?? phoneNorm;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (arboxUserId && String(existing.arbox_user_id ?? "").trim() !== arboxUserId) {
      patch.arbox_user_id = arboxUserId;
    }
    if (fullName && !String(existing.full_name ?? "").trim()) patch.full_name = fullName;
    if (Object.keys(patch).length > 1) {
      await input.admin.from("contacts").update(patch).eq("id", existing.id);
    }
    return { contact: existing, phone: phoneNorm };
  }
  if (!phoneNorm) return { contact: null, phone: null };

  const nowIso = new Date().toISOString();
  const { data: inserted, error } = await input.admin
    .from("contacts")
    .insert({
      business_id: input.businessId,
      phone: phoneNorm,
      full_name: fullName,
      source: input.source,
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();
  if (error || !inserted) {
    console.error("[leads/arbox-missed-class] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertMissedSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  userId: number;
  classDateYmd: string;
  classTime: string;
  className: string;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
  reason?: string | null;
}): Promise<{ ok: boolean }> {
  return upsertOptionalReason(
    input.admin,
    "arbox_missed_class_sync_log",
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      user_id: input.userId,
      class_date: input.classDateYmd,
      class_time: input.classTime,
      class_name: input.className,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    "business_id,trigger_id,user_id,class_date,class_time,class_name",
    input.reason
  );
}

async function dispatchMissedTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  contactFullName?: string | null;
  className: string;
  userId: number;
  classDateYmd: string;
  classTime: string;
  kind: MissedClassKind;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
  dueOffsetMs?: number;
}): Promise<{
  dispatch: "immediate" | "deferred" | "gated" | "skipped" | "send_failed" | "send_unknown" | "no_rule";
  ok: boolean;
  reason?: string;
}> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const delayDays = Math.max(0, Math.trunc(Number(input.rule.delay_days) || 0));
  const eventDate = parseClassDateAsEventDate(input.classDateYmd);
  const dueAt = new Date(
    computeDueAt(
      {
        delay_days: delayDays,
        delay_direction: delayDirectionForTrigger(input.kind, input.rule.delay_direction),
      },
      eventDate
    ).getTime() + Math.max(0, input.dueOffsetMs ?? 0)
  );

  if (dueAt.getTime() > input.now.getTime() + 15_000) {
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildMissedClassScheduledDedupKey(
        input.kind,
        input.businessId,
        input.rule.id,
        input.userId,
        input.classDateYmd,
        input.classTime,
        input.className
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-missed-class] enqueue failed:", enqueueResult.error);
      return { dispatch: "send_failed", ok: false };
    }
    return { dispatch: "deferred", ok: true };
  }

  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return { dispatch: "gated", ok: false };

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id, name").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language, components")
      .eq("business_id", input.businessId)
      .eq("name", templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
  ]);

  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!wabaId || !approvedTpl?.id) return { dispatch: "gated", ok: false };

  const firstName = resolveTemplateFirstName(
    { full_name: input.contactFullName ?? null },
    input.fullName
  );
  if (!firstName && templateBodyUsesFirstNameSlot(input.kind, (approvedTpl as { components?: unknown }).components)) {
    console.info("[leads/arbox-missed-class] skip", { reason: "no_valid_name" });
    return { dispatch: "skipped", ok: false };
  }
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: input.kind,
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    className: input.className,
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    alertTriggerId: input.rule.id,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    if (sendResult.error === DUPLICATE_GUARD_ERROR) {
      console.info("[leads/arbox-missed-class] duplicate_guard", {
        businessId: input.businessId,
        userId: input.userId,
        classDateYmd: input.classDateYmd,
      });
      return { dispatch: "skipped", ok: false, reason: DUPLICATE_GUARD_ERROR };
    }
    console.error("[leads/arbox-missed-class] template send failed:", sendResult.error);
    return { dispatch: templateFailureDispatch(sendResult.error), ok: false };
  }

  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(templateName, {
      firstName,
      components: storedComponents,
      bodyParams,
    }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: buildWaSessionId(phoneNumberId, input.phone),
  });

  return { dispatch: "immediate", ok: true };
}

export type BookingsReportFetchPlan = {
  /** Any bookings-based rule has a template → shared past GET. */
  needsFetch: boolean;
  /** Expand lookback to the 30d seed window only when a missed_* rule is live + unseeded. */
  hasMissedRule: boolean;
  /** Force 30d past whenever attendance_gap is live (gap needs last Yes in window). */
  hasAttendanceGapRule: boolean;
  /** C5/C6 post-trial follow-up — widen past + sales join on daily cron. */
  hasPostTrialFollowupRule: boolean;
  /** C7 nth_workout — widen past to 30d so new-customer join dates are covered. */
  hasNthWorkoutRule: boolean;
};

/**
 * True when an enabled bookings-based rule has a non-empty template.
 * Used by the daily cron to decide whether to GET bookingsReport (and how wide).
 */
export async function businessNeedsBookingsReportFetch(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<BookingsReportFetchPlan> {
  const { data, error } = await admin
    .from("template_triggers")
    .select("trigger_type, template_name")
    .eq("business_id", businessId)
    .eq("enabled", true)
    .in("trigger_type", [
      "missed_class",
      "missed_trial",
      "attendance_gap",
      "registered_after_trial",
      "not_registered_after_trial",
      "nth_workout",
    ])
    .limit(40);
  if (error) {
    console.error("[leads/arbox-missed-class] needs-fetch lookup failed:", error.message);
    return {
      needsFetch: true,
      hasMissedRule: true,
      hasAttendanceGapRule: true,
      hasPostTrialFollowupRule: true,
      hasNthWorkoutRule: true,
    };
  }
  const live = (data ?? []).filter((r) =>
    String((r as { template_name?: unknown }).template_name ?? "").trim()
  );
  return {
    needsFetch: live.length > 0,
    hasMissedRule: live.some((r) => {
      const t = String((r as { trigger_type?: unknown }).trigger_type ?? "");
      return t === "missed_class" || t === "missed_trial";
    }),
    hasAttendanceGapRule: live.some((r) => {
      const t = String((r as { trigger_type?: unknown }).trigger_type ?? "");
      return t === "attendance_gap";
    }),
    hasPostTrialFollowupRule: live.some((r) => {
      const t = String((r as { trigger_type?: unknown }).trigger_type ?? "");
      return t === "registered_after_trial" || t === "not_registered_after_trial";
    }),
    hasNthWorkoutRule: live.some((r) => {
      const t = String((r as { trigger_type?: unknown }).trigger_type ?? "");
      return t === "nth_workout";
    }),
  };
}

export async function syncArboxMissedClassForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  missedClassSeeded: boolean;
  now?: Date;
  prefetchedRows?: ArboxBookingReportRow[];
  prefetchedPages?: number;
  lookbackFrom?: string;
  lookbackTo?: string;
  activeProductKeys?: ActiveProductKeys;
}): Promise<MissedClassSyncSummary> {
  const summary: MissedClassSyncSummary = {
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
    errors: 0,
  };

  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const [classRules, trialRules] = await Promise.all([
    loadEnabledMissedClassTemplateTriggers(input.admin, businessId).then(rulesForCompanionSend),
    loadEnabledMissedTrialTemplateTriggers(input.admin, businessId).then(rulesForCompanionSend),
  ]);
  const classRule = classRules[0] ?? null;
  const trialRule = trialRules[0] ?? null;
  const hasClass = Boolean(classRule?.template_name?.trim());
  const hasTrial = Boolean(trialRule?.template_name?.trim());
  if (!hasClass && !hasTrial) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  const { data: bizRow } = await input.admin
    .from("businesses")
    .select("arbox_trial_membership_type_ids")
    .eq("id", businessId)
    .maybeSingle();
  const businessTrialIds = parseIdList(
    (bizRow as { arbox_trial_membership_type_ids?: unknown } | null)
      ?.arbox_trial_membership_type_ids
  );
  const trialFilters = trialRules.map((item) => parseIdList(item.product_filter));
  const anyTrialCatchAll = trialFilters.some((ids) => ids.length === 0);
  const productFilterIds = anyTrialCatchAll
    ? []
    : [...new Set(trialFilters.flat())];

  let trialTypeIds: number[] = [];
  let trialMatchMode: "product_filter_names" | "business_trial_ids_names" | "name_fallback" =
    "name_fallback";
  if (productFilterIds.length) {
    trialTypeIds = productFilterIds;
    trialMatchMode = "product_filter_names";
  } else if (businessTrialIds.length) {
    trialTypeIds = businessTrialIds;
    trialMatchMode = "business_trial_ids_names";
  }

  const nameById = trialTypeIds.length ? await fetchMembershipTypeNameById(apiKey) : new Map();
  const trialTypeNamesNormalized = new Set<string>();
  for (const id of trialTypeIds) {
    const name = nameById.get(id);
    if (name) trialTypeNamesNormalized.add(normalizeMembershipTypeName(name));
  }
  if (trialMatchMode !== "name_fallback" && !trialTypeNamesNormalized.size) {
    trialMatchMode = "name_fallback";
  }
  const trialScope = { trialTypeIds, trialTypeNamesNormalized };

  let rows: ArboxBookingReportRow[];
  if (input.prefetchedRows) {
    rows = input.prefetchedRows;
    summary.pages_fetched = input.prefetchedPages ?? 0;
    summary.lookback_from = input.lookbackFrom;
    summary.lookback_to = input.lookbackTo;
  } else {
    const window = bookingsReportSharedLookbackWindow({
      now,
      missedNeedsSeed: !input.missedClassSeeded,
    });
    summary.lookback_from = window.fromDate;
    summary.lookback_to = window.toDate;
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
    rows = report.rows;
  }
  summary.fetched = rows.length;
  const occurrenceYes = missedOccurrenceYesCount(rows);
  summary.single_attendee_unmarked_14d = countSingleAttendeeUnmarkedClasses(
    rows,
    formatDateYmdIsrael(now)
  );
  const loggedUnmarked = new Set<string>();

  if (!input.missedClassSeeded) {
    for (const row of rows) {
      if (!isBookingCheckInNo(row.check_in)) continue;
      const userId = parseMissedClassUserId(row.user_id);
      const classDateYmd = parseClassDateYmd(row.date);
      const classTime = normalizeMissedClassTimePk(row.time);
      const className = normalizeMissedClassNamePk(row.class_name);
      if (userId == null || !classDateYmd || !classTime || !className) continue;
      if (!isMissedClassDatePast(classDateYmd, now)) continue;

      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row,
        source: "arbox_missed_class_seed",
      });
      const seedRules = [...classRules, ...trialRules].filter((item) => item.id);
      let upOk = true;
      let attempted = 0;
      for (const rule of seedRules) {
        const dueAt = computeDueAt(
          {
            delay_days: Math.max(0, Math.trunc(Number(rule.delay_days) || 0)),
            delay_direction: delayDirectionForTrigger(
              rule.trigger_type === "missed_trial" ? "missed_trial" : "missed_class",
              rule.delay_direction
            ),
          },
          parseClassDateAsEventDate(classDateYmd)
        );
        if (decideActivationEventAction({ sendAt: dueAt, now }) === "send") continue;
        attempted += 1;
        const up = await upsertMissedSyncLog({
          admin: input.admin,
          businessId,
          triggerId: rule.id,
          userId,
          classDateYmd,
          classTime,
          className,
          contactId: resolved.contact?.id ?? null,
          attempts: 0,
          status: "seeded",
          nowIso,
        });
        if (!up.ok) upOk = false;
      }
      if (attempted === 0) continue;
      if (upOk) summary.seeded += 1;
      else summary.errors += 1;
    }

    const { error: seedFlagErr } = await input.admin
      .from("businesses")
      .update({ arbox_missed_class_seeded: true })
      .eq("id", businessId);
    if (seedFlagErr) {
      console.error("[leads/arbox-missed-class] seed flag update failed:", seedFlagErr.message);
      summary.errors += 1;
    }
    console.info("[leads/arbox-missed-class] seeded past no-shows", {
      businessId,
      businessSlug,
      seeded: summary.seeded,
    });
    return summary;
  }

  let missedTrialKeys: ActiveProductKeys | null | undefined = input.activeProductKeys;
  async function ensureMissedTrialActiveKeys(): Promise<ActiveProductKeys | null> {
    if (missedTrialKeys !== undefined) return missedTrialKeys;
    const { data: bizRow } = await input.admin
      .from("businesses")
      .select("arbox_trial_membership_type_ids")
      .eq("id", businessId)
      .maybeSingle();
    const products = await fetchArboxActiveProductKeys({
      apiKey,
      boxId,
      now,
      trialMembershipTypeIds: (bizRow as { arbox_trial_membership_type_ids?: unknown } | null)
        ?.arbox_trial_membership_type_ids,
    });
    if (!products.ok) {
      missedTrialKeys = null;
      summary.errors += 1;
      summary.fetch_error = products.error;
      console.error("[leads/arbox-missed-class] active product fetch failed", {
        businessId,
        error: products.error,
      });
      return null;
    }
    missedTrialKeys = products.keys;
    return products.keys;
  }

  let classRun: Awaited<ReturnType<typeof prepareTrialBookingClasses>> | null = null;
  try {
    classRun = await prepareTrialBookingClasses({
      admin: input.admin,
      businessId,
      apiKey,
      rows,
      trialTypeIds,
      todayYmd: formatDateYmdIsrael(now),
      phase: "post_class",
      isCandidate: (row) =>
        trialMatchMode === "name_fallback"
          ? membershipTypeNameLooksLikeTrial(row.membership_type_name)
          : bookingMatchesTrialScope(row, trialScope),
    });
  } catch (error) {
    console.error("[leads/arbox-missed-class] trial class failed, name match only", {
      businessId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const staffIndex = await retentionStaffIndex(input.admin, businessId);
  for (const row of rows) {
    if (!isBookingCheckInNo(row.check_in)) continue;
    if (isBookingCheckedIn(row.check_in)) continue;

    const userId = parseMissedClassUserId(row.user_id);
    const classDateYmd = parseClassDateYmd(row.date);
    const classTime = normalizeMissedClassTimePk(row.time);
    const className = normalizeMissedClassNamePk(row.class_name);
    if (userId == null || !classDateYmd || !classTime || !className) {
      summary.errors += 1;
      continue;
    }
    if (!isMissedClassDatePast(classDateYmd, now)) continue;
    summary.missed_rows += 1;

    const decision = classRun?.forKeys(userId, classDateYmd, classTime);
    const isTrial = classRun?.ready
      ? trialMatchMode === "name_fallback"
        ? decision === "trial" ||
          (decision == null && membershipTypeNameLooksLikeTrial(row.membership_type_name))
        : bookingMatchesTrialScope(row, trialScope, decision)
      : trialMatchMode === "name_fallback"
        ? membershipTypeNameLooksLikeTrial(row.membership_type_name)
        : bookingMatchesTrialScope(row, trialScope);

    let kind: MissedClassKind | null = null;
    let batch: PurchaseTemplateTriggerRule[] = [];
    if (isTrial && hasTrial && trialRules.length) {
      kind = "missed_trial";
      batch = trialRules.filter((item) => {
        const ids = parseIdList(item.product_filter);
        if (!ids.length) return true;
        const names = new Set<string>();
        for (const id of ids) {
          const name = nameById.get(id);
          if (name) names.add(normalizeMembershipTypeName(name));
        }
        return bookingMatchesTrialScope(
          row,
          {
            trialTypeIds: ids,
            trialTypeNamesNormalized: names,
          },
          decision
        );
      });
      if (!batch.length) continue;
      summary.routed_trial += 1;
    } else if (!isTrial && hasClass && classRules.length) {
      kind = "missed_class";
      batch = classRules;
      summary.routed_class += 1;
    } else {
      continue;
    }

    try {
      const { data: existingRows } = await input.admin
        .from("arbox_missed_class_sync_log")
        .select("trigger_id, status, attempts, contact_id")
        .eq("business_id", businessId)
        .in(
          "trigger_id",
          batch.map((item) => item.id)
        )
        .eq("user_id", userId)
        .eq("class_date", classDateYmd)
        .eq("class_time", classTime)
        .eq("class_name", className);
      const terminalIds = new Set(
        (existingRows ?? [])
          .filter((row) => {
            const status = String((row as { status?: unknown }).status ?? "");
            return isCancellationSyncLogTerminal(status);
          })
          .map((row) => String((row as { trigger_id?: unknown }).trigger_id ?? ""))
      );
      const pendingRules = batch.filter(
        (item) =>
          item.id &&
          !terminalIds.has(item.id) &&
          !eventBeforeRuleActivation(
            computeDueAt(
              {
                delay_days: Math.max(0, Math.trunc(Number(item.delay_days) || 0)),
                delay_direction: delayDirectionForTrigger(kind, item.delay_direction),
              },
              parseClassDateAsEventDate(classDateYmd)
            ),
            item
          )
      );
      if (!pendingRules.length) {
        summary.already += 1;
        continue;
      }
      const occurrenceKey = missedClassOccurrenceKey(classDateYmd, classTime, className);
      if (
        missedAttendanceDecision({
          checkIn: row.check_in,
          occurrenceYes: occurrenceYes.get(occurrenceKey) ?? 0,
        }) === "class_unmarked"
      ) {
        let seededOk = true;
        for (const rule of pendingRules) {
          const up = await upsertMissedSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            classDateYmd,
            classTime,
            className,
            contactId: null,
            attempts: 0,
            status: "seeded",
            nowIso,
            reason: "class_unmarked",
          });
          if (!up.ok) seededOk = false;
        }
        if (!seededOk) summary.errors += 1;
        summary.class_unmarked += 1;
        if (!loggedUnmarked.has(occurrenceKey)) {
          loggedUnmarked.add(occurrenceKey);
          summary.class_unmarked_classes += 1;
          console.info("[leads/arbox-missed-class] class_unmarked", {
            businessId,
            class_date: classDateYmd,
            class_time: classTime,
            class_name: className,
            reason: "class_unmarked",
          });
        }
        continue;
      }
      let rulesToSend = pendingRules;
      if (kind === "missed_trial" && classRun?.ready) {
        const memberships = await classRun.membershipsFor(userId);
        const keep: typeof pendingRules = [];
        const todayYmd = formatDateYmdIsrael(now);
        for (const rule of pendingRules) {
          const sendAt = postClassNormalSendAt({
            triggerType: rule.trigger_type,
            delayDays: Number(rule.delay_days) || 0,
            delayDirection: rule.delay_direction,
            classDateYmd,
            classTime,
            now,
          });
          if (
            reclassifiedPostClassPastDue({
              memberships,
              trialTypeIds,
              todayYmd,
              sendAt,
              now,
            })
          ) {
            const up = await upsertMissedSyncLog({
              admin: input.admin,
              businessId,
              triggerId: rule.id,
              userId,
              classDateYmd,
              classTime,
              className,
              contactId: null,
              attempts: 0,
              status: "seeded",
              nowIso,
            });
            if (!up.ok) summary.errors += 1;
            console.info("[trial-class] reclassified past due, seeded not sent", {
              businessId,
              trigger_type: rule.trigger_type,
              user_id: userId,
              class_date: classDateYmd,
            });
            continue;
          }
          keep.push(rule);
        }
        rulesToSend = keep;
      }
      if (!rulesToSend.length) continue;
      const attemptsSoFar = 0;

      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row,
        source: `arbox_${kind}`,
      });
      if (!resolved.phone || !resolved.contact?.id) {
        summary.no_phone += 1;
        for (const rule of rulesToSend) {
          await upsertMissedSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            classDateYmd,
            classTime,
            className,
            contactId: resolved.contact?.id ?? null,
            attempts: attemptsSoFar,
            status: "no_phone",
            nowIso,
          });
        }
        continue;
      }

      if (kind === "missed_trial" && registeredViaZoe(resolved.contact)) {
        for (const rule of rulesToSend) {
          await upsertMissedSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            classDateYmd,
            classTime,
            className,
            contactId: resolved.contact.id,
            attempts: attemptsSoFar,
            status: "skipped",
            nowIso,
            reason: REGISTERED_VIA_ZOE_REASON,
          });
        }
        console.info("[leads/arbox-missed-class] dispatch", {
          businessId,
          kind,
          user_id: userId,
          dispatch: "skipped",
          reason: REGISTERED_VIA_ZOE_REASON,
        });
        continue;
      }

      if (kind === "missed_trial") {
        const activeKeys = await ensureMissedTrialActiveKeys();
        if (!activeKeys) {
          console.info("[leads/arbox-missed-class] dispatch", {
            businessId,
            kind,
            user_id: userId,
            dispatch: "active_check_failed",
          });
          continue;
        }
        if (
          matchesActiveProduct({
            userId,
            phone: resolved.phone,
            keys: activeKeys,
          })
        ) {
          for (const rule of rulesToSend) {
            await upsertMissedSyncLog({
              admin: input.admin,
              businessId,
              triggerId: rule.id,
              userId,
              classDateYmd,
              classTime,
              className,
              contactId: resolved.contact.id,
              attempts: attemptsSoFar,
              status: "seeded",
              nowIso,
            });
          }
          console.info("[leads/arbox-missed-class] dispatch", {
            businessId,
            kind,
            user_id: userId,
            dispatch: "skipped_active",
          });
          continue;
        }
      }

      if (!kind) continue;
      const missedKind = kind;
      const sendPhone = resolved.phone;
      const sendContact = resolved.contact;
      if (!sendPhone || !sendContact) continue;
      if (isRetentionStaff(staffIndex, { userId, phone: sendPhone })) {
        for (const rule of rulesToSend) {
          await upsertMissedSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            classDateYmd,
            classTime,
            className,
            contactId: sendContact.id,
            attempts: attemptsSoFar,
            status: "seeded",
            nowIso,
            reason: "staff",
          });
        }
        console.info("[retention-staff] skip", {
          trigger: missedKind,
          businessId,
          user_id: userId,
        });
        continue;
      }
      if (await retentionAlreadySentToday(input.admin, businessId, sendPhone, now)) {
        console.info("[leads/arbox-missed-class] dispatch", {
          businessId,
          kind,
          user_id: userId,
          class_date: classDateYmd,
          class_name: className,
          dispatch: "skipped",
          reason: "retention_daily_cap",
        });
        for (const rule of rulesToSend) {
          await closeRetentionEvent({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            phone: sendPhone,
            templateName: String(rule.template_name ?? ""),
            dedupKey: buildMissedClassScheduledDedupKey(
              missedKind,
              businessId,
              rule.id,
              userId,
              classDateYmd,
              classTime,
              className
            ),
            now,
          });
          await upsertMissedSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            classDateYmd,
            classTime,
            className,
            contactId: resolved.contact?.id ?? null,
            attempts: attemptsSoFar,
            status: "skipped",
            nowIso,
            reason: "retention_daily_cap",
          });
        }
        continue;
      }

      const heldByOther = new Set<string>();
      let duplicateGuard = false;
      const sendDispatch = await runCompanionTemplateSends({
        rules: rulesToSend,
        dryRun: isArboxDailyDryRun(),
        send: async (rule, ctx) => {
          if (!isArboxDailyDryRun() && rule.id) {
            const claimed = await claimSyncLogBeforeSend({
              admin: input.admin,
              table: "arbox_missed_class_sync_log",
              row: {
                business_id: businessId,
                trigger_id: rule.id,
                user_id: userId,
                class_date: classDateYmd,
                class_time: classTime,
                class_name: className,
                contact_id: sendContact.id,
                processed_at: nowIso,
                attempts: attemptsSoFar,
              },
              filters: [
                ["business_id", businessId],
                ["trigger_id", rule.id],
                ["user_id", userId],
                ["class_date", classDateYmd],
                ["class_time", classTime],
                ["class_name", className],
              ],
            });
            if (claimed !== "won") {
              heldByOther.add(rule.id);
              if (claimed === "error") summary.errors += 1;
              return "skipped";
            }
          }
          const send = await dispatchMissedTemplate({
            admin: input.admin,
            businessId,
            businessSlug,
            phone: sendPhone,
            fullName: resolveReportFullName(row),
            contactFullName: sendContact.full_name ?? null,
            className,
            userId,
            classDateYmd,
            classTime,
            kind: missedKind,
            rule,
            now,
            dueOffsetMs: ctx.dueOffsetMs,
          });
          console.info("[leads/arbox-missed-class] dispatch", {
            businessId,
            kind,
            user_id: userId,
            template_name: rule.template_name,
            dispatch: send.dispatch,
          });
          if (send.reason === DUPLICATE_GUARD_ERROR) duplicateGuard = true;
          return send.dispatch;
        },
        alreadyDelivered: (rule) =>
          companionTemplateAlreadySent(
            input.admin,
            buildMissedClassScheduledDedupKey(
              missedKind,
              businessId,
              rule.id,
              userId,
              classDateYmd,
              classTime,
              className
            ),
            { businessId, triggerId: rule.id }
          ),
        recordDelivered: (rule) =>
          recordCompanionTemplateSent(input.admin, {
            dedupKey: buildMissedClassScheduledDedupKey(
              missedKind,
              businessId,
              rule.id,
              userId,
              classDateYmd,
              classTime,
              className
            ),
            businessId,
            ruleId: rule.id,
            phone: sendPhone,
            templateName: String(rule.template_name ?? "").trim(),
            nowIso,
          }),
        settleDelivered: (rule, status) =>
          settleCompanionTemplateSent(
            input.admin,
            buildMissedClassScheduledDedupKey(
              missedKind,
              businessId,
              rule.id,
              userId,
              classDateYmd,
              classTime,
              className
            ),
            status
          ),
      });

      const mapped =
        sendDispatch === "immediate"
          ? ("immediate" as const)
          : sendDispatch === "deferred"
            ? ("deferred" as const)
            : sendDispatch === "gated"
              ? ("gated" as const)
              : sendDispatch === "skipped"
                ? ("skipped" as const)
                : sendDispatch === "send_failed"
                  ? ("send_failed" as const)
                  : sendDispatch === "send_unknown"
                  ? ("send_unknown" as const)
                  : ("gated" as const);

      const next = nextCancellationSyncLogAfterDispatch({
        dispatch: mapped,
        attemptsSoFar,
      });
      for (const rule of rulesToSend) {
        if (!rule.id || heldByOther.has(rule.id)) continue;
        await upsertMissedSyncLog({
          admin: input.admin,
          businessId,
          triggerId: rule.id,
          userId,
          classDateYmd,
          classTime,
          className,
          contactId: resolved.contact.id,
          attempts: next.attempts,
          status: duplicateGuard ? "sent" : next.status,
          nowIso,
          reason: duplicateGuard ? DUPLICATE_GUARD_ERROR : null,
        });
      }

      summary.processed += 1;
      if (sendDispatch === "immediate" || sendDispatch === "deferred" || sendDispatch === "send_unknown") {
        markRetentionSent(businessId, sendPhone, now);
      }
      if (sendDispatch === "immediate") summary.notified += 1;
      else if (sendDispatch === "deferred") summary.deferred += 1;
      else if (sendDispatch === "gated") summary.gated += 1;
      else if (sendDispatch === "send_failed" || sendDispatch === "send_unknown") {
        if (next.hitCap) summary.abandoned += 1;
        else summary.errors += 1;
      }

      console.info("[leads/arbox-missed-class] dispatch", {
        businessId,
        kind,
        user_id: userId,
        class_date: classDateYmd,
        class_time: classTime,
        class_name: className,
        contact: maskPhoneForLog(resolved.phone),
        templates: batch.length,
        dispatch: sendDispatch,
        status: next.status,
      });
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-missed-class] row threw", {
        businessId,
        user_id: userId,
        class_date: classDateYmd,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  warnAbandonedCancellationSyncLog({
    businessId,
    abandoned: summary.abandoned,
    reason: "missed_class_send_failed_cap",
  });

  return summary;
}
