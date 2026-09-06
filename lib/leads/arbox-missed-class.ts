/**
 * C3 missed_class (members) + C4 missed_trial (leads): bookingsReport past rows with check_in="No".
 * Shares bookingsReport fetch with trial_attended (cron prefetch). Shared sync_log (no event_kind).
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
  nextCancellationSyncLogAfterDispatch,
  parseCancellationSyncAttempts,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
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
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildMissedClassScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  resolveMissedClassTemplateTrigger,
  resolveMissedTrialTemplateTrigger,
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
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxBookingReportRow;
  source: string;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const contactSelect = "id, phone, full_name, arbox_user_id";
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
  userId: number;
  classDateYmd: string;
  classTime: string;
  className: string;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_missed_class_sync_log").upsert(
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
    console.error("[leads/arbox-missed-class] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchMissedTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  className: string;
  userId: number;
  classDateYmd: string;
  classTime: string;
  kind: MissedClassKind;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: "immediate" | "deferred" | "gated" | "send_failed" | "no_rule"; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const delayDays = Math.max(0, Math.trunc(Number(input.rule.delay_days) || 0));
  const eventDate = parseClassDateAsEventDate(input.classDateYmd);
  const dueAt = computeDueAt(
    {
      delay_days: delayDays,
      delay_direction: delayDirectionForTrigger(input.kind, input.rule.delay_direction),
    },
    eventDate
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

  const firstName = firstNameFromFullName(String(input.fullName ?? ""));
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
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-missed-class] template send failed:", sendResult.error);
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

export type BookingsReportFetchPlan = {
  /** Any bookings-based rule has a template → shared past GET. */
  needsFetch: boolean;
  /** Expand lookback to the 30d seed window only when a missed_* rule is live + unseeded. */
  hasMissedRule: boolean;
  /** Force 30d past whenever attendance_gap is live (gap needs last Yes in window). */
  hasAttendanceGapRule: boolean;
  /** C5/C6 post-trial follow-up — widen past + sales join on daily cron. */
  hasPostTrialFollowupRule: boolean;
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
    ])
    .limit(40);
  if (error) {
    console.error("[leads/arbox-missed-class] needs-fetch lookup failed:", error.message);
    return {
      needsFetch: true,
      hasMissedRule: true,
      hasAttendanceGapRule: true,
      hasPostTrialFollowupRule: true,
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

  const [classRule, trialRule] = await Promise.all([
    resolveMissedClassTemplateTrigger({ admin: input.admin, businessId }),
    resolveMissedTrialTemplateTrigger({ admin: input.admin, businessId }),
  ]);
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
  const productFilterIds = parseIdList(trialRule?.product_filter);

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
      const up = await upsertMissedSyncLog({
        admin: input.admin,
        businessId,
        userId,
        classDateYmd,
        classTime,
        className,
        contactId: resolved.contact?.id ?? null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (up.ok) summary.seeded += 1;
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

    const isTrial =
      trialMatchMode === "name_fallback"
        ? membershipTypeNameLooksLikeTrial(row.membership_type_name)
        : bookingMatchesTrialScope(row, trialScope);

    let kind: MissedClassKind | null = null;
    let rule: PurchaseTemplateTriggerRule | null = null;
    if (isTrial && hasTrial && trialRule) {
      kind = "missed_trial";
      rule = trialRule;
      summary.routed_trial += 1;
    } else if (!isTrial && hasClass && classRule) {
      kind = "missed_class";
      rule = classRule;
      summary.routed_class += 1;
    } else {
      continue;
    }

    try {
      const { data: existing } = await input.admin
        .from("arbox_missed_class_sync_log")
        .select("status, attempts, contact_id")
        .eq("business_id", businessId)
        .eq("user_id", userId)
        .eq("class_date", classDateYmd)
        .eq("class_time", classTime)
        .eq("class_name", className)
        .maybeSingle();

      const status = String((existing as { status?: unknown } | null)?.status ?? "");
      if (status === "seeded" || status === "sent" || status === "abandoned" || status === "no_phone") {
        summary.already += 1;
        continue;
      }
      const attemptsSoFar = parseCancellationSyncAttempts(
        (existing as { attempts?: unknown } | null)?.attempts
      );

      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row,
        source: `arbox_${kind}`,
      });
      if (!resolved.phone || !resolved.contact?.id) {
        summary.no_phone += 1;
        await upsertMissedSyncLog({
          admin: input.admin,
          businessId,
          userId,
          classDateYmd,
          classTime,
          className,
          contactId: resolved.contact?.id ?? null,
          attempts: attemptsSoFar,
          status: "no_phone",
          nowIso,
        });
        continue;
      }

      const send = await dispatchMissedTemplate({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: resolved.phone,
        fullName: resolveReportFullName(row) ?? resolved.contact.full_name ?? null,
        className,
        userId,
        classDateYmd,
        classTime,
        kind,
        rule,
        now,
      });

      const mapped =
        send.dispatch === "immediate"
          ? ("immediate" as const)
          : send.dispatch === "deferred"
            ? ("deferred" as const)
            : send.dispatch === "gated"
              ? ("gated" as const)
              : send.dispatch === "send_failed"
                ? ("send_failed" as const)
                : ("gated" as const);

      const next = nextCancellationSyncLogAfterDispatch({
        dispatch: mapped,
        attemptsSoFar,
      });
      await upsertMissedSyncLog({
        admin: input.admin,
        businessId,
        userId,
        classDateYmd,
        classTime,
        className,
        contactId: resolved.contact.id,
        attempts: next.attempts,
        status: next.status,
        nowIso,
      });

      summary.processed += 1;
      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "deferred") summary.deferred += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "send_failed") {
        if (next.hitCap) summary.abandoned += 1;
        else summary.errors += 1;
      }

      console.info("[leads/arbox-missed-class] dispatch", {
        businessId,
        kind,
        user_id: userId,
        class_date: classDateYmd,
        contact: maskPhoneForLog(resolved.phone),
        dispatch: send.dispatch,
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
