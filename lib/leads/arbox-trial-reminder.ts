/**
 * Trial-class reminder: future bookingsReport + C4 trial name-match → UTILITY before class.
 * delay_days is day-grain detection (class_date === today + delay_days), not Meta enqueue offset.
 * No name_fallback — if trial products are not configured the handler no-ops (does not
 * misfire on memberships). Catalog type is unreliable (Limitless trials are type=session).
 *
 * IO (10 businesses): 0 extra bookingsReport GETs when freeze-ending already prefetches
 * the shared future window; +1 GET when only trial_reminder is live. +1 /v3/membershipTypes
 * when trial ids are set (same as C4). No salesReport join.
 * Evening slot (cron-job.org at EVENING_SLOT_IL Asia/Jerusalem, ?slot=evening): one extra
 * bookings GET per business that has an enabled trial_reminder rule, and no
 * other trigger steps. The slot is the query param. Hour 20 is outside the
 * 21:00 night hold, so the evening start is not held.
 * delay 0/1 rules send only on the evening run, for tomorrow's classes. The
 * 09:00 run sends delay >= 2 only, and marks a delay 0/1 class of today that has
 * no row as skipped (booked_after_evening_run).
 */
import { EVENING_SLOT_IL, MORNING_SLOT_IL } from "@/lib/daily-run-slots";
import { logMessage } from "@/lib/analytics";
import {
  decideActivationEventAction,
  israelSlotInstant,
  ruleIdsActiveSinceActivation,
} from "@/lib/rule-activation";
import {
  fetchAllArboxMembershipTypes,
  membershipTypeNameById,
} from "@/lib/arbox-membership-types";
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTrialReminderFirstName } from "@/lib/template-first-name";
import { prepareTrialBookingClasses } from "@/lib/leads/trial-booking-class";
import {
  ATTENDANCE_GAP_FUTURE_SPAN_DAYS,
  sharedFutureBookingsWindow,
  ymdDiffDays,
} from "@/lib/leads/arbox-attendance-gap";
import {
  isCancellationSyncLogTerminal,
  nextCancellationSyncLogAfterDispatch,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import { claimSyncLogBeforeSend } from "@/lib/leads/sync-log-claim";
import { upsertOptionalReason } from "@/lib/leads/sync-log-reason";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  normalizeMembershipTypeName,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { DUPLICATE_GUARD_ERROR } from "@/lib/notifications/template-duplicate-guard";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildTrialReminderScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { trialReminderTemplateParamValues } from "@/lib/template-send-params";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { resolveCronNow } from "@/lib/cron-clock";
import {
  companionTemplateAlreadySent,
  recordCompanionTemplateSent,
  settleCompanionTemplateSent,
  rulesForCompanionSend,
  runCompanionTemplateSends,
  type CompanionDispatch,
} from "@/lib/same-trigger-template-order";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledTrialReminderTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export const TRIAL_REMINDER_FUTURE_SPAN_DAYS = ATTENDANCE_GAP_FUTURE_SPAN_DAYS;

export const TRIAL_REMINDER_SOFT_SEED_SENTINEL_USER_ID = 0;
export const TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_DATE = "1970-01-01";
export const TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_TIME = "-";
export const TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_NAME = "seed";

export type TrialReminderDispatch =
  | "immediate"
  | "deferred"
  | "gated"
  | "skipped"
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "send_failed"
  | "send_unknown";

export type TrialReminderSyncSummary = {
  skipped?: boolean;
  skip_reason?:
    | "no_rule"
    | "missing_credentials"
    | "no_trial_scope"
    | "activation_read_failed"
    | "time_override_requires_dry_run";
  lookback_from?: string;
  lookback_to?: string;
  fetched: number;
  pages_fetched: number;
  trial_rows: number;
  due: number;
  seeded: number;
  soft_seeded: number;
  processed: number;
  already: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  abandoned: number;
  errors: number;
  /** 09:00 run: delay 0/1 classes of today with no evening reminder. */
  booked_after_evening_run?: number;
  fetch_error?: string;
  trial_match_mode?: "product_filter_names" | "business_trial_ids_names";
};

export type TrialReminderPrefetchPlan = {
  needsTrialReminder: boolean;
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

export function trialReminderHasConfiguredIds(
  productFilter: unknown,
  businessTrialIds: unknown
): boolean {
  return parseIdList(productFilter).length > 0 || parseIdList(businessTrialIds).length > 0;
}

export function normalizeTrialReminderClassTimePk(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export function normalizeTrialReminderClassNamePk(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export function parseTrialReminderUserId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/** Exact day-grain: reminder fires on class_date − delay_days (delay 0 = class day). */
export function isTrialReminderDue(input: {
  classDateYmd: string;
  todayYmd: string;
  delayDays: number;
}): boolean {
  const days = Math.max(0, Math.trunc(input.delayDays));
  const diff = ymdDiffDays(input.classDateYmd, input.todayYmd);
  return diff === days;
}

/** Trainer heads-up only: delay-0 classes starting before this Israel wall time go the evening before. */
export const REMINDER_EARLY_CUTOFF = "10:00";

export type TrialReminderSlot = "morning" | "evening";

/** Absent or `morning` keeps the 09:00 job. Only the literal `evening` switches slots. */
export function parseTrialReminderSlot(raw: string | null | undefined): TrialReminderSlot | "invalid" {
  if (raw == null || raw === "" || raw === "morning") return "morning";
  if (raw === "evening") return "evening";
  return "invalid";
}

/** `REMINDER_EARLY_CUTOFF` env overrides the constant. Invalid values stay on 10:00. */
export function reminderEarlyCutoffHm(): string {
  const raw = String(process.env.REMINDER_EARLY_CUTOFF ?? "").trim();
  const parsed = classStartMinutes(raw);
  if (parsed == null || !raw.includes(":")) return REMINDER_EARLY_CUTOFF;
  const hour = Math.floor(parsed / 60);
  const minute = parsed % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Arbox `time` is an Israel wall clock (`9:00`, `09:59`, `10:00:00`). Not a UTC instant. */
export function classStartMinutes(raw: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Calendar add on a YYYY-MM-DD. Uses UTC noon so a DST fallback cannot shift the date. */
export function addIsraelCalendarDays(ymd: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const REMINDER_MORNING_HM = MORNING_SLOT_IL;
const REMINDER_EVENING_HM = EVENING_SLOT_IL;

/** delay 0 or 1: the reminder goes at the evening slot the evening before, whatever the class time. */
export function trialReminderSendsEveningBefore(delayDays: number): boolean {
  return Math.max(0, Math.trunc(delayDays)) <= 1;
}

/** Evening slot the evening before for delay 0/1, morning slot on class_date − delay otherwise. */
export function trialReminderNormalSendAt(input: {
  classDateYmd: string;
  classTime: string;
  delayDays: number;
}): Date | null {
  const delay = Math.max(0, Math.trunc(input.delayDays));
  if (trialReminderSendsEveningBefore(delay)) {
    const prev = addIsraelCalendarDays(input.classDateYmd, -1);
    return prev ? israelSlotInstant(prev, REMINDER_EVENING_HM) : null;
  }
  const due = addIsraelCalendarDays(input.classDateYmd, -delay);
  return due ? israelSlotInstant(due, REMINDER_MORNING_HM) : null;
}

/**
 * Evening sends delay 0/1 rules for tomorrow's classes. Morning sends only
 * delay >= 2 rules on their due day.
 */
export function trialReminderMatchesSlot(input: {
  classDateYmd: string;
  classTime: string;
  todayYmd: string;
  delayDays: number;
  slot: TrialReminderSlot;
}): boolean {
  const delay = Math.max(0, Math.trunc(input.delayDays));
  if (trialReminderSendsEveningBefore(delay)) {
    if (input.slot !== "evening") return false;
    const tomorrow = addIsraelCalendarDays(input.todayYmd, 1);
    return tomorrow != null && input.classDateYmd === tomorrow;
  }
  if (input.slot === "evening") return false;
  return isTrialReminderDue({
    classDateYmd: input.classDateYmd,
    todayYmd: input.todayYmd,
    delayDays: delay,
  });
}

export const TRIAL_REMINDER_BOOKED_AFTER_EVENING_RUN = "booked_after_evening_run";

/**
 * 09:00 run, delay 0/1 rule, class today: the evening run already passed, so the
 * booking came after it (or on the class day). No reminder for it.
 */
export function trialReminderBookedAfterEveningRun(input: {
  classDateYmd: string;
  todayYmd: string;
  delayDays: number;
  slot: TrialReminderSlot;
}): boolean {
  return (
    input.slot === "morning" &&
    trialReminderSendsEveningBefore(input.delayDays) &&
    input.classDateYmd === input.todayYmd
  );
}

/** Trainer heads-up split: delay 0 before the cutoff goes the evening before, the rest at 09:00. */
export function earlyCutoffNormalSendAt(input: {
  classDateYmd: string;
  classTime: string;
  delayDays: number;
}): Date | null {
  const delay = Math.max(0, Math.trunc(input.delayDays));
  const minutes = classStartMinutes(input.classTime);
  const cutoff = classStartMinutes(reminderEarlyCutoffHm());
  if (minutes == null || cutoff == null) return null;
  if (delay === 0 && minutes < cutoff) {
    const prev = addIsraelCalendarDays(input.classDateYmd, -1);
    return prev ? israelSlotInstant(prev, REMINDER_EVENING_HM) : null;
  }
  const due = addIsraelCalendarDays(input.classDateYmd, -delay);
  return due ? israelSlotInstant(due, REMINDER_MORNING_HM) : null;
}

/**
 * Trainer heads-up split. Morning sends the existing due day, except a delay-0
 * class that starts before the cutoff (that one went out the previous evening).
 * Evening sends only delay-0 classes whose date is tomorrow and whose start is
 * before the cutoff.
 */
export function earlyCutoffMatchesSlot(input: {
  classDateYmd: string;
  classTime: string;
  todayYmd: string;
  delayDays: number;
  slot: TrialReminderSlot;
  cutoffHm?: string;
}): boolean {
  const minutes = classStartMinutes(input.classTime);
  const cutoff = classStartMinutes(input.cutoffHm ?? reminderEarlyCutoffHm());
  if (minutes == null || cutoff == null) return false;
  const early = minutes < cutoff;
  const delay = Math.max(0, Math.trunc(input.delayDays));
  if (input.slot === "evening") {
    if (delay !== 0 || !early) return false;
    const tomorrow = addIsraelCalendarDays(input.todayYmd, 1);
    return tomorrow != null && input.classDateYmd === tomorrow;
  }
  if (
    !isTrialReminderDue({
      classDateYmd: input.classDateYmd,
      todayYmd: input.todayYmd,
      delayDays: delay,
    })
  ) {
    return false;
  }
  if (delay === 0 && early) return false;
  return true;
}

/**
 * Live WhatsApp uses the real Israel date, not a caller-supplied `now`.
 * A dry run passes its preview clock so the would-send list matches that day.
 */
export function trialReminderSendAllowedNow(input: {
  classDateYmd: string;
  classTime: string;
  delayDays: number;
  slot: TrialReminderSlot;
  realNow?: Date;
}): boolean {
  const realNow = input.realNow ?? new Date();
  return trialReminderMatchesSlot({
    classDateYmd: input.classDateYmd,
    classTime: input.classTime,
    todayYmd: formatDateYmdIsrael(realNow),
    delayDays: input.delayDays,
    slot: input.slot,
  });
}

/**
 * Slot is not part of the key. Evening and morning share
 * (business, trigger, user, class date, class time, class name).
 */
export function claimTrialReminderSend(input: {
  claimedKeys: Set<string>;
  businessId: number;
  triggerId: string;
  userId: number;
  classDateYmd: string;
  classTime: string;
  className: string;
  todayYmd: string;
  delayDays: number;
  slot: TrialReminderSlot;
}): "sent" | "skip_slot" | "skip_dedup" {
  if (
    !trialReminderMatchesSlot({
      classDateYmd: input.classDateYmd,
      classTime: input.classTime,
      todayYmd: input.todayYmd,
      delayDays: input.delayDays,
      slot: input.slot,
    })
  ) {
    return "skip_slot";
  }
  const key = buildTrialReminderScheduledDedupKey(
    input.businessId,
    input.triggerId,
    input.userId,
    input.classDateYmd,
    input.classTime,
    input.className
  );
  if (input.claimedKeys.has(key)) return "skip_dedup";
  input.claimedKeys.add(key);
  return "sent";
}

/** Flag already true + empty log → soft-seed (rule added later) instead of blasting. */
export function trialReminderNeedsSoftSeed(input: {
  trialReminderSeeded: boolean;
  logCount: number;
}): boolean {
  return input.trialReminderSeeded && input.logCount === 0;
}

export function trialReminderFutureWindow(now: Date = new Date()): {
  fromDate: string;
  toDate: string;
} {
  return sharedFutureBookingsWindow(now, { includeToday: true });
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

async function fetchMembershipTypeNameById(apiKey: string): Promise<Map<number, string>> {
  const result = await fetchAllArboxMembershipTypes({
    apiKey,
    logLabel: "leads/arbox-trial-reminder",
  });
  if (!result.ok) return new Map();
  return membershipTypeNameById(result.types);
}

type ContactRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  arbox_user_id: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxBookingReportRow;
  userId: number;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const contactSelect = "id, phone, full_name, arbox_user_id";
  const arboxUserId = String(input.userId);
  let phoneNorm = normalizePhone(input.row.phone);
  const fullName = resolveReportFullName(input.row);

  let existing: ContactRow | undefined;
  const { data: byUser } = await input.admin
    .from("contacts")
    .select(contactSelect)
    .eq("business_id", input.businessId)
    .eq("arbox_user_id", arboxUserId)
    .order("updated_at", { ascending: false })
    .limit(1);
  existing = byUser?.[0] as ContactRow | undefined;

  if (!phoneNorm && existing) {
    phoneNorm = normalizePhone(existing.phone);
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
    if (String(existing.arbox_user_id ?? "").trim() !== arboxUserId) {
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
      source: "arbox_trial_reminder",
      arbox_user_id: arboxUserId,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();
  if (error || !inserted) {
    console.error("[leads/arbox-trial-reminder] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertTrialReminderSyncLog(input: {
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
  /** null clears a claim reason. Omit to leave the column alone. */
  reason?: string | null;
}): Promise<{ ok: boolean }> {
  const row: Record<string, unknown> = {
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
  };
  return upsertOptionalReason(
    input.admin,
    "arbox_trial_reminder_sync_log",
    row,
    "business_id,trigger_id,user_id,class_date,class_time,class_name",
    input.reason
  );
}

async function dispatchTrialReminderTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  contactFullName?: string | null;
  className: string;
  classTime: string;
  userId: number;
  classDateYmd: string;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
  dueOffsetMs?: number;
  slot?: TrialReminderSlot;
}): Promise<{ dispatch: TrialReminderDispatch; ok: boolean; reason?: string }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const delayDays = Math.max(0, Math.trunc(Number(input.rule.delay_days) || 0));
  const slot: TrialReminderSlot = input.slot === "evening" ? "evening" : "morning";
  if (
    !trialReminderSendAllowedNow({
      classDateYmd: input.classDateYmd,
      classTime: input.classTime,
      delayDays,
      slot,
      realNow: isArboxDailyDryRun() ? input.now : new Date(),
    })
  ) {
    console.error("[leads/arbox-trial-reminder] skip send outside configured day", {
      businessId: input.businessId,
      classDateYmd: input.classDateYmd,
      classTime: input.classTime,
      delayDays,
      slot,
      realToday: formatDateYmdIsrael(new Date()),
    });
    return { dispatch: "skipped", ok: false };
  }

  // Detection delay already applied (due-day filter). Send on this cron run.
  const dueAt = new Date(
    computeDueAt({ delay_days: 0, delay_direction: "after" }, input.now).getTime() +
      Math.max(0, input.dueOffsetMs ?? 0)
  );
  if (dueAt.getTime() > input.now.getTime() + 15_000) {
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildTrialReminderScheduledDedupKey(
        input.businessId,
        input.rule.id,
        input.userId,
        input.classDateYmd,
        input.classTime,
        input.className
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-trial-reminder] enqueue failed:", enqueueResult.error);
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

  const firstName = resolveTrialReminderFirstName(
    { full_name: input.contactFullName ?? null },
    input.fullName
  );
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const filled = trialReminderTemplateParamValues({
    storedComponents,
    firstName,
    className: input.className,
    classTime: input.classTime,
    classDateYmd: input.classDateYmd,
  });
  if (!filled.ok) {
    console.info("[leads/arbox-trial-reminder] skip", {
      reason: filled.reason,
      var_count: filled.varCount,
      template: templateName,
      businessId: input.businessId,
    });
    return { dispatch: "skipped", ok: false };
  }
  const bodyParams = filled.values;
  const sendComponents =
    bodyParams.length > 0
      ? [
          {
            type: "body" as const,
            parameters: bodyParams.map((text) => ({ type: "text" as const, text })),
          },
        ]
      : undefined;

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
      console.info("[leads/arbox-trial-reminder] duplicate_guard", {
        businessId: input.businessId,
        userId: input.userId,
        classDateYmd: input.classDateYmd,
      });
      return { dispatch: "skipped", ok: false, reason: DUPLICATE_GUARD_ERROR };
    }
    console.error("[leads/arbox-trial-reminder] template send failed:", sendResult.error);
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

/**
 * True when an enabled trial_reminder rule has a template.
 * hasTrialProductIds is product_filter on the rule OR businesses.arbox_trial_membership_type_ids.
 * Cron skips the extra future GET when ids are missing (handler would no-op anyway).
 */
export async function businessNeedsTrialReminderSync(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  businessTrialIds?: unknown
): Promise<TrialReminderPrefetchPlan> {
  const rules = await loadEnabledTrialReminderTemplateTriggers(admin, businessId);
  const live = rules.filter((r) => Boolean(r.template_name?.trim()));
  if (!live.length) {
    return { needsTrialReminder: false, hasTrialProductIds: false };
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
        "[leads/arbox-trial-reminder] trial-ids lookup failed:",
        error.message
      );
      return { needsTrialReminder: true, hasTrialProductIds: true };
    }
    trialIds = (data as { arbox_trial_membership_type_ids?: unknown } | null)
      ?.arbox_trial_membership_type_ids;
  }
  const hasTrialProductIds = live.some((r) =>
    trialReminderHasConfiguredIds(r.product_filter, trialIds)
  );
  return { needsTrialReminder: true, hasTrialProductIds };
}

export async function syncArboxTrialReminderForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  trialReminderSeeded: boolean;
  businessTrialIds?: unknown;
  now?: Date;
  prefetchedFutureRows?: ArboxBookingReportRow[];
  prefetchedFuturePages?: number;
  /** morning = 09:00 job. evening = early classes only, nothing else in the cron. */
  slot?: TrialReminderSlot;
}): Promise<TrialReminderSyncSummary> {
  const summary: TrialReminderSyncSummary = {
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
    errors: 0,
  };

  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const resolvedNow = resolveCronNow(input.now, isArboxDailyDryRun());
  if (!resolvedNow.ok) {
    summary.skipped = true;
    summary.skip_reason = resolvedNow.error;
    console.error("[leads/arbox-trial-reminder] refused time override without dry run", { businessId });
    return summary;
  }
  const now = resolvedNow.now;
  const nowIso = now.toISOString();
  const todayYmd = formatDateYmdIsrael(now);
  const slot: TrialReminderSlot = input.slot === "evening" ? "evening" : "morning";

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const rules = await loadEnabledTrialReminderTemplateTriggers(input.admin, businessId);
  const rulesWithTemplate = rules.filter((r) => Boolean(r.template_name?.trim()));
  if (!rulesWithTemplate.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-trial-reminder] skip — no enabled trial_reminder rule", {
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
  let trialMatchMode: NonNullable<TrialReminderSyncSummary["trial_match_mode"]>;
  if (productFilterIds.length) {
    trialTypeIds = productFilterIds;
    trialMatchMode = "product_filter_names";
  } else if (businessIds.length) {
    trialTypeIds = businessIds;
    trialMatchMode = "business_trial_ids_names";
  } else {
    summary.skipped = true;
    summary.skip_reason = "no_trial_scope";
    console.info("[leads/arbox-trial-reminder] skip — no trial products configured", {
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
    console.warn("[leads/arbox-trial-reminder] trial type names unresolved — no-op", {
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
    console.error("[leads/arbox-trial-reminder] trial class failed, name match only", {
      businessId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const trialDecision = (userId: number, classDate: string, classTime: string) =>
    classRun?.forKeys(userId, classDate, classTime);

  const needsFullSeed = !input.trialReminderSeeded;
  let needsSoftSeed = false;
  if (!needsFullSeed) {
    const { count, error } = await input.admin
      .from("arbox_trial_reminder_sync_log")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", businessId);
    if (error) {
      console.error("[leads/arbox-trial-reminder] soft-seed count failed:", error.message);
    } else {
      needsSoftSeed = trialReminderNeedsSoftSeed({
        trialReminderSeeded: true,
        logCount: count ?? 0,
      });
    }
  }

  if (needsFullSeed || needsSoftSeed) {
    let wrote = 0;
    for (const row of reportRows) {
      const userId = parseTrialReminderUserId(row.user_id);
      const classDateYmd = parseClassDateYmd(row.date);
      const classTime = normalizeTrialReminderClassTimePk(row.time);
      const className = normalizeTrialReminderClassNamePk(row.class_name);
      if (userId == null || !classDateYmd || !classTime || !className) continue;
      if (!bookingMatchesTrialScope(row, trialScope, trialDecision(userId, classDateYmd, classTime))) continue;
      summary.trial_rows += 1;
      let ok = true;
      let seededRule = false;
      for (const rule of sendRules) {
        const sendAt = trialReminderNormalSendAt({
          classDateYmd,
          classTime,
          delayDays: Math.max(0, Math.trunc(Number(rule.delay_days) || 0)),
        });
        if (decideActivationEventAction({ sendAt, now }) === "send") continue;
        seededRule = true;
        const up = await upsertTrialReminderSyncLog({
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
        if (!up.ok) ok = false;
      }
      if (!ok) {
        summary.errors += 1;
      } else if (seededRule) {
        wrote += 1;
        if (needsFullSeed) summary.seeded += 1;
        else summary.soft_seeded += 1;
      }
    }

    if (wrote === 0) {
      const sentinel = await upsertTrialReminderSyncLog({
        admin: input.admin,
        businessId,
        triggerId: "00000000-0000-0000-0000-000000000000",
        userId: TRIAL_REMINDER_SOFT_SEED_SENTINEL_USER_ID,
        classDateYmd: TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_DATE,
        classTime: TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_TIME,
        className: TRIAL_REMINDER_SOFT_SEED_SENTINEL_CLASS_NAME,
        contactId: null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (sentinel.ok) {
        if (needsFullSeed) summary.seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
    }

    if (needsFullSeed) {
      const { error: flagErr } = await input.admin
        .from("businesses")
        .update({ arbox_trial_reminder_seeded: true })
        .eq("id", businessId);
      if (flagErr) {
        console.error("[leads/arbox-trial-reminder] seed flag update failed:", flagErr.message);
        summary.errors += 1;
        summary.fetch_error = "arbox_trial_reminder_seeded_flag_failed";
      }
      console.info("[leads/arbox-trial-reminder] seeded upcoming trial bookings", {
        businessId,
        businessSlug,
        seeded: summary.seeded,
      });
    } else {
      console.info("[leads/arbox-trial-reminder] soft-seeded empty log", {
        businessId,
        businessSlug,
        soft_seeded: summary.soft_seeded,
      });
    }
  }

  const activeRuleIds = await ruleIdsActiveSinceActivation(
    input.admin,
    "arbox_trial_reminder_sync_log",
    businessId,
    sendRules
  );
  if (!activeRuleIds) {
    summary.skipped = true;
    summary.skip_reason = "activation_read_failed";
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
      if (userId == null || !classDateYmd || !classTime || !className) continue;
      if (userId === TRIAL_REMINDER_SOFT_SEED_SENTINEL_USER_ID) continue;
      if (!bookingMatchesTrialScope(row, trialScope, trialDecision(userId, classDateYmd, classTime))) continue;
      for (const rule of freshRules) {
        const sendAt = trialReminderNormalSendAt({
          classDateYmd,
          classTime,
          delayDays: Math.max(0, Math.trunc(Number(rule.delay_days) || 0)),
        });
        if (decideActivationEventAction({ sendAt, now }) === "send") continue;
        const { error } = await input.admin.from("arbox_trial_reminder_sync_log").upsert(
          {
            business_id: businessId,
            trigger_id: rule.id,
            user_id: userId,
            class_date: classDateYmd,
            class_time: classTime,
            class_name: className,
            contact_id: null,
            processed_at: nowIso,
            attempts: 0,
            status: "seeded",
          },
          {
            onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name",
            ignoreDuplicates: true,
          }
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
    if (userId === TRIAL_REMINDER_SOFT_SEED_SENTINEL_USER_ID) continue;
    if (!bookingMatchesTrialScope(row, trialScope, trialDecision(userId, classDateYmd, classTime))) continue;
    summary.trial_rows += 1;

    const ruleCoversRow = (item: PurchaseTemplateTriggerRule): boolean => {
      if (!activeRuleIds.has(item.id)) return false;
      const ids = parseIdList(item.product_filter);
      if (!ids.length) return true;
      const names = new Set<string>();
      for (const id of ids) {
        const name = nameById.get(id);
        if (name) names.add(normalizeMembershipTypeName(name));
      }
      return bookingMatchesTrialScope(row, {
        trialTypeIds: ids,
        trialTypeNamesNormalized: names,
      });
    };
    const lateRules = sendRules.filter(
      (item) =>
        trialReminderBookedAfterEveningRun({
          classDateYmd,
          todayYmd,
          delayDays: Math.max(0, Math.trunc(Number(item.delay_days) || 0)),
          slot,
        }) && ruleCoversRow(item)
    );
    if (lateRules.length) {
      summary.booked_after_evening_run = (summary.booked_after_evening_run ?? 0) + 1;
      if (!isArboxDailyDryRun()) {
        const { error } = await input.admin.from("arbox_trial_reminder_sync_log").upsert(
          lateRules.map((item) => ({
            business_id: businessId,
            trigger_id: item.id,
            user_id: userId,
            class_date: classDateYmd,
            class_time: classTime,
            class_name: className,
            contact_id: null,
            processed_at: nowIso,
            attempts: 0,
            status: "skipped",
            reason: TRIAL_REMINDER_BOOKED_AFTER_EVENING_RUN,
          })),
          {
            onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name",
            ignoreDuplicates: true,
          }
        );
        if (error) {
          summary.errors += 1;
          console.error("[leads/arbox-trial-reminder] booked_after_evening_run upsert failed:", error.message);
        }
      }
    }

    const dueRules = sendRules.filter(
      (item) =>
        ruleCoversRow(item) &&
        trialReminderMatchesSlot({
          classDateYmd,
          classTime,
          todayYmd,
          delayDays: Math.max(0, Math.trunc(Number(item.delay_days) || 0)),
          slot,
        })
    );
    if (!dueRules.length) continue;
    summary.due += 1;
    summary.processed += 1;

    try {
      const { data: existingRows } = await input.admin
        .from("arbox_trial_reminder_sync_log")
        .select("trigger_id, status, attempts")
        .eq("business_id", businessId)
        .in(
          "trigger_id",
          dueRules.map((item) => item.id)
        )
        .eq("user_id", userId)
        .eq("class_date", classDateYmd)
        .eq("class_time", classTime)
        .eq("class_name", className);
      const terminalIds = new Set(
        (existingRows ?? [])
          .filter((row) => {
            const status = String((row as { status?: unknown }).status ?? "");
            return isCancellationSyncLogTerminal(status) && status !== "skipped";
          })
          .map((row) => String((row as { trigger_id?: unknown }).trigger_id ?? ""))
      );
      const pendingRules = dueRules.filter((item) => item.id && !terminalIds.has(item.id));
      if (!pendingRules.length) {
        summary.already += 1;
        continue;
      }
      const existingAttempts = 0;

      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row,
        userId,
      });
      if (!resolved.phone) {
        summary.no_phone += 1;
        console.info("[leads/arbox-trial-reminder] no_phone", {
          businessId,
          user_id: userId,
          class_date: classDateYmd,
        });
        for (const rule of pendingRules) {
          await upsertTrialReminderSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            classDateYmd,
            classTime,
            className,
            contactId: resolved.contact?.id ?? null,
            attempts: existingAttempts,
            status: "no_phone",
            nowIso,
          });
        }
        continue;
      }

      const sendPhone = resolved.phone;
      if (!sendPhone) continue;
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
        console.info("[leads/arbox-trial-reminder] pre-send class skip", {
          businessId,
          userId,
          classDateYmd,
          classification: freshClass,
        });
        continue;
      }
      const heldByOther = new Set<string>();
      let duplicateGuard = false;
      const sendDispatch = await runCompanionTemplateSends({
        rules: pendingRules,
        dryRun: isArboxDailyDryRun(),
        send: async (item, ctx) => {
          if (!isArboxDailyDryRun() && item.id) {
            const claimed = await claimSyncLogBeforeSend({
              admin: input.admin,
              table: "arbox_trial_reminder_sync_log",
              row: {
                business_id: businessId,
                trigger_id: item.id,
                user_id: userId,
                class_date: classDateYmd,
                class_time: classTime,
                class_name: className,
                contact_id: resolved.contact?.id ?? null,
                processed_at: nowIso,
                attempts: existingAttempts,
              },
              filters: [
                ["business_id", businessId],
                ["trigger_id", item.id],
                ["user_id", userId],
                ["class_date", classDateYmd],
                ["class_time", classTime],
                ["class_name", className],
              ],
            });
            if (claimed !== "won") {
              heldByOther.add(item.id);
              if (claimed === "error") summary.errors += 1;
              return "skipped";
            }
          }
          const send = await dispatchTrialReminderTemplate({
            admin: input.admin,
            businessId,
            businessSlug,
            phone: sendPhone,
            fullName: resolveReportFullName(row),
            contactFullName: resolved.contact?.full_name ?? null,
            className,
            classTime,
            userId,
            classDateYmd,
            rule: item,
            now,
            dueOffsetMs: ctx.dueOffsetMs,
            slot,
          });
          if (send.reason === DUPLICATE_GUARD_ERROR) duplicateGuard = true;
          return send.dispatch as CompanionDispatch;
        },
        alreadyDelivered: (item) =>
          companionTemplateAlreadySent(
            input.admin,
            buildTrialReminderScheduledDedupKey(
              businessId,
              item.id,
              userId,
              classDateYmd,
              classTime,
              className
            ),
            { businessId, triggerId: item.id }
          ),
        recordDelivered: (item) =>
          recordCompanionTemplateSent(input.admin, {
            dedupKey: buildTrialReminderScheduledDedupKey(
              businessId,
              item.id,
              userId,
              classDateYmd,
              classTime,
              className
            ),
            businessId,
            ruleId: item.id,
            phone: sendPhone,
            templateName: String(item.template_name ?? "").trim(),
            nowIso,
          }),
        settleDelivered: (_item, status) =>
          settleCompanionTemplateSent(
            input.admin,
            buildTrialReminderScheduledDedupKey(
              businessId,
              _item.id,
              userId,
              classDateYmd,
              classTime,
              className
            ),
            status
          ),
      });
      const send = { dispatch: sendDispatch };

      console.info("[leads/arbox-trial-reminder] dispatch", {
        businessId,
        user_id: userId,
        class_date: classDateYmd,
        class_time: classTime,
        class_name: className,
        phone: maskPhoneForLog(resolved.phone),
        dispatch: send.dispatch,
      });

      if (
        send.dispatch === "immediate" ||
        send.dispatch === "deferred" ||
        send.dispatch === "gated" ||
        send.dispatch === "skipped" ||
        (send.dispatch === "send_failed" || send.dispatch === "send_unknown")
      ) {
        const next = nextCancellationSyncLogAfterDispatch({
          dispatch: send.dispatch,
          attemptsSoFar: existingAttempts,
        });
        if (next.hitCap) summary.abandoned += 1;
        if (!isArboxDailyDryRun()) for (const rule of pendingRules) {
          if (!rule.id || heldByOther.has(rule.id)) continue;
          const marked = await upsertTrialReminderSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            classDateYmd,
            classTime,
            className,
            contactId: resolved.contact?.id ?? null,
            attempts: next.attempts,
            status: duplicateGuard ? "sent" : next.status,
            nowIso,
            reason: duplicateGuard ? DUPLICATE_GUARD_ERROR : null,
          });
          if (!marked.ok) summary.errors += 1;
        }
        if (send.dispatch === "immediate") summary.notified += 1;
        else if (send.dispatch === "deferred") summary.deferred += 1;
        else if (send.dispatch === "gated") summary.gated += 1;
        else if ((send.dispatch === "send_failed" || send.dispatch === "send_unknown") && !next.hitCap) summary.errors += 1;
      }
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-trial-reminder] row threw", {
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
    reason: "trial_reminder_send_failed",
  });

  return summary;
}
