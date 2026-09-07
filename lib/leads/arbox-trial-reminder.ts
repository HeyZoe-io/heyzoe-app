/**
 * Trial-class reminder: future bookingsReport + C4 trial name-match → UTILITY before class.
 * delay_days is day-grain detection (class_date === today + delay_days), not Meta enqueue offset.
 * No name_fallback — if trial products are not configured the handler no-ops (does not
 * misfire on memberships). Catalog type is unreliable (Limitless trials are type=session).
 *
 * IO (10 businesses): 0 extra bookingsReport GETs when freeze-ending already prefetches
 * the shared future window; +1 GET when only trial_reminder is live. +1 /v3/membershipTypes
 * when trial ids are set (same as C4). No salesReport join.
 */
import { logMessage } from "@/lib/analytics";
import {
  fetchAllArboxMembershipTypes,
  membershipTypeNameById,
} from "@/lib/arbox-membership-types";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import {
  ATTENDANCE_GAP_FUTURE_SPAN_DAYS,
  sharedFutureBookingsWindow,
  ymdDiffDays,
} from "@/lib/leads/arbox-attendance-gap";
import {
  nextCancellationSyncLogAfterDispatch,
  parseCancellationSyncAttempts,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  normalizeMembershipTypeName,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildTrialReminderScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledTrialReminderTemplateTriggers,
  pickTrialReminderTemplateTriggerRule,
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
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "send_failed";

export type TrialReminderSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials" | "no_trial_scope";
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
  userId: number;
  classDateYmd: string;
  classTime: string;
  className: string;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_trial_reminder_sync_log").upsert(
    {
      business_id: input.businessId,
      user_id: input.userId,
      class_date: input.classDateYmd,
      class_time: input.classTime,
      class_name: input.className,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    { onConflict: "business_id,user_id,class_date,class_time,class_name" }
  );
  if (error) {
    console.error("[leads/arbox-trial-reminder] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchTrialReminderTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  className: string;
  classTime: string;
  userId: number;
  classDateYmd: string;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: TrialReminderDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  // Detection delay already applied (due-day filter). Send on this cron run.
  const dueAt = computeDueAt({ delay_days: 0, delay_direction: "after" }, input.now);
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

  const firstName = firstNameFromFullName(String(input.fullName ?? ""));
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "trial_reminder",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    className: input.className,
    classTime: input.classTime,
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-trial-reminder] template send failed:", sendResult.error);
    return { dispatch: "send_failed", ok: false };
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
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const todayYmd = formatDateYmdIsrael(now);

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

  const rule = pickTrialReminderTemplateTriggerRule(rulesWithTemplate);
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
  const delayDays = Math.max(0, Math.trunc(Number(rule.delay_days) || 0));

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
      if (!bookingMatchesTrialScope(row, trialScope)) continue;
      summary.trial_rows += 1;
      const ok = await upsertTrialReminderSyncLog({
        admin: input.admin,
        businessId,
        userId,
        classDateYmd,
        classTime,
        className,
        contactId: null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (ok) {
        wrote += 1;
        if (needsFullSeed) summary.seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
    }

    if (wrote === 0) {
      const sentinel = await upsertTrialReminderSyncLog({
        admin: input.admin,
        businessId,
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
    return summary;
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
    if (!bookingMatchesTrialScope(row, trialScope)) continue;
    summary.trial_rows += 1;

    if (!isTrialReminderDue({ classDateYmd, todayYmd, delayDays })) continue;
    summary.due += 1;
    summary.processed += 1;

    try {
      const { data: existing } = await input.admin
        .from("arbox_trial_reminder_sync_log")
        .select("status, attempts, contact_id")
        .eq("business_id", businessId)
        .eq("user_id", userId)
        .eq("class_date", classDateYmd)
        .eq("class_time", classTime)
        .eq("class_name", className)
        .maybeSingle();

      const existingStatus = String((existing as { status?: unknown } | null)?.status ?? "").trim();
      const existingAttempts = parseCancellationSyncAttempts(
        (existing as { attempts?: unknown } | null)?.attempts
      );
      if (
        existingStatus === "seeded" ||
        existingStatus === "sent" ||
        existingStatus === "abandoned" ||
        existingStatus === "no_phone"
      ) {
        summary.already += 1;
        continue;
      }

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
        await upsertTrialReminderSyncLog({
          admin: input.admin,
          businessId,
          userId,
          classDateYmd,
          classTime,
          className,
          contactId: resolved.contact?.id ?? null,
          attempts: existingAttempts,
          status: "no_phone",
          nowIso,
        });
        continue;
      }

      const send = await dispatchTrialReminderTemplate({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: resolved.phone,
        fullName: resolveReportFullName(row) ?? resolved.contact?.full_name ?? null,
        className,
        classTime,
        userId,
        classDateYmd,
        rule,
        now,
      });

      console.info("[leads/arbox-trial-reminder] dispatch", {
        businessId,
        user_id: userId,
        class_date: classDateYmd,
        class_time: classTime,
        phone: maskPhoneForLog(resolved.phone),
        dispatch: send.dispatch,
      });

      if (
        send.dispatch === "immediate" ||
        send.dispatch === "deferred" ||
        send.dispatch === "gated" ||
        send.dispatch === "send_failed"
      ) {
        const next = nextCancellationSyncLogAfterDispatch({
          dispatch: send.dispatch,
          attemptsSoFar: existingAttempts,
        });
        if (next.hitCap) summary.abandoned += 1;
        const marked = await upsertTrialReminderSyncLog({
          admin: input.admin,
          businessId,
          userId,
          classDateYmd,
          classTime,
          className,
          contactId: resolved.contact?.id ?? null,
          attempts: next.attempts,
          status: next.status,
          nowIso,
        });
        if (!marked.ok) summary.errors += 1;
        if (send.dispatch === "immediate") summary.notified += 1;
        else if (send.dispatch === "deferred") summary.deferred += 1;
        else if (send.dispatch === "gated") summary.gated += 1;
        else if (send.dispatch === "send_failed" && !next.hitCap) summary.errors += 1;
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
