/**
 * Registration confirmation when a trial class is on the calendar.
 * A trial booking is not a purchase.
 *
 * Every enabled trial_booked rule sends its template, in or out of the 24h
 * window. The free sales-flow registration text is not sent on the same
 * booking. A class that already started sends nothing.
 *
 * IO per run, only businesses with an enabled trial_booked rule:
 * 1 bookingsReport (today…+14, usually 1–2 pages) + 1 membershipTypes.
 * First pass seeds and sends nothing.
 */
import { isSendOutcomeUnknown, SEND_OUTCOME_UNKNOWN } from "@/lib/notifications/graph-whatsapp-send";
import { fetchAllArboxMembershipTypes, membershipTypeNameById } from "@/lib/arbox-membership-types";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  normalizeMembershipTypeName,
  parseClassDateYmd,
} from "@/lib/leads/arbox-trial-attended";
import { SYNC_LOG_SENTINEL_TRIGGER_ID } from "@/lib/multi-rule-dedup";
import { logMessage } from "@/lib/analytics";
import { formatLeadTemplateMessageContent, LEAD_TEMPLATE_MODEL } from "@/lib/lead-template";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { isSendsHoldError } from "@/lib/business-sends-hold";
import { buildWaSessionId, canonicalContactPhone, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import { rulesForCompanionSend } from "@/lib/same-trigger-template-order";
import {
  loadEnabledTrialBookedTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import {
  sendTrialRegisteredWhatsAppReplyIfInWindow,
  type TrialRegisteredWaReplyResult,
} from "@/lib/trial-registered-wa-reply";
import { logDedupBlockedSend } from "@/lib/leads/dedup-fail-closed";
import { rememberTrialBookingIdentities } from "@/lib/leads/arbox-trial-booking-identity";
import { prepareTrialBookingClasses } from "@/lib/leads/trial-booking-class";
import { decideActivationEventAction, markRulesSeeded, ruleIdsActiveSinceActivation } from "@/lib/rule-activation";
import { trialBookedSendsEnabled } from "@/lib/leads/trial-booked-kill-switch";
import { trialSendCapBlock } from "@/lib/leads/trial-booking-send-guard";
import { sendWithSyncLogClaim } from "@/lib/leads/sync-log-claim";
import { planTrialRegistrationSends } from "@/lib/leads/trial-registration-plan";
import { loadTrialSignupNotice, trialPurchaseTemplateBlockedByZoe } from "@/lib/trial-signup-notice";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";
import { evaluateSessionMessageSend } from "@/lib/wa-marketing-opt-out";
import { buildTrialRegisteredContactPatch } from "@/lib/trial-registered-manual";
import { autobookOccurrenceKey } from "@/lib/leads/arbox-class-autobook";

const LOG = "[leads/arbox-trial-booking-confirm]";

/** A sales-flow lead with a trial on the calendar is no longer a follow-up target. */
export function trialBookingStopsSalesFollowups(
  contact: {
    trial_registered?: boolean | null;
    session_phase?: string | null;
    sales_flow_started_at?: string | null;
  } | null
): boolean {
  if (!contact) return false;
  if (contact.trial_registered === true) return false;
  if (String(contact.session_phase ?? "").trim() === "registered") return false;
  return Boolean(String(contact.sales_flow_started_at ?? "").trim());
}

async function stopSalesFollowupsAfterTrialBooking(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  phone: string;
  now: Date;
}): Promise<void> {
  const variants = contactPhoneLookupVariants(input.phone);
  if (!variants.length) return;
  const { data, error } = await input.admin
    .from("contacts")
    .select("id, trial_registered, session_phase, sales_flow_started_at")
    .eq("business_id", input.businessId)
    .in("phone", variants)
    .limit(5);
  if (error) {
    console.error(LOG, "sales followup stop lookup failed:", error.message);
    return;
  }
  const rows = (data ?? []) as Array<{
    id?: string;
    trial_registered?: boolean | null;
    session_phase?: string | null;
    sales_flow_started_at?: string | null;
  }>;
  const row = rows.find((item) => trialBookingStopsSalesFollowups(item));
  const contactId = String(row?.id ?? "").trim();
  if (!row || !contactId) return;
  const nowIso = input.now.toISOString();
  const { error: updateErr } = await input.admin
    .from("contacts")
    .update({
      ...buildTrialRegisteredContactPatch(nowIso),
      wa_no_response_at: null,
      updated_at: nowIso,
    })
    .eq("id", contactId);
  if (updateErr) {
    console.error(LOG, "sales followup stop update failed:", updateErr.message);
    return;
  }
  console.info(LOG, "stopped sales followups after trial booking", {
    businessId: input.businessId,
  });
}

const FUTURE_DAYS = 14;
const TABLE = "arbox_trial_booking_confirm_log";

export type TrialBookingConfirmSummary = {
  skipped?: boolean;
  skip_reason?:
    | "kill_switch"
    | "not_enabled"
    | "migration_missing"
    | "missing_credentials"
    | "no_trial_scope"
    | "dedup_read_failed";
  seeded: number;
  fetched: number;
  pages_fetched: number;
  trial_rows: number;
  sent: number;
  template_sent: number;
  skipped_window: number;
  already: number;
  no_phone: number;
  abandoned: number;
  stale: number;
  errors: number;
  fetch_error?: string;
};

type LogStatus = "pending" | "seeded" | "sent" | "skipped" | "abandoned" | "no_phone" | "failed";
type PartStatus = "pending" | "sent" | "skipped" | "failed";

type LogRow = {
  trigger_id?: string;
  user_id: number;
  class_date: string;
  class_time: string;
  class_name: string;
  status: LogStatus;
  attempts: number;
  confirm_status?: PartStatus;
  template_status?: PartStatus;
};

/** The step runs only when sends are on and this business has an enabled trial_booked rule. */
export function trialBookingConfirmEnabled(hasTrialBookedRule: boolean): boolean {
  return trialBookedSendsEnabled() && hasTrialBookedRule === true;
}

/** A claim row exists. Pending / sending / unknown is already taken. Only a Meta failure is tried again. */
export function trialBookingAlreadyHandled(status: string | null | undefined): boolean {
  const value = String(status ?? "").trim();
  return Boolean(value) && !TRIAL_BOOKING_RETRYABLE.includes(value);
}

/** Class start in Asia/Jerusalem is strictly before `now`. The start minute itself still sends. */
export function trialBookingClassHasStarted(classDate: string, classTime: string, now: Date): boolean {
  const date = String(classDate ?? "").trim().slice(0, 10);
  const time = padClassHm(classTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour") === "24" ? "00" : pick("hour").padStart(2, "0");
  const nowYmd = `${pick("year")}-${pick("month")}-${pick("day")}`;
  const nowHm = `${hour}:${pick("minute").padStart(2, "0")}`;
  if (date < nowYmd) return true;
  if (date > nowYmd) return false;
  return time < nowHm;
}

function padClassHm(raw: string): string | null {
  const match = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export type TrialBookingTemplateFollowUp = "skip" | "send" | "wait";

/**
 * A calendar registration sends every configured trial_booked template.
 * The free registration text is a separate path and does not replace one.
 * Skip only when the rule has no template name, or the template is not approved yet.
 */
export function trialBookingTemplateFollowUp(input: {
  confirmStatus: "sent" | "skipped";
  freeBlocked: boolean;
  templateNameConfigured: boolean;
  templateApproved: boolean;
  templateBesidesFreeMessage?: boolean;
}): TrialBookingTemplateFollowUp {
  void input.confirmStatus;
  void input.freeBlocked;
  void input.templateBesidesFreeMessage;
  if (!input.templateNameConfigured) return "skip";
  if (!input.templateApproved) return "wait";
  return "send";
}

/** DD/MM/YYYY for the registration body («ביום …»). */
export function formatTrialBookingConfirmDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd.trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** 08:30 → 8:30. 19:00 stays. */
export function formatTrialBookingConfirmTime(raw: string): string {
  const t = raw.trim();
  const m = /^0(\d:\d{2})$/.exec(t);
  return m ? m[1]! : t;
}

/** No freeform send is possible, or it already went out another way. Do not retry every cron. */
export function trialBookingConfirmIsTerminalSkip(
  result: Extract<TrialRegisteredWaReplyResult, { sent: false }>
): boolean {
  return (
    result.reason === "outside_24h_window" ||
    result.reason === "no_user_session" ||
    result.reason === "opted_out" ||
    result.reason === "trial_template_already_sent" ||
    result.reason === "no_channel"
  );
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isMissingSchema(message: string): boolean {
  return /arbox_trial_booking_confirm|schema cache|does not exist|42703|42P01/i.test(message);
}

function parseUserId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function classTimePk(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  return t || null;
}

function classNamePk(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  return t || null;
}

function logKey(userId: number, classDate: string, classTime: string, className: string): string {
  return `${userId}|${classDate}|${classTime}|${className}`;
}

function emptySummary(): TrialBookingConfirmSummary {
  return {
    seeded: 0,
    fetched: 0,
    pages_fetched: 0,
    trial_rows: 0,
    sent: 0,
    template_sent: 0,
    skipped_window: 0,
    already: 0,
    no_phone: 0,
    abandoned: 0,
    stale: 0,
    errors: 0,
  };
}

type ApprovedTrialBookedTemplate = {
  name: string;
  language: string;
  components: unknown;
};

async function loadApprovedTrialBookedTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  rule: PurchaseTemplateTriggerRule | null;
}): Promise<ApprovedTrialBookedTemplate | null> {
  const templateName = input.rule?.template_name?.trim() || "";
  if (!templateName) return null;
  const { data } = await input.admin
    .from("whatsapp_templates")
    .select("name, language, components, status, disabled")
    .eq("business_id", input.businessId)
    .eq("name", templateName)
    .eq("status", "APPROVED")
    .eq("disabled", false)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as { name?: unknown; language?: unknown; components?: unknown };
  return {
    name: String(row.name ?? templateName),
    language: String(row.language ?? "he").trim() || "he",
    components: row.components,
  };
}

/**
 * UTILITY template for a new trial-class booking. `waiting` means the template
 * is not approved yet — leave the log pending without burning the attempt cap.
 */
async function sendTrialBookedTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string;
  className: string;
  classDate: string;
  classTime: string;
  rule: PurchaseTemplateTriggerRule;
  template: ApprovedTrialBookedTemplate;
}): Promise<"sent" | "skipped" | "waiting" | "failed" | "held" | "unknown"> {
  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return "waiting";

  const { data: bizRow } = await input.admin
    .from("businesses")
    .select("name")
    .eq("id", input.businessId)
    .maybeSingle();
  const firstName = resolveTemplateFirstName({ full_name: input.fullName }, null);
  if (
    !firstName &&
    templateBodyUsesFirstNameSlot("trial_booked", input.template.components)
  ) {
    console.info(LOG, "skip", { reason: "no_valid_name", businessSlug: input.businessSlug });
    return "skipped";
  }
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "trial_booked",
    storedComponents: input.template.components,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    className: input.className,
    classTime: formatTrialBookingConfirmTime(input.classTime),
    expiryDateYmd: input.classDate,
  });
  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName: input.template.name,
    alertTriggerId: input.rule.id,
    eventDedupKey: `trial_booked:${input.businessId}:${input.rule.id}:${input.classDate}:${encodeURIComponent(input.classTime)}#${encodeURIComponent(input.className)}`,
    languageCode: input.template.language,
    ...(sendComponents ? { components: sendComponents } : {}),
  });
  if (!sendResult.ok) {
    if (isSendsHoldError(sendResult.error)) return "held";
    console.error(LOG, "template send failed:", sendResult.error);
    return isSendOutcomeUnknown(sendResult.error) ? "unknown" : "failed";
  }
  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(input.template.name, {
      firstName,
      components: input.template.components,
      bodyParams,
    }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: buildWaSessionId(phoneNumberId, input.phone),
  });
  return "sent";
}

export async function syncTrialBookingConfirmForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  trialMembershipTypeIds?: unknown;
  businessPlan?: unknown;
  hasTrialBookedRule?: boolean;
  now?: Date;
  /** `autobookOccurrenceKey` of bookings Zoe made herself. Already confirmed at the sale. */
  autobookedOccurrenceKeys?: ReadonlySet<string>;
}): Promise<TrialBookingConfirmSummary> {
  const summary = emptySummary();
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  if (!trialBookedSendsEnabled()) {
    summary.skipped = true;
    summary.skip_reason = "kill_switch";
    console.error(LOG, "kill switch: trial_booked sends nothing", {
      business_id: Number(input.businessId),
      businessSlug,
    });
    return summary;
  }
  if (!trialBookingConfirmEnabled(input.hasTrialBookedRule === true)) {
    summary.skipped = true;
    summary.skip_reason = "not_enabled";
    return summary;
  }
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const trialTypeIds = Array.isArray(input.trialMembershipTypeIds)
    ? input.trialMembershipTypeIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!trialTypeIds.length) {
    summary.skipped = true;
    summary.skip_reason = "no_trial_scope";
    return summary;
  }

  const admin = input.admin;
  const businessId = Number(input.businessId);
  const now = input.now ?? new Date();
  const today = formatDateYmdIsrael(now);
  const toDate = addDaysYmd(today, FUTURE_DAYS);

  const { data: flagRow, error: flagErr } = await admin
    .from("businesses")
    .select("arbox_trial_booking_confirm_seeded")
    .eq("id", businessId)
    .maybeSingle();
  if (flagErr) {
    if (isMissingSchema(flagErr.message)) {
      summary.skipped = true;
      summary.skip_reason = "migration_missing";
      console.warn(LOG, "migration missing", { businessSlug });
      return summary;
    }
    summary.errors += 1;
    summary.fetch_error = flagErr.message;
    return summary;
  }
  const seeded = (flagRow as { arbox_trial_booking_confirm_seeded?: boolean } | null)
    ?.arbox_trial_booking_confirm_seeded === true;

  const names = await fetchAllArboxMembershipTypes({ apiKey, logLabel: "leads/arbox-trial-booking-confirm" });
  const trialTypeNamesNormalized = new Set<string>();
  if (names.ok) {
    const byId = membershipTypeNameById(names.types);
    for (const id of trialTypeIds) {
      const name = byId.get(id);
      if (name) trialTypeNamesNormalized.add(normalizeMembershipTypeName(name));
    }
  }
  const scope = { trialTypeIds, trialTypeNamesNormalized };

  const report = await fetchArboxBookingsReport({
    apiKey,
    fromDate: today,
    toDate,
    locationId: boxId,
  });
  summary.pages_fetched = report.pagesFetched;
  if (!report.ok) {
    summary.errors += 1;
    summary.fetch_error = report.error;
    return summary;
  }
  summary.fetched = report.rows.length;

  const trials = report.rows.flatMap((row) => {
    const userId = parseUserId(row.user_id);
    const classDate = parseClassDateYmd(row.date);
    const classTime = classTimePk(row.time);
    const className = classNamePk(row.class_name);
    if (userId == null || !classDate || !classTime || !className) return [];
    if (classDate < today || classDate > toDate) return [];
    if (!bookingMatchesTrialScope(row, scope)) return [];
    return [{ row, userId, classDate, classTime, className }];
  });
  summary.trial_rows = trials.length;

  await rememberTrialBookingIdentities(
    admin,
    businessId,
    trials.map((item) => ({
      userId: item.userId,
      classDate: item.classDate,
      classTime: item.classTime,
      className: item.className,
      membershipTypeName: String(item.row.membership_type_name ?? "").trim() || null,
    }))
  );
  try {
    await prepareTrialBookingClasses({
      admin,
      businessId,
      apiKey,
      rows: trials.map((item) => item.row),
      trialTypeIds,
      todayYmd: today,
      phase: "pre_class",
      isCandidate: () => false,
    });
  } catch (error) {
    console.error(LOG, "classification failed", {
      businessId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const { data: bizPlanRow } = await admin.from("businesses").select("plan").eq("id", businessId).maybeSingle();
  const businessPlan = (bizPlanRow as { plan?: unknown } | null)?.plan;

  const trialRules = rulesForCompanionSend(
    await loadEnabledTrialBookedTemplateTriggers(admin, businessId)
  ).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const bookingTriggerIds = [
    SYNC_LOG_SENTINEL_TRIGGER_ID,
    ...trialRules.map((rule) => rule.id).filter(Boolean),
  ];

  if (!seeded) {
    let keptFuture = false;
    for (const item of trials) {
      const sendAt = trialBookingClassHasStarted(item.classDate, item.classTime, now)
        ? null
        : new Date(now.getTime() + 60_000);
      if (decideActivationEventAction({ sendAt, now }) === "send") {
        keptFuture = true;
        continue;
      }
      for (const triggerId of bookingTriggerIds) {
      const { error } = await admin.from(TABLE).upsert(
        {
          business_id: businessId,
          trigger_id: triggerId,
          user_id: item.userId,
          class_date: item.classDate,
          class_time: item.classTime,
          class_name: item.className,
          status: "seeded",
          attempts: 0,
          confirm_status: "skipped",
          template_status: "skipped",
          channel: triggerId === SYNC_LOG_SENTINEL_TRIGGER_ID ? "free" : "template",
          processed_at: now.toISOString(),
        },
        {
          onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name,channel",
          ignoreDuplicates: true,
        }
      );
      if (error) {
        if (isMissingSchema(error.message)) {
          summary.skipped = true;
          summary.skip_reason = "migration_missing";
          return summary;
        }
        summary.errors += 1;
        continue;
      }
      summary.seeded += 1;
      }
    }
    const { error: flagUpErr } = await admin
      .from("businesses")
      .update({ arbox_trial_booking_confirm_seeded: true })
      .eq("id", businessId);
    if (flagUpErr) {
      summary.errors += 1;
      summary.fetch_error = flagUpErr.message;
    }
    console.info(LOG, "seeded future trial bookings without sending", {
      businessSlug,
      seeded: summary.seeded,
      trial_rows: summary.trial_rows,
    });
    if (!keptFuture) return summary;
  }

  const activeRuleIds = await ruleIdsActiveSinceActivation(admin, TABLE, businessId, trialRules);
  if (!activeRuleIds) {
    summary.skipped = true;
    summary.skip_reason = "dedup_read_failed";
    summary.errors += 1;
    logDedupBlockedSend({
      log: LOG,
      businessId,
      reason: "activation_read_failed",
    });
    return summary;
  }
  const freshRules = trialRules.filter((rule) => rule.id && !activeRuleIds.has(rule.id));
  if (freshRules.length) {
    const seedErrorsBefore = summary.errors;
    for (const item of trials) {
      const triggerIds = freshRules.map((rule) => rule.id);
      if (freshRules.length === trialRules.length) triggerIds.push(SYNC_LOG_SENTINEL_TRIGGER_ID);
      const sendAt = trialBookingClassHasStarted(item.classDate, item.classTime, now)
        ? null
        : new Date(now.getTime() + 60_000);
      if (decideActivationEventAction({ sendAt, now }) === "send") continue;
      for (const triggerId of triggerIds) {
        const { error } = await admin.from(TABLE).upsert(
          {
            business_id: businessId,
            trigger_id: triggerId,
            user_id: item.userId,
            class_date: item.classDate,
            class_time: item.classTime,
            class_name: item.className,
            status: "seeded",
            attempts: 0,
            confirm_status: "skipped",
            template_status: "skipped",
            channel: triggerId === SYNC_LOG_SENTINEL_TRIGGER_ID ? "free" : "template",
            processed_at: now.toISOString(),
          },
          {
            onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name,channel",
            ignoreDuplicates: true,
          }
        );
        if (error) summary.errors += 1;
        else summary.seeded += 1;
      }
    }
    for (const rule of freshRules) activeRuleIds.add(rule.id);
    if (summary.errors === seedErrorsBefore) {
      await markRulesSeeded(admin, freshRules.map((rule) => rule.id), now);
    }
  }

  const { data: existing, error: existingErr } = await admin
    .from(TABLE)
    .select(
      "trigger_id, user_id, class_date, class_time, class_name, status, attempts, confirm_status, template_status, channel"
    )
    .eq("business_id", businessId)
    .gte("class_date", today);
  if (existingErr) {
    summary.skipped = true;
    summary.skip_reason = "dedup_read_failed";
    summary.errors += 1;
    summary.fetch_error = existingErr.message;
    logDedupBlockedSend({
      log: LOG,
      businessId,
      reason: existingErr.message,
    });
    return summary;
  }
  const seen = new Map<string, LogRow[]>();
  for (const row of (existing ?? []) as LogRow[]) {
    const key = logKey(Number(row.user_id), String(row.class_date), row.class_time, row.class_name);
    const list = seen.get(key) ?? [];
    list.push(row);
    seen.set(key, list);
  }

  const { data: olderPending, error: olderErr } = await admin
    .from(TABLE)
    .select("trigger_id, user_id, class_date, class_time, class_name, status, attempts")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .lt("class_date", today);
  if (olderErr) {
    summary.skipped = true;
    summary.skip_reason = "dedup_read_failed";
    summary.errors += 1;
    summary.fetch_error = olderErr.message;
    logDedupBlockedSend({
      log: LOG,
      businessId,
      reason: olderErr.message,
    });
    return summary;
  }
  const staleKeys = new Set<string>();
  const staleCandidates = [
    ...((olderPending ?? []) as LogRow[]),
    ...[...seen.values()].flat().filter((row) => row.status === "pending"),
  ];
  for (const row of staleCandidates) {
    const classDate = String(row.class_date);
    const classTime = String(row.class_time);
    if (!trialBookingClassHasStarted(classDate, classTime, now)) continue;
    const staleItem = {
      userId: Number(row.user_id),
      classDate,
      classTime,
      className: String(row.class_name),
    };
    const staleKey = logKey(staleItem.userId, staleItem.classDate, staleItem.classTime, staleItem.className);
    if (staleKeys.has(staleKey)) continue;
    staleKeys.add(staleKey);
    console.warn(LOG, "trial booking not sent", {
      reason: "skipped_stale",
      businessSlug,
      class_date: classDate,
      class_time: classTime,
    });
    for (const triggerId of bookingTriggerIds) {
      await writeLog(
        admin,
        businessId,
        staleItem,
        triggerId,
        "skipped",
        "skipped",
        "skipped",
        Number(row.attempts) || 0,
        now
      );
    }
    summary.stale += 1;
    seen.set(
      staleKey,
      bookingTriggerIds.map((triggerId) => ({
        trigger_id: triggerId,
        user_id: staleItem.userId,
        class_date: staleItem.classDate,
        class_time: staleItem.classTime,
        class_name: staleItem.className,
        status: "skipped" as const,
        attempts: Number(row.attempts) || 0,
        confirm_status: "skipped" as const,
        template_status: "skipped" as const,
      }))
    );
  }

  const approvedByRule = new Map<string, ApprovedTrialBookedTemplate>();
  for (const rule of trialRules) {
    const approved = await loadApprovedTrialBookedTemplate({ admin, businessId, rule });
    if (approved) approvedByRule.set(rule.id, approved);
  }

  for (const item of trials) {
    const key = logKey(item.userId, item.classDate, item.classTime, item.className);
    const priorRows = seen.get(key) ?? [];
    const sentinel = priorRows.find(
      (row) => String(row.trigger_id ?? SYNC_LOG_SENTINEL_TRIGGER_ID) === SYNC_LOG_SENTINEL_TRIGGER_ID
    );
    const pendingRules = trialRules.filter((rule) => {
      if (!activeRuleIds.has(rule.id)) return false;
      const prior = priorRows.find((row) => row.trigger_id === rule.id);
      return !prior || !trialBookingAlreadyHandled(prior.status);
    });
    const sentinelSettled = Boolean(sentinel && trialBookingAlreadyHandled(sentinel.status));
    if (sentinelSettled && pendingRules.length === 0) {
      summary.already += 1;
      continue;
    }
    const attempts = sentinel?.attempts ?? 0;
    if (
      input.autobookedOccurrenceKeys?.has(autobookOccurrenceKey(item.userId, item.classDate, item.classTime))
    ) {
      console.info(LOG, "trial booking not sent", {
        reason: "autobooked_by_zoe",
        businessSlug,
        class_date: item.classDate,
        class_time: item.classTime,
      });
      for (const triggerId of bookingTriggerIds) {
        await writeLog(admin, businessId, item, triggerId, "skipped", "skipped", "skipped", attempts, now);
      }
      summary.already += 1;
      continue;
    }
    if (trialBookingClassHasStarted(item.classDate, item.classTime, now)) {
      console.warn(LOG, "trial booking not sent", {
        reason: "skipped_stale",
        businessSlug,
        class_date: item.classDate,
        class_time: item.classTime,
      });
      for (const triggerId of bookingTriggerIds) {
        await writeLog(admin, businessId, item, triggerId, "skipped", "skipped", "skipped", attempts, now);
      }
      summary.stale += 1;
      continue;
    }

    const phone = canonicalContactPhone(item.row.phone);
    if (!phone) {
      for (const triggerId of bookingTriggerIds) {
        await writeLog(admin, businessId, item, triggerId, "no_phone", "skipped", "skipped", attempts, now);
      }
      summary.no_phone += 1;
      continue;
    }

    const optedOut = await evaluateSessionMessageSend({ admin, businessId, phone });
    if (optedOut.suppress) {
      for (const triggerId of bookingTriggerIds) {
        await writeLog(admin, businessId, item, triggerId, "skipped", "skipped", "skipped", attempts, now);
      }
      continue;
    }

    await stopSalesFollowupsAfterTrialBooking({ admin, businessId, phone, now });

    const counts = await loadTrialMessageCounts({
      admin,
      businessId,
      businessSlug,
      phone,
      classDate: item.classDate,
      now,
    });
    if (!counts) {
      summary.errors += 1;
      continue;
    }

    const signupNotice = await loadTrialSignupNotice(admin, businessId, phone);
    const freeAlreadySent =
      sentinelSettled || trialPurchaseTemplateBlockedByZoe(signupNotice) || counts.free >= 1;
    const templateCoversBooking =
      pendingRules.some((rule) => Boolean(rule.template_name?.trim())) ||
      priorRows.some((row) => row.template_status === "sent");
    const sendFreeMessage =
      activeRuleIds.size > 0 &&
      planTrialRegistrationSends({
      source: "booking",
      isTrialProduct: true,
      inWindow: true,
      freeAlreadySent,
      classStarted: false,
      trialBookedRuleCount: templateCoversBooking ? Math.max(pendingRules.length, 1) : 0,
      purchaseRuleCount: 0,
    }).freeMessage;
    if (!sendFreeMessage && !sentinelSettled && templateCoversBooking) {
      await writeLog(
        admin,
        businessId,
        item,
        SYNC_LOG_SENTINEL_TRIGGER_ID,
        "skipped",
        "skipped",
        "skipped",
        attempts,
        now
      );
    }
    if (sendFreeMessage) {
      const freeBlock = trialSendCapBlock({
        channel: "free",
        sentTemplatesForRule: 0,
        sentFreeForContact: counts.free,
        trialRelatedLast24h: counts.last24h,
      });
      if (freeBlock) {
        logDedupBlockedSend({
          log: LOG,
          businessId,
          triggerId: SYNC_LOG_SENTINEL_TRIGGER_ID,
          reason: freeBlock,
        });
      } else {
        const freeKey = trialBookingClaimKey(businessId, item, SYNC_LOG_SENTINEL_TRIGGER_ID, "free", attempts, now);
        const freeSend = await sendWithSyncLogClaim<
          Awaited<ReturnType<typeof sendTrialRegisteredWhatsAppReplyIfInWindow>>
        >({
          admin,
          ...freeKey,
          retryable: TRIAL_BOOKING_RETRYABLE,
          send: async () => {
            const waResult = await sendTrialRegisteredWhatsAppReplyIfInWindow({
              admin,
              businessId,
              businessSlug,
              phone,
              instagramFollowPromptSent: await loadInstagramFollowPromptSent(admin, businessId, phone),
              businessPlan,
              bookingSchedule: {
                date: item.classDate,
                time: item.classTime,
                serviceName: item.className,
              },
            });
            if (waResult.sent) {
              return { settle: "sent" as const, value: waResult, row: { confirm_status: "sent", template_status: "skipped" } };
            }
            if (waResult.reason === "sends_hold") return { settle: "release" as const, value: waResult };
            if (waResult.reason === "send_unknown") {
              return {
                settle: "unknown" as const,
                reason: SEND_OUTCOME_UNKNOWN,
                value: waResult,
                row: { confirm_status: "failed", template_status: "skipped" },
              };
            }
            const terminal = trialBookingConfirmIsTerminalSkip(waResult);
            return {
              settle: terminal ? ("skipped" as const) : ("failed" as const),
              reason: String(waResult.reason ?? "send_failed"),
              value: waResult,
              row: { confirm_status: terminal ? "skipped" : "failed", template_status: "skipped" },
            };
          },
        });
        if (freeSend.claim === "won" && freeSend.value) {
          if (freeSend.value.sent) {
            summary.sent += 1;
            counts.free += 1;
            counts.last24h += 1;
          } else if (freeSend.value.reason !== "sends_hold") {
            if (freeSend.value.reason === "outside_24h_window") summary.skipped_window += 1;
            summary.errors += 1;
          }
        } else if (freeSend.claim !== "won") {
          logDedupBlockedSend({
            log: LOG,
            businessId,
            triggerId: SYNC_LOG_SENTINEL_TRIGGER_ID,
            reason: freeSend.claim === "lost" ? "claim_lost" : "claim_failed",
          });
        }
      }
    }

    for (const rule of pendingRules) {
      const approved = approvedByRule.get(rule.id) ?? null;
      if (!rule.template_name?.trim() || !approved) {
        if (!rule.template_name?.trim()) {
          await writeLog(admin, businessId, item, rule.id, "skipped", "skipped", "skipped", attempts, now);
        }
        continue;
      }
      const templateBlock = trialSendCapBlock({
        channel: "template",
        sentTemplatesForRule: 0,
        sentFreeForContact: counts.free,
        trialRelatedLast24h: counts.last24h,
      });
      if (templateBlock) {
        logDedupBlockedSend({
          log: LOG,
          businessId,
          triggerId: rule.id,
          reason: templateBlock,
        });
        continue;
      }
      const prior = priorRows.find((row) => row.trigger_id === rule.id);
      const templateKey = trialBookingClaimKey(
        businessId,
        item,
        rule.id,
        "template",
        Number(prior?.attempts) || 0,
        now
      );
      const templateSend = await sendWithSyncLogClaim({
        admin,
        ...templateKey,
        retryable: TRIAL_BOOKING_RETRYABLE,
        send: async () => {
          const outcome = await sendTrialBookedTemplate({
            admin,
            businessId,
            businessSlug,
            phone,
            fullName: String(item.row.full_name ?? ""),
            className: item.className,
            classDate: item.classDate,
            classTime: item.classTime,
            rule,
            template: approved,
          });
          if (outcome === "sent") {
            return { settle: "sent" as const, value: outcome, row: { confirm_status: "skipped", template_status: "sent" } };
          }
          if (outcome === "held") return { settle: "release" as const, value: outcome };
          if (outcome === "skipped") {
            return {
              settle: "skipped" as const,
              reason: "no_valid_name",
              value: outcome,
              row: { confirm_status: "skipped", template_status: "skipped" },
            };
          }
          if (outcome === "unknown") {
            return {
              settle: "unknown" as const,
              reason: SEND_OUTCOME_UNKNOWN,
              value: outcome,
              row: { confirm_status: "skipped", template_status: "failed" },
            };
          }
          if (outcome === "waiting") {
            return {
              settle: "skipped" as const,
              reason: "no_channel",
              value: outcome,
              row: { confirm_status: "skipped", template_status: "skipped" },
            };
          }
          return {
            settle: "failed" as const,
            reason: "send_failed",
            value: outcome,
            row: { confirm_status: "skipped", template_status: "failed" },
          };
        },
      });
      if (templateSend.claim !== "won") {
        logDedupBlockedSend({
          log: LOG,
          businessId,
          triggerId: rule.id,
          reason: templateSend.claim === "lost" ? "claim_lost" : "claim_failed",
        });
        continue;
      }
      if (templateSend.value === "sent") {
        summary.template_sent += 1;
        counts.last24h += 1;
      } else if (templateSend.value === "failed" || templateSend.value === "unknown") {
        summary.errors += 1;
      }
    }
  }

  return summary;
}



/** A Meta error is retried up to the attempt cap. Unknown, skipped and sent are final. */
export const TRIAL_BOOKING_RETRYABLE: readonly string[] = ["failed"];

/** One booking, one rule, one channel. Same primary key as the confirm log. */
export function trialBookingClaimKey(
  businessId: number,
  item: { userId: number; classDate: string; classTime: string; className: string },
  triggerId: string,
  channel: "free" | "template",
  attempts: number,
  now: Date
): { table: string; row: Record<string, unknown>; filters: Array<[string, string | number]> } {
  return {
    table: TABLE,
    row: {
      business_id: businessId,
      trigger_id: triggerId,
      user_id: item.userId,
      class_date: item.classDate,
      class_time: item.classTime,
      class_name: item.className,
      attempts,
      confirm_status: "pending",
      template_status: "pending",
      channel,
      processed_at: now.toISOString(),
    },
    filters: [
      ["business_id", businessId],
      ["trigger_id", triggerId],
      ["user_id", item.userId],
      ["class_date", item.classDate],
      ["class_time", item.classTime],
      ["class_name", item.className],
      ["channel", channel],
    ],
  };
}

async function loadTrialMessageCounts(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  classDate: string;
  now: Date;
}): Promise<{ free: number; last24h: number } | null> {
  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  const sessionId = phoneNumberId ? buildWaSessionId(phoneNumberId, input.phone) : "";
  if (!sessionId) return { free: 0, last24h: 0 };
  const since = new Date(input.now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const dateLabel = formatTrialBookingConfirmDate(input.classDate);
  const { data, error } = await input.admin
    .from("messages")
    .select("model_used, content, created_at")
    .eq("business_slug", input.businessSlug)
    .eq("session_id", sessionId)
    .in("model_used", ["sales_flow_after_trial_registered", "lead_template"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    logDedupBlockedSend({
      log: LOG,
      businessId: input.businessId,
      reason: error.message,
    });
    return null;
  }
  let free = 0;
  let last24h = 0;
  for (const row of data ?? []) {
    const model = String((row as { model_used?: unknown }).model_used ?? "");
    const content = String((row as { content?: unknown }).content ?? "");
    const created = String((row as { created_at?: unknown }).created_at ?? "");
    const trialRelated =
      model === "sales_flow_after_trial_registered" ||
      (model === "lead_template" && (content.includes(dateLabel) || content.includes("איזה כיף")));
    if (model === "sales_flow_after_trial_registered") free += 1;
    if (trialRelated && created >= since) last24h += 1;
  }
  return { free, last24h };
}

async function loadInstagramFollowPromptSent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  phone: string
): Promise<boolean> {
  const variants = contactPhoneLookupVariants(phone);
  if (!variants.length) return false;
  const { data } = await admin
    .from("contacts")
    .select("instagram_follow_prompt_sent")
    .eq("business_id", businessId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();
  return (data as { instagram_follow_prompt_sent?: boolean } | null)?.instagram_follow_prompt_sent === true;
}

async function writeLog(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  item: { userId: number; classDate: string; classTime: string; className: string },
  triggerId: string,
  status: LogStatus,
  confirmStatus: PartStatus,
  templateStatus: PartStatus,
  attempts: number,
  now: Date
): Promise<boolean> {
  const { error } = await admin.from(TABLE).upsert(
    {
      business_id: businessId,
      trigger_id: triggerId,
      user_id: item.userId,
      class_date: item.classDate,
      class_time: item.classTime,
      class_name: item.className,
      status,
      attempts,
      confirm_status: confirmStatus,
      template_status: templateStatus,
      channel: triggerId === SYNC_LOG_SENTINEL_TRIGGER_ID ? "free" : "template",
      processed_at: now.toISOString(),
    },
    {
      onConflict: "business_id,trigger_id,user_id,class_date,class_time,class_name,channel",
    }
  );
  if (error) {
    logDedupBlockedSend({
      log: LOG,
      businessId,
      triggerId,
      reason: error.message,
    });
    return false;
  }
  return true;
}
