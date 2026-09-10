/**
 * Staff B5: notify the trainer that a class instance was cancelled.
 * cancelledSessionsReport (schedule-level) joined to classesSummaryReport
 * by schedule_id for staff_member_phone.
 *
 * Window: yesterday+today Israel. No seed column — first deploy may catch
 * yesterday's cancels (accepted). Dedup is scheduled_template_sends.
 *
 * IO (10 businesses): up to 2 paginated report GETs/business/day when the
 * rule is enabled. No Claude. No contacts insert. No Conversations log.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";
import {
  formatDateYmdIsrael,
  parseClassDateYmd,
} from "@/lib/leads/arbox-trial-attended";
import {
  normalizeTrialReminderClassNamePk,
  normalizeTrialReminderClassTimePk,
} from "@/lib/leads/arbox-trial-reminder";
import { normalizePhone } from "@/lib/phone-normalize";
import {
  buildClassCancelledStaffScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
  markScheduledTemplateSendSentByDedupKey,
} from "@/lib/scheduled-template-sends";
import { dispatchStaffTemplateImmediate } from "@/lib/staff-template-dispatch";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledClassCancelledStaffTemplateTriggers,
  pickClassCancelledStaffTemplateTriggerRule,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ClassCancelledStaffDispatch =
  | "immediate"
  | "already"
  | "no_rule"
  | "no_phone"
  | "gated"
  | "send_failed";

export type ClassCancelledStaffSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  lookback_from?: string;
  lookback_to?: string;
  fetched_cancelled: number;
  fetched_summary: number;
  pages_fetched: number;
  cancelled_rows: number;
  processed: number;
  already: number;
  notified: number;
  gated: number;
  no_phone: number;
  errors: number;
  fetch_error?: string;
};

export type CancelledSessionReportRow = {
  schedule_id?: unknown;
  class_name?: unknown;
  date?: unknown;
  start_time?: unknown;
  time?: unknown;
  status?: unknown;
  staff_member_phone?: unknown;
};

export type ClassesSummaryReportRow = {
  schedule_id?: unknown;
  staff_member_phone?: unknown;
  class_name?: unknown;
  date?: unknown;
  start_time?: unknown;
  time?: unknown;
  status?: unknown;
};

/** Yesterday + today Israel (no seed). */
export function classCancelledStaffLookbackWindow(now: Date = new Date()): {
  fromDate: string;
  toDate: string;
} {
  const toDate = formatDateYmdIsrael(now);
  const [y, m, d] = toDate.split("-").map((n) => Number(n));
  const toUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const fromUtc = new Date(toUtc.getTime() - MS_PER_DAY);
  const yy = fromUtc.getUTCFullYear();
  const mm = String(fromUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fromUtc.getUTCDate()).padStart(2, "0");
  return { fromDate: `${yy}-${mm}-${dd}`, toDate };
}

export function isCancelledSessionStatus(raw: unknown): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return true;
  return s === "cancelled" || s === "canceled" || s === "deleted";
}

export function parseScheduleId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export function staffPhoneFromReportValue(raw: unknown): string | null {
  return normalizePhone(raw) ?? (String(raw ?? "").replace(/\D/g, "").trim() || null);
}

export function staffPhoneByScheduleId(
  summaryRows: readonly ClassesSummaryReportRow[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of summaryRows) {
    const id = parseScheduleId(row.schedule_id);
    const phone = staffPhoneFromReportValue(row.staff_member_phone);
    if (!id || !phone) continue;
    if (!map.has(id)) map.set(id, phone);
  }
  return map;
}

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

export function buildCancelledSessionsReportPath(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  page?: number;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    location_id: input.locationId,
  });
  if (input.page != null && input.page > 1) qs.set("page", String(input.page));
  return `/v3/reports/cancelledSessionsReport?${qs.toString()}`;
}

export function buildClassesSummaryReportPath(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  page?: number;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    location_id: input.locationId,
  });
  if (input.page != null && input.page > 1) qs.set("page", String(input.page));
  return `/v3/reports/classesSummaryReport?${qs.toString()}`;
}

export async function fetchCancelledSessionsReport(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
  fetchPage?: typeof arboxPublicFetch;
}): Promise<
  | { ok: true; rows: CancelledSessionReportRow[]; pagesFetched: number }
  | { ok: false; error: string; pagesFetched: number }
> {
  const result = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.locationId,
    logLabel: "leads/arbox-class-cancelled-staff/cancelledSessionsReport",
    buildPath: (page) =>
      buildCancelledSessionsReportPath({
        fromDate: input.fromDate,
        toDate: input.toDate,
        locationId: input.locationId,
        page,
      }),
    fetchPage: input.fetchPage,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, pagesFetched: result.pagesFetched };
  }
  return {
    ok: true,
    rows: result.rows as CancelledSessionReportRow[],
    pagesFetched: result.pagesFetched,
  };
}

export async function fetchClassesSummaryReport(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
  fetchPage?: typeof arboxPublicFetch;
}): Promise<
  | { ok: true; rows: ClassesSummaryReportRow[]; pagesFetched: number }
  | { ok: false; error: string; pagesFetched: number }
> {
  const result = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.locationId,
    logLabel: "leads/arbox-class-cancelled-staff/classesSummaryReport",
    buildPath: (page) =>
      buildClassesSummaryReportPath({
        fromDate: input.fromDate,
        toDate: input.toDate,
        locationId: input.locationId,
        page,
      }),
    fetchPage: input.fetchPage,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, pagesFetched: result.pagesFetched };
  }
  return {
    ok: true,
    rows: result.rows as ClassesSummaryReportRow[],
    pagesFetched: result.pagesFetched,
  };
}

async function dispatchClassCancelledStaff(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
  scheduleId: string;
  className: string;
  classDateYmd: string;
  classTime: string;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: ClassCancelledStaffDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const dueAt = computeDueAt({ delay_days: 0, delay_direction: "after" }, input.now);
  const dedupKey = buildClassCancelledStaffScheduledDedupKey({
    businessId: input.businessId,
    triggerId: input.rule.id,
    scheduleId: input.scheduleId,
    className: input.className,
    classDateYmd: input.classDateYmd,
    classTime: input.classTime,
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
    console.error("[leads/arbox-class-cancelled-staff] enqueue failed:", enqueueResult.error);
    return { dispatch: "send_failed", ok: false };
  }
  if (!enqueueResult.inserted) return { dispatch: "already", ok: true };

  const send = await dispatchStaffTemplateImmediate({
    admin: input.admin,
    businessId: input.businessId,
    phone: input.phone,
    templateName,
    triggerType: "class_cancelled_staff",
    className: input.className,
    classTime: input.classTime,
    expiryDateYmd: input.classDateYmd,
  });
  if (send === "sent") {
    const marked = await markScheduledTemplateSendSentByDedupKey({
      admin: input.admin,
      dedupKey,
    });
    if (!marked.ok) {
      console.error("[leads/arbox-class-cancelled-staff] mark sent failed:", marked.error);
    }
    return { dispatch: "immediate", ok: true };
  }
  if (send === "gated") return { dispatch: "gated", ok: false };
  return { dispatch: "send_failed", ok: false };
}

export async function syncArboxClassCancelledStaffForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  now?: Date;
}): Promise<ClassCancelledStaffSyncSummary> {
  const summary: ClassCancelledStaffSyncSummary = {
    fetched_cancelled: 0,
    fetched_summary: 0,
    pages_fetched: 0,
    cancelled_rows: 0,
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

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const rules = await loadEnabledClassCancelledStaffTemplateTriggers(input.admin, businessId);
  const rulesWithTemplate = rules.filter((r) => Boolean(r.template_name?.trim()));
  if (!rulesWithTemplate.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-class-cancelled-staff] skip — no enabled rule", {
      businessId,
      businessSlug,
    });
    return summary;
  }

  const rule = pickClassCancelledStaffTemplateTriggerRule(rulesWithTemplate);
  if (!rule?.template_name?.trim()) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  const window = classCancelledStaffLookbackWindow(now);
  summary.lookback_from = window.fromDate;
  summary.lookback_to = window.toDate;

  const cancelled = await fetchCancelledSessionsReport({
    apiKey,
    fromDate: window.fromDate,
    toDate: window.toDate,
    locationId: boxId,
  });
  summary.pages_fetched += cancelled.pagesFetched;
  if (!cancelled.ok) {
    summary.fetch_error = cancelled.error;
    summary.errors += 1;
    return summary;
  }
  summary.fetched_cancelled = cancelled.rows.length;

  const summaryReport = await fetchClassesSummaryReport({
    apiKey,
    fromDate: window.fromDate,
    toDate: window.toDate,
    locationId: boxId,
  });
  summary.pages_fetched += summaryReport.pagesFetched;
  if (!summaryReport.ok) {
    summary.fetch_error = summaryReport.error;
    summary.errors += 1;
    return summary;
  }
  summary.fetched_summary = summaryReport.rows.length;

  const phoneBySchedule = staffPhoneByScheduleId(summaryReport.rows);

  for (const row of cancelled.rows) {
    if (!isCancelledSessionStatus(row.status)) continue;
    summary.cancelled_rows += 1;

    const scheduleId = parseScheduleId(row.schedule_id);
    const classDateYmd = parseClassDateYmd(row.date);
    const classTime =
      normalizeTrialReminderClassTimePk(row.start_time) ??
      normalizeTrialReminderClassTimePk(row.time);
    const className = normalizeTrialReminderClassNamePk(row.class_name);
    if (!scheduleId || !classDateYmd || !classTime || !className) {
      summary.errors += 1;
      continue;
    }

    summary.processed += 1;
    const trainerPhone =
      staffPhoneFromReportValue(row.staff_member_phone) ?? phoneBySchedule.get(scheduleId) ?? null;
    if (!trainerPhone) {
      summary.no_phone += 1;
      console.info("[leads/arbox-class-cancelled-staff] no_phone after join", {
        businessId,
        schedule_id: scheduleId,
        class_date: classDateYmd,
      });
      continue;
    }

    try {
      const send = await dispatchClassCancelledStaff({
        admin: input.admin,
        businessId,
        phone: trainerPhone,
        scheduleId,
        className,
        classDateYmd,
        classTime,
        rule,
        now,
      });

      console.info("[leads/arbox-class-cancelled-staff] dispatch", {
        businessId,
        schedule_id: scheduleId,
        class_date: classDateYmd,
        class_time: classTime,
        phone: maskPhoneForLog(trainerPhone),
        dispatch: send.dispatch,
      });

      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "already") summary.already += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "send_failed") summary.errors += 1;
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-class-cancelled-staff] row threw", {
        businessId,
        schedule_id: scheduleId,
        class_date: classDateYmd,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return summary;
}
