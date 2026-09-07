import { fetchAllArboxMembershipTypes, membershipTypeNameById } from "@/lib/arbox-membership-types";
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { ymdDiffDays } from "@/lib/leads/arbox-attendance-gap";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledMembershipCancelledTemplateTriggers,
  matchingMembershipCancelledTemplateTriggerRules,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";
import { fetchCanceledMembershipsReportRows } from "@/lib/leads/arbox-canceled-memberships-report";
import { fetchArboxCustomerUserIds } from "@/lib/leads/arbox-customer-set";
import { parseEndDateYmd } from "@/lib/leads/arbox-membership-expiring";

const ISRAEL_TZ = "Asia/Jerusalem";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** First-run seed window — Arbox reports reject spans over 31 days. */
export const CANCELLATION_SEED_SPAN_DAYS = 30;
/** After seed: fromDate = today − this many days (yesterday + today) when all delays are 0. */
export const CANCELLATION_LOOKBACK_DAYS = 1;
/** Arbox report date range must not exceed 31 days. */
export const ARBOX_REPORT_MAX_SPAN_DAYS = 30;

/** Widen lookback to the longest enabled delay so day-7 / day-21 steps still see the row. */
export function lookbackDaysForSequenceDelays(
  delayDaysList: readonly number[],
  minLookback: number
): number {
  let maxDelay = Math.max(0, Math.trunc(minLookback));
  for (const raw of delayDaysList) {
    const n = Math.max(0, Math.trunc(Number(raw) || 0));
    if (n > maxDelay) maxDelay = n;
  }
  return Math.min(ARBOX_REPORT_MAX_SPAN_DAYS, maxDelay);
}

/** YYYY-MM-DD prefix of report timestamps (lost_date / cancelled_time). */
export function reportTimestampToYmd(raw: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw ?? "").trim());
  return m?.[1] ?? null;
}

/** Day-grain: send on the cron run of eventYmd + delay_days (delay 0 = event day). */
export function isExactDaysAfterEvent(input: {
  eventYmd: string;
  todayYmd: string;
  delayDays: number;
}): boolean {
  const days = Math.max(0, Math.trunc(input.delayDays));
  return ymdDiffDays(input.todayYmd, input.eventYmd) === days;
}

/** Delay 0 = day-of cancel confirmation. Later delays are win-back sequence steps. */
export function isMembershipCancelledWinBackStep(delayDays: number): boolean {
  return Math.max(0, Math.trunc(Number(delayDays) || 0)) > 0;
}

/**
 * Cancel rows stay on canceledMembershipsReport after a rejoin. Skip win-back
 * (not day-of confirmation) when the user is in the A1 customer set.
 */
export function shouldSkipCancelledWinBackBecauseActive(input: {
  delayDays: number;
  userId: number;
  activeCustomerIds: ReadonlySet<number>;
}): boolean {
  if (!isMembershipCancelledWinBackStep(input.delayDays)) return false;
  return input.activeCustomerIds.has(input.userId);
}

/** Max real Meta/enqueue failures (`send_failed`) before status=abandoned. `gated` does not count. */
export const ARBOX_SYNC_SEND_ATTEMPT_CAP = 3;

export type CancellationSyncLogStatus =
  | "pending"
  | "seeded"
  | "sent"
  | "abandoned"
  | "no_phone";

const CANCELLATION_SYNC_TERMINAL_STATUSES: readonly CancellationSyncLogStatus[] = [
  "seeded",
  "sent",
  "abandoned",
  "no_phone",
];

export function isCancellationSyncLogTerminal(status: string | null | undefined): boolean {
  return (CANCELLATION_SYNC_TERMINAL_STATUSES as readonly string[]).includes(
    String(status ?? "").trim()
  );
}

/** No row or `pending` → try send. Terminal statuses are done. */
export function shouldRetryCancellationSyncLog(status: string | null | undefined): boolean {
  if (status == null || String(status).trim() === "") return true;
  return String(status).trim() === "pending";
}

export function parseCancellationSyncAttempts(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

/**
 * Next sync_log grain after a dispatch.
 * Only `send_failed` increments attempts. `gated` stays pending at the same count
 * so a trigger enabled before Meta approval is not abandoned.
 */
export function nextCancellationSyncLogAfterDispatch(input: {
  dispatch: "gated" | "send_failed" | "immediate" | "deferred" | "no_phone" | "seeded";
  attemptsSoFar: number;
  cap?: number;
}): { attempts: number; status: CancellationSyncLogStatus; hitCap: boolean } {
  const soFar = parseCancellationSyncAttempts(input.attemptsSoFar);
  if (input.dispatch === "seeded") return { attempts: soFar, status: "seeded", hitCap: false };
  if (input.dispatch === "no_phone") return { attempts: soFar, status: "no_phone", hitCap: false };
  if (input.dispatch === "immediate" || input.dispatch === "deferred") {
    return { attempts: soFar, status: "sent", hitCap: false };
  }
  if (input.dispatch === "gated") {
    return { attempts: soFar, status: "pending", hitCap: false };
  }
  const cap = input.cap ?? ARBOX_SYNC_SEND_ATTEMPT_CAP;
  const attempts = soFar + 1;
  if (attempts >= cap) return { attempts, status: "abandoned", hitCap: true };
  return { attempts, status: "pending", hitCap: false };
}

/** One warn per business run — not per row — when send_failed hits the cap. */
export function warnAbandonedCancellationSyncLog(input: {
  businessId: number;
  abandoned: number;
  reason: string;
}): void {
  if (input.abandoned <= 0) return;
  console.warn("[leads/arbox-membership-cancelled] abandoned send_failed rows", {
    business_id: input.businessId,
    abandoned: input.abandoned,
    reason: input.reason,
  });
}

export type ArboxCanceledMembershipRow = {
  user_id: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  membership_type_name?: unknown;
  membership_type_type?: unknown;
  purchase_date?: unknown;
  end_date?: unknown;
  cancelled_time?: unknown;
  cancel_reason?: unknown;
  cancelled_by?: unknown;
};

export type MembershipCancelledDispatch =
  | "immediate"
  | "deferred"
  | "gated"
  | "no_rule"
  | "seeded"
  | "already"
  | "skipped_filter"
  | "skipped_rejoined"
  | "no_phone"
  | "send_failed";

export type MembershipCancelledSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched: number;
  pages_fetched: number;
  seeded: number;
  processed: number;
  already: number;
  skipped_filter: number;
  skipped_rejoined: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  abandoned: number;
  errors: number;
  fetch_error?: string;
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

/** Trimmed report cancelled_time — PK grain. Empty → not a valid cancellation event. */
export function normalizeCancelledTimePk(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export function parseCancellationUserId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/** Event date for delay_days > 0. YMD prefix → UTC noon; else Date.parse; else now. */
export function parseCancelledEventDate(raw: unknown, now: Date = new Date()): Date {
  const s = String(raw ?? "").trim();
  if (!s) return now;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0));
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

export function seedMembershipCancelledReportDateRange(now: Date): {
  fromDate: string;
  toDate: string;
} {
  const toDate = formatDateYmdIsrael(now);
  const fromDate = formatDateYmdIsrael(
    new Date(now.getTime() - CANCELLATION_SEED_SPAN_DAYS * MS_PER_DAY)
  );
  return { fromDate, toDate };
}

export function membershipCancelledReportDateRange(input: {
  seeded: boolean;
  now: Date;
  lookbackDays?: number;
}): { fromDate: string; toDate: string } {
  if (!input.seeded) return seedMembershipCancelledReportDateRange(input.now);
  const toDate = formatDateYmdIsrael(input.now);
  const days = Math.max(
    CANCELLATION_LOOKBACK_DAYS,
    Math.trunc(input.lookbackDays ?? CANCELLATION_LOOKBACK_DAYS)
  );
  const fromDate = formatDateYmdIsrael(new Date(input.now.getTime() - days * MS_PER_DAY));
  return { fromDate, toDate };
}

function resolveReportFullName(row: ArboxCanceledMembershipRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

async function fetchMembershipTypeNameById(apiKey: string): Promise<Map<number, string>> {
  const result = await fetchAllArboxMembershipTypes({
    apiKey,
    logLabel: "leads/arbox-membership-cancelled",
  });
  if (!result.ok) return new Map();
  return membershipTypeNameById(result.types);
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
  row: ArboxCanceledMembershipRow;
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
      source: "arbox_membership_cancelled",
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error(
      "[leads/arbox-membership-cancelled] contact insert failed:",
      error?.message ?? "no_row"
    );
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertCancellationSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  userId: number;
  cancelledTime: string;
  contactId: string | null;
  nowIso: string;
  status: CancellationSyncLogStatus;
  attempts: number;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_cancellation_sync_log").upsert(
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      user_id: input.userId,
      cancelled_time: input.cancelledTime,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      status: input.status,
      attempts: input.attempts,
    },
    { onConflict: "business_id,trigger_id,user_id,cancelled_time" }
  );
  if (error) {
    console.error("[leads/arbox-membership-cancelled] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function dispatchMembershipCancelledTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  userId: number;
  cancelledTime: string;
  membershipTypeName: string;
  endDateYmd: string | null;
  rule: PurchaseTemplateTriggerRule;
}): Promise<{ dispatch: MembershipCancelledDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

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
    triggerType: "membership_cancelled",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    membershipTypeName: input.membershipTypeName,
    expiryDateYmd: input.endDateYmd,
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-membership-cancelled] template send failed:", sendResult.error);
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
 * Daily membership_cancelled step for one Arbox business.
 *
 * IO (10 businesses): 1 canceledMembershipsReport GET each (paginated; Limitless ~267/30d ≈ 2 pages
 * on seed, 1 page after). Plus 1 GET /v3/membershipTypes only when a product_filter is set.
 * WhatsApp/Meta: one immediate send per matching rule on its due day (delay 0 = cancel day).
 * Multiple rules replace a D4 state machine. Win-back steps (delay > 0) cross the A1
 * customer set (`fetchArboxCustomerUserIds`: activeMemberships ∪ sessions). If the user
 * is active again, skip that step. Day-of confirmation still sends.
 * **IO:** +2 customer-report GETs only when a delay>0 step is due today (same reports as A1;
 * lazy, one fetch per business run). 10 businesses → 0 extra if only delay 0 is live.
 *
 * Seed (arbox_cancellation_seeded=false): mark the 30-day window seen, no WhatsApp.
 * Soft-seed: empty log for a new trigger_id → same 30-day mark, no WhatsApp.
 */
export async function syncArboxMembershipCancelledForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  cancellationSeeded: boolean;
  now?: Date;
  /** Optional A1 customer set from the same cron run — skip a second fetch. */
  activeCustomerIds?: ReadonlySet<number>;
}): Promise<MembershipCancelledSyncSummary> {
  const summary: MembershipCancelledSyncSummary = {
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

  const rules = await loadEnabledMembershipCancelledTemplateTriggers(input.admin, businessId);
  const rulesWithTemplate = rules.filter((r) => Boolean(r.template_name?.trim()));
  if (!rulesWithTemplate.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-membership-cancelled] skip — no enabled membership_cancelled rule", {
      businessId,
      businessSlug,
      dispatch: "no_rule",
    });
    return summary;
  }

  const lookbackDays = lookbackDaysForSequenceDelays(
    rulesWithTemplate.map((r) => r.delay_days),
    CANCELLATION_LOOKBACK_DAYS
  );
  const { fromDate, toDate } = membershipCancelledReportDateRange({
    seeded: input.cancellationSeeded,
    now,
    lookbackDays,
  });

  const report = await fetchCanceledMembershipsReportRows({
    apiKey,
    fromDate,
    toDate,
    locationId: boxId,
  });
  summary.pages_fetched = report.pagesFetched;
  if (!report.ok) {
    summary.fetch_error = report.error;
    summary.errors += 1;
    return summary;
  }
  summary.fetched = report.rows.length;
  const reportRows = report.rows;

  const needsTypeMap = rulesWithTemplate.some((r) => (r.product_filter?.length ?? 0) > 0);
  const nameById = needsTypeMap
    ? await fetchMembershipTypeNameById(apiKey)
    : new Map<number, string>();
  const todayYmd = formatDateYmdIsrael(now);

  async function seedRuleRows(rule: PurchaseTemplateTriggerRule): Promise<number> {
    let wrote = 0;
    for (const raw of reportRows) {
      const row = raw as ArboxCanceledMembershipRow;
      const userId = parseCancellationUserId(row.user_id);
      const cancelledTime = normalizeCancelledTimePk(row.cancelled_time);
      if (userId == null || !cancelledTime) continue;
      const membershipTypeName = String(row.membership_type_name ?? "").trim();
      if (
        !matchingMembershipCancelledTemplateTriggerRules(
          [rule],
          membershipTypeName,
          nameById
        ).length
      ) {
        continue;
      }
      const marked = await upsertCancellationSyncLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        userId,
        cancelledTime,
        contactId: null,
        nowIso,
        status: "seeded",
        attempts: 0,
      });
      if (!marked.ok) {
        summary.errors += 1;
        continue;
      }
      wrote += 1;
      console.info("[leads/arbox-membership-cancelled] dispatch", {
        businessId,
        trigger_id: rule.id,
        user_id: userId,
        cancelled_time: cancelledTime,
        contact: null,
        dispatch: "seeded" satisfies MembershipCancelledDispatch,
      });
    }
    return wrote;
  }

  if (!input.cancellationSeeded) {
    for (const rule of rulesWithTemplate) {
      summary.seeded += await seedRuleRows(rule);
    }
    const { error: flagErr } = await input.admin
      .from("businesses")
      .update({ arbox_cancellation_seeded: true })
      .eq("id", businessId);
    if (flagErr) {
      console.error("[leads/arbox-membership-cancelled] seeded flag update failed:", flagErr.message);
      summary.errors += 1;
      summary.fetch_error = "arbox_cancellation_seeded_flag_failed";
    }
    return summary;
  }

  const seededThisRun = new Set<string>();
  for (const rule of rulesWithTemplate) {
    const { count, error } = await input.admin
      .from("arbox_cancellation_sync_log")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("trigger_id", rule.id);
    if (error) {
      console.error("[leads/arbox-membership-cancelled] per-trigger seed count failed:", error.message);
      continue;
    }
    if ((count ?? 0) > 0) continue;
    summary.seeded += await seedRuleRows(rule);
    seededThisRun.add(rule.id);
  }

  type CustomerSetState = { kind: "ready"; ids: ReadonlySet<number> } | { kind: "failed" };
  let customerSetState: CustomerSetState | undefined = input.activeCustomerIds
    ? { kind: "ready", ids: input.activeCustomerIds }
    : undefined;

  async function ensureActiveCustomerIds(): Promise<ReadonlySet<number> | null> {
    if (customerSetState?.kind === "ready") return customerSetState.ids;
    if (customerSetState?.kind === "failed") return null;
    const fetched = await fetchArboxCustomerUserIds({ apiKey, boxId, now });
    if (!fetched.ok) {
      customerSetState = { kind: "failed" };
      summary.errors += 1;
      summary.fetch_error = fetched.error;
      console.error("[leads/arbox-membership-cancelled] customer set fetch failed", {
        businessId,
        businessSlug,
        error: fetched.error,
      });
      return null;
    }
    customerSetState = { kind: "ready", ids: fetched.userIds };
    return fetched.userIds;
  }

  for (const raw of reportRows) {
    const row = raw as ArboxCanceledMembershipRow;
    const userId = parseCancellationUserId(row.user_id);
    const cancelledTime = normalizeCancelledTimePk(row.cancelled_time);
    if (userId == null || !cancelledTime) {
      summary.errors += 1;
      continue;
    }

    const membershipTypeName = String(row.membership_type_name ?? "").trim();
    const endDateYmd = parseEndDateYmd(row.end_date);
    const eventYmd = reportTimestampToYmd(cancelledTime);
    const matching = matchingMembershipCancelledTemplateTriggerRules(
      rulesWithTemplate.filter((r) => !seededThisRun.has(r.id)),
      membershipTypeName,
      nameById
    );
    if (!matching.length) {
      summary.skipped_filter += 1;
      continue;
    }

    let resolved:
      | Awaited<ReturnType<typeof resolveOrCreateContact>>
      | undefined;

    for (const rule of matching) {
      const logBase = {
        businessId,
        trigger_id: rule.id,
        user_id: userId,
        cancelled_time: cancelledTime,
        membership_type_name: membershipTypeName || null,
        contact: null as string | null,
      };

      if (
        !eventYmd ||
        !isExactDaysAfterEvent({
          eventYmd,
          todayYmd,
          delayDays: rule.delay_days,
        })
      ) {
        continue;
      }

      try {
        const { data: existingSeen } = await input.admin
          .from("arbox_cancellation_sync_log")
          .select("user_id, status, attempts")
          .eq("business_id", businessId)
          .eq("trigger_id", rule.id)
          .eq("user_id", userId)
          .eq("cancelled_time", cancelledTime)
          .maybeSingle();

        const existingStatus = String(
          (existingSeen as { status?: unknown } | null)?.status ?? ""
        ).trim();
        const existingAttempts = parseCancellationSyncAttempts(
          (existingSeen as { attempts?: unknown } | null)?.attempts
        );

        if (existingSeen && !shouldRetryCancellationSyncLog(existingStatus)) {
          summary.already += 1;
          console.info("[leads/arbox-membership-cancelled] dispatch", {
            ...logBase,
            dispatch: "already" satisfies MembershipCancelledDispatch,
          });
          continue;
        }

        if (isMembershipCancelledWinBackStep(rule.delay_days)) {
          const activeIds = await ensureActiveCustomerIds();
          if (!activeIds) {
            console.info("[leads/arbox-membership-cancelled] dispatch", {
              ...logBase,
              dispatch: "customer_set_failed",
            });
            continue;
          }
          if (
            shouldSkipCancelledWinBackBecauseActive({
              delayDays: rule.delay_days,
              userId,
              activeCustomerIds: activeIds,
            })
          ) {
            summary.skipped_rejoined += 1;
            const marked = await upsertCancellationSyncLog({
              admin: input.admin,
              businessId,
              triggerId: rule.id,
              userId,
              cancelledTime,
              contactId: null,
              nowIso,
              status: "seeded",
              attempts: existingAttempts,
            });
            if (!marked.ok) summary.errors += 1;
            console.info("[leads/arbox-membership-cancelled] dispatch", {
              ...logBase,
              dispatch: "skipped_rejoined" satisfies MembershipCancelledDispatch,
            });
            continue;
          }
        }

        if (!resolved) {
          resolved = await resolveOrCreateContact({
            admin: input.admin,
            businessId,
            row,
          });
        }
        if (!resolved.phone || !resolved.contact?.id) {
          summary.no_phone += 1;
          const next = nextCancellationSyncLogAfterDispatch({
            dispatch: "no_phone",
            attemptsSoFar: existingAttempts,
          });
          await upsertCancellationSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            cancelledTime,
            contactId: null,
            nowIso,
            status: next.status,
            attempts: next.attempts,
          });
          console.info("[leads/arbox-membership-cancelled] dispatch", {
            ...logBase,
            dispatch: "no_phone" satisfies MembershipCancelledDispatch,
          });
          continue;
        }

        logBase.contact = maskPhoneForLog(resolved.phone);

        const send = await dispatchMembershipCancelledTemplate({
          admin: input.admin,
          businessId,
          businessSlug,
          phone: resolved.phone,
          fullName: resolveReportFullName(row) ?? resolved.contact.full_name ?? null,
          userId,
          cancelledTime,
          membershipTypeName,
          endDateYmd,
          rule,
        });

        summary.processed += 1;
        if (send.dispatch === "immediate") summary.notified += 1;
        else if (send.dispatch === "deferred") summary.deferred += 1;
        else if (send.dispatch === "gated") summary.gated += 1;
        else if (send.dispatch === "send_failed") summary.errors += 1;

        console.info("[leads/arbox-membership-cancelled] dispatch", {
          ...logBase,
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
          const marked = await upsertCancellationSyncLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            userId,
            cancelledTime,
            contactId: resolved.contact.id,
            nowIso,
            status: next.status,
            attempts: next.attempts,
          });
          if (!marked.ok) summary.errors += 1;
        }
      } catch (e) {
        summary.errors += 1;
        console.error("[leads/arbox-membership-cancelled] row threw", {
          businessId,
          trigger_id: rule.id,
          user_id: userId,
          cancelled_time: cancelledTime,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  warnAbandonedCancellationSyncLog({
    businessId,
    abandoned: summary.abandoned,
    reason: "send_failed_cap",
  });

  return summary;
}
