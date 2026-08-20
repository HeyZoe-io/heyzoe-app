import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { arboxFlagYes } from "@/lib/leads/arbox-membership-expiring";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildTrialAttendedScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  resolveTrialAttendedTemplateTrigger,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const ISRAEL_TZ = "Asia/Jerusalem";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Arbox report date range must not exceed 31 days. */
const MAX_REPORT_SPAN_DAYS = 30;
const MAX_REPORT_PAGES = 20;

/**
 * Lookback for late/batched attendance marking (Joe marks check_in after class day).
 * Env: TRIAL_ATTENDED_LOOKBACK_DAYS (default 7, clamped 1..30).
 */
export function trialAttendedLookbackDays(): number {
  const raw = Number.parseInt(String(process.env.TRIAL_ATTENDED_LOOKBACK_DAYS ?? "7"), 10);
  if (!Number.isFinite(raw)) return 7;
  return Math.min(MAX_REPORT_SPAN_DAYS, Math.max(1, Math.trunc(raw)));
}

/**
 * One row from Arbox GET /v3/reports/bookingsReport.
 * Attendance = check_in Yes/No (string). Live data: no membership_type_id — only membership_type_name.
 */
export type ArboxBookingReportRow = {
  user_id: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  date?: unknown;
  time?: unknown;
  class_name?: unknown;
  check_in?: unknown;
  membership_type_name?: unknown;
  /** Not present on live acrobyjoe bookingsReport; kept for defensive id match if API adds it. */
  membership_type_id?: unknown;
};

export type TrialAttendedDispatch =
  | "immediate"
  | "enqueued"
  | "gated"
  | "dedup"
  | "no_rule"
  | "not_attended"
  | "skipped_non_trial"
  | "no_phone"
  | "send_failed";

export type TrialAttendedSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials" | "no_trial_scope";
  lookback_from?: string;
  lookback_to?: string;
  fetched: number;
  pages_fetched: number;
  attended: number;
  trial_attended: number;
  skipped_non_trial: number;
  processed: number;
  dedup: number;
  notified: number;
  deferred: number;
  gated: number;
  not_attended: number;
  no_phone: number;
  errors: number;
  fetch_error?: string;
  /** How trial membership was resolved for name matching. */
  trial_match_mode?: "product_filter_names" | "business_trial_ids_names" | "name_fallback";
};

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

export function formatDateYmdIsrael(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Physical attendance: check_in string "Yes" (never truthiness — "No" is truthy). */
export function isBookingCheckedIn(checkIn: unknown): boolean {
  return arboxFlagYes(checkIn);
}

/** @deprecated alias — attendance signal is bookingsReport.check_in */
export function isTrialClassAttended(checkIn: unknown): boolean {
  return isBookingCheckedIn(checkIn);
}

export function parseClassDateYmd(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Normalize membership type names for equality (tabs/spaces/case). */
export function normalizeMembershipTypeName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * bookingsReport has membership_type_name only (no membership_type_id on live API).
 * Match by name set resolved from trial type ids; optional id match if field appears.
 */
export function bookingMatchesTrialScope(
  row: ArboxBookingReportRow,
  scope: { trialTypeIds: number[]; trialTypeNamesNormalized: Set<string> }
): boolean {
  const idRaw = Number(row.membership_type_id);
  if (Number.isFinite(idRaw) && idRaw > 0 && scope.trialTypeIds.includes(Math.trunc(idRaw))) {
    return true;
  }
  const name = normalizeMembershipTypeName(row.membership_type_name);
  if (!name) return false;
  if (scope.trialTypeNamesNormalized.has(name)) return true;
  return false;
}

/** Fallback when no trial ids configured: Hebrew/English trial name heuristic. */
export function membershipTypeNameLooksLikeTrial(raw: unknown): boolean {
  return /ניסיון|trial/i.test(String(raw ?? ""));
}

export function trialAttendedLookbackWindow(
  now: Date = new Date(),
  lookbackDays: number = trialAttendedLookbackDays()
): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(now);
  const [y, m, d] = toDate.split("-").map((n) => Number(n));
  const toUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const days = Math.min(MAX_REPORT_SPAN_DAYS, Math.max(1, Math.trunc(lookbackDays)));
  const fromUtc = new Date(toUtc.getTime() - (days - 1) * MS_PER_DAY);
  const yy = fromUtc.getUTCFullYear();
  const mm = String(fromUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fromUtc.getUTCDate()).padStart(2, "0");
  return { fromDate: `${yy}-${mm}-${dd}`, toDate };
}

export function buildBookingsReportPath(input: {
  fromDate: string;
  toDate: string;
  locationId?: string;
  page?: number;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
  });
  if (input.locationId) qs.set("location_id", input.locationId);
  if (input.page != null && input.page > 1) qs.set("page", String(input.page));
  return `/v3/reports/bookingsReport?${qs.toString()}`;
}

/** Shared Arbox GET /v3/reports/bookingsReport (paginated). Read-only. */
export async function fetchArboxBookingsReport(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
}): Promise<
  | { ok: true; rows: ArboxBookingReportRow[]; pagesFetched: number }
  | { ok: false; error: string; pagesFetched: number }
> {
  const rows: ArboxBookingReportRow[] = [];
  let pagesFetched = 0;
  let page = 1;

  while (pagesFetched < MAX_REPORT_PAGES) {
    const path = buildBookingsReportPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await arboxPublicFetch(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;
    if (!res.ok) {
      console.error("[leads/arbox-trial-attended] bookingsReport fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
        page,
      });
      return { ok: false, error: "arbox_bookings_report_fetch_failed", pagesFetched };
    }
    const payload = res.json as {
      data?: Record<string, unknown>[];
      extra?: { pagination?: { next_page_url?: string | null } };
    } | null;
    const pageRows = Array.isArray(payload?.data) ? payload!.data! : [];
    rows.push(...(pageRows as ArboxBookingReportRow[]));
    const next = String(payload?.extra?.pagination?.next_page_url ?? "").trim();
    if (!next) break;
    page += 1;
  }

  return { ok: true, rows, pagesFetched };
}

async function fetchMembershipTypeNameById(
  apiKey: string
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const res = await arboxPublicFetch("/v3/membershipTypes", { apiKey, method: "GET" });
  if (!res.ok) {
    console.error("[leads/arbox-trial-attended] membershipTypes fetch failed", {
      status: res.status,
      body: res.rawText.slice(0, 300),
    });
    return map;
  }
  const payload = res.json as { data?: Record<string, unknown>[] } | null;
  for (const row of payload?.data ?? []) {
    const id = Number(row.membership_type_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = String(row.membership_type_name ?? "").trim();
    if (name) map.set(Math.trunc(id), name);
  }
  return map;
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

function resolveReportFullName(row: ArboxBookingReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

type ContactRow = {
  id: string;
  phone?: string | null;
  full_name?: string | null;
  arbox_user_id?: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxBookingReportRow;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const arboxUserId = String(input.row.user_id ?? "").trim();
  const contactSelect = "id, phone, full_name, arbox_user_id";
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
      source: "arbox_trial_attended",
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error(
      "[leads/arbox-trial-attended] contact insert failed:",
      error?.message ?? "no_row"
    );
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function dispatchTrialAttendedTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  userId: number;
  classDateYmd: string;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: TrialAttendedDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const delayDays = Math.max(0, Math.trunc(Number(input.rule.delay_days) || 0));

  if (delayDays > 0) {
    const dueAt = computeDueAt(
      { delay_days: delayDays, delay_direction: "after" },
      input.now
    );
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildTrialAttendedScheduledDedupKey(
        input.businessId,
        input.rule.id,
        input.userId,
        input.classDateYmd
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-trial-attended] enqueue failed:", enqueueResult.error);
      return { dispatch: "send_failed", ok: false };
    }
    return { dispatch: "enqueued", ok: true };
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
    triggerType: "trial_attended",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-trial-attended] template send failed:", sendResult.error);
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
 * Daily trial_attended step: bookingsReport lookback + check_in Yes + trial membership.
 * Fires on detection of Yes (late marking), not class_date+1.
 * Trial match: bookingsReport has membership_type_name only → resolve names from product_filter /
 * business trial ids via /v3/membershipTypes (defensive id match if API adds membership_type_id).
 */
export async function syncArboxTrialAttendedForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  now?: Date;
  lookbackDays?: number;
}): Promise<TrialAttendedSyncSummary> {
  const summary: TrialAttendedSyncSummary = {
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
    errors: 0,
  };

  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const now = input.now ?? new Date();
  const lookbackDays = input.lookbackDays ?? trialAttendedLookbackDays();

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const rule = await resolveTrialAttendedTemplateTrigger({ admin: input.admin, businessId });
  if (!rule?.template_name?.trim()) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-trial-attended] skip — no enabled trial_attended rule", {
      businessId,
      businessSlug,
      dispatch: "no_rule",
    });
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
  const productFilterIds = parseIdList(rule.product_filter);

  let trialTypeIds: number[];
  let trialMatchMode: NonNullable<TrialAttendedSyncSummary["trial_match_mode"]>;
  if (productFilterIds.length) {
    trialTypeIds = productFilterIds;
    trialMatchMode = "product_filter_names";
  } else if (businessTrialIds.length) {
    trialTypeIds = businessTrialIds;
    trialMatchMode = "business_trial_ids_names";
  } else {
    trialTypeIds = [];
    trialMatchMode = "name_fallback";
  }
  summary.trial_match_mode = trialMatchMode;

  const nameById = trialTypeIds.length ? await fetchMembershipTypeNameById(apiKey) : new Map();
  const trialTypeNamesNormalized = new Set<string>();
  for (const id of trialTypeIds) {
    const name = nameById.get(id);
    if (name) trialTypeNamesNormalized.add(normalizeMembershipTypeName(name));
  }

  if (trialMatchMode !== "name_fallback" && !trialTypeNamesNormalized.size) {
    console.warn(
      "[leads/arbox-trial-attended] trial type names unresolved — falling back to name heuristic",
      { businessId, trialTypeIds }
    );
    trialMatchMode = "name_fallback";
    summary.trial_match_mode = trialMatchMode;
  }

  const window = trialAttendedLookbackWindow(now, lookbackDays);
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
  summary.fetched = report.rows.length;

  const trialScope = { trialTypeIds, trialTypeNamesNormalized };

  for (const row of report.rows) {
    const userIdRaw = Number(row.user_id);
    if (!Number.isFinite(userIdRaw) || userIdRaw <= 0) {
      summary.errors += 1;
      continue;
    }
    const userId = Math.trunc(userIdRaw);
    const classDateYmd = parseClassDateYmd(row.date);
    if (!classDateYmd) {
      summary.errors += 1;
      continue;
    }

    const logBase = {
      businessId,
      user_id: userId,
      class_date: classDateYmd,
      membership_type_name: String(row.membership_type_name ?? "").trim() || null,
      contact: null as string | null,
    };

    if (!isBookingCheckedIn(row.check_in)) {
      summary.not_attended += 1;
      continue;
    }
    summary.attended += 1;

    const isTrial =
      trialMatchMode === "name_fallback"
        ? membershipTypeNameLooksLikeTrial(row.membership_type_name)
        : bookingMatchesTrialScope(row, trialScope);

    if (!isTrial) {
      summary.skipped_non_trial += 1;
      console.info("[leads/arbox-trial-attended] dispatch", {
        ...logBase,
        dispatch: "skipped_non_trial",
      });
      continue;
    }
    summary.trial_attended += 1;

    try {
      const { data: existingSeen } = await input.admin
        .from("arbox_trial_attended_sync_log")
        .select("user_id")
        .eq("business_id", businessId)
        .eq("user_id", userId)
        .eq("class_date", classDateYmd)
        .maybeSingle();

      if (existingSeen) {
        summary.dedup += 1;
        console.info("[leads/arbox-trial-attended] dispatch", {
          ...logBase,
          dispatch: "dedup",
        });
        continue;
      }

      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row,
      });
      if (!resolved.phone || !resolved.contact?.id) {
        summary.no_phone += 1;
        console.info("[leads/arbox-trial-attended] dispatch", {
          ...logBase,
          dispatch: "no_phone",
        });
        continue;
      }

      logBase.contact = maskPhoneForLog(resolved.phone);

      const send = await dispatchTrialAttendedTemplate({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: resolved.phone,
        fullName: resolveReportFullName(row) ?? resolved.contact.full_name ?? null,
        userId,
        classDateYmd,
        rule,
        now,
      });

      summary.processed += 1;
      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "enqueued") summary.deferred += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "send_failed") summary.errors += 1;

      console.info("[leads/arbox-trial-attended] dispatch", {
        ...logBase,
        dispatch: send.dispatch,
      });

      if (send.ok && (send.dispatch === "immediate" || send.dispatch === "enqueued")) {
        const { error: logErr } = await input.admin.from("arbox_trial_attended_sync_log").upsert(
          {
            business_id: businessId,
            user_id: userId,
            class_date: classDateYmd,
            contact_id: resolved.contact.id,
            processed_at: now.toISOString(),
          },
          { onConflict: "business_id,user_id,class_date" }
        );
        if (logErr) {
          console.error(
            "[leads/arbox-trial-attended] sync_log upsert failed:",
            logErr.message
          );
          summary.errors += 1;
        }
      }
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-trial-attended] row threw", {
        businessId,
        user_id: userId,
        class_date: classDateYmd,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return summary;
}
