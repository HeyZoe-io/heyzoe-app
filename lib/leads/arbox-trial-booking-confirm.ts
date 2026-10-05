/**
 * Registration confirmation when a trial class is on the calendar.
 * A trial booking is not a purchase.
 *
 * Runs only for an enabled trial_booked rule.
 * Inside the 24h customer-service window: the sales-flow "after registration"
 * chat message, and no template. Outside that window: the rule's template,
 * or nothing if it has no template / is not approved yet.
 * Never both. If the purchase path already sent the free message, this step
 * sends nothing (purchase wins, one free message per contact).
 *
 * IO per run, only businesses with an enabled trial_booked rule:
 * 1 bookingsReport (today…+14, usually 1–2 pages) + 1 membershipTypes.
 * First pass seeds and sends nothing.
 */
import { fetchAllArboxMembershipTypes, membershipTypeNameById } from "@/lib/arbox-membership-types";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  normalizeMembershipTypeName,
  parseClassDateYmd,
} from "@/lib/leads/arbox-trial-attended";
import { logMessage } from "@/lib/analytics";
import { formatLeadTemplateMessageContent, LEAD_TEMPLATE_MODEL } from "@/lib/lead-template";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, canonicalContactPhone, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import {
  resolveTrialBookedTemplateTrigger,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import {
  sendTrialRegisteredWhatsAppReplyIfInWindow,
  type TrialRegisteredWaReplyResult,
} from "@/lib/trial-registered-wa-reply";
import {
  loadTrialSignupNotice,
  trialPurchaseTemplateBlockedByZoe,
} from "@/lib/trial-signup-notice";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";
import { evaluateSessionMessageSend } from "@/lib/wa-marketing-opt-out";

const LOG = "[leads/arbox-trial-booking-confirm]";
const FUTURE_DAYS = 14;
const ATTEMPT_CAP = 3;
const TABLE = "arbox_trial_booking_confirm_log";

export type TrialBookingConfirmSummary = {
  skipped?: boolean;
  skip_reason?: "not_enabled" | "migration_missing" | "missing_credentials" | "no_trial_scope";
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
  errors: number;
  fetch_error?: string;
};

type LogStatus = "pending" | "seeded" | "sent" | "skipped" | "abandoned" | "no_phone";
type PartStatus = "pending" | "sent" | "skipped";

type LogRow = {
  user_id: number;
  class_date: string;
  class_time: string;
  class_name: string;
  status: LogStatus;
  attempts: number;
  confirm_status?: PartStatus;
  template_status?: PartStatus;
};

/**
 * In-window channel after the free body is resolved.
 * A real body stays the free message. An empty body uses the approved template,
 * or nothing when that template is missing.
 */
export function trialBookingInWindowChannel(input: {
  resolvedBodyEmpty: boolean;
  templateApproved: boolean;
}): "free" | "template" | "nothing" {
  if (!input.resolvedBodyEmpty) return "free";
  if (input.templateApproved) return "template";
  return "nothing";
}

/** The step runs only when this business has an enabled trial_booked rule. */
export function trialBookingConfirmEnabled(hasTrialBookedRule: boolean): boolean {
  return hasTrialBookedRule === true;
}

/** Settled log rows are not sent again. Only `pending` is retried. */
export function trialBookingAlreadyHandled(status: string | null | undefined): boolean {
  return Boolean(status) && status !== "pending";
}

export type TrialBookingTemplateFollowUp = "skip" | "send" | "wait";

/**
 * After the free-message attempt has settled.
 * A sent or blocked free message never gets a template.
 * Outside the window: send the template, wait if it is not approved, or skip
 * when the rule has no template name.
 */
export function trialBookingTemplateFollowUp(input: {
  confirmStatus: "sent" | "skipped";
  freeBlocked: boolean;
  templateNameConfigured: boolean;
  templateApproved: boolean;
}): TrialBookingTemplateFollowUp {
  if (input.confirmStatus === "sent" || input.freeBlocked) return "skip";
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

/** Table exists from the first SQL, before confirm_status / template_status were added. */
function isMissingPartColumns(message: string): boolean {
  return /confirm_status|template_status/i.test(message) && isMissingSchema(message);
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
}): Promise<"sent" | "skipped" | "waiting" | "failed"> {
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
    languageCode: input.template.language,
    ...(sendComponents ? { components: sendComponents } : {}),
  });
  if (!sendResult.ok) {
    console.error(LOG, "template send failed:", sendResult.error);
    return "failed";
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
}): Promise<TrialBookingConfirmSummary> {
  const summary = emptySummary();
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
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

  if (!seeded) {
    for (const item of trials) {
      const { error } = await admin.from(TABLE).upsert(
        {
          business_id: businessId,
          user_id: item.userId,
          class_date: item.classDate,
          class_time: item.classTime,
          class_name: item.className,
          status: "seeded",
          attempts: 0,
          processed_at: now.toISOString(),
        },
        {
          onConflict: "business_id,user_id,class_date,class_time,class_name",
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
    return summary;
  }

  const fullSelect =
    "user_id, class_date, class_time, class_name, status, attempts, confirm_status, template_status";
  const legacySelect = "user_id, class_date, class_time, class_name, status, attempts";
  let legacyLog = false;
  let existing: LogRow[] | null = null;
  let existingErr: { message: string } | null = null;
  const fullRes = await admin
    .from(TABLE)
    .select(fullSelect)
    .eq("business_id", businessId)
    .gte("class_date", today);
  if (fullRes.error && isMissingPartColumns(fullRes.error.message)) {
    legacyLog = true;
    const legacyRes = await admin
      .from(TABLE)
      .select(legacySelect)
      .eq("business_id", businessId)
      .gte("class_date", today);
    existing = (legacyRes.data ?? null) as LogRow[] | null;
    existingErr = legacyRes.error;
  } else {
    existing = (fullRes.data ?? null) as LogRow[] | null;
    existingErr = fullRes.error;
  }
  if (existingErr) {
    if (isMissingSchema(existingErr.message)) {
      summary.skipped = true;
      summary.skip_reason = "migration_missing";
      return summary;
    }
    summary.errors += 1;
    summary.fetch_error = existingErr.message;
    return summary;
  }
  const seen = new Map<string, LogRow>();
  for (const row of (existing ?? []) as LogRow[]) {
    seen.set(logKey(Number(row.user_id), String(row.class_date), row.class_time, row.class_name), row);
  }

  const trialBookedRule = await resolveTrialBookedTemplateTrigger({ admin, businessId });
  const approvedTemplate = await loadApprovedTrialBookedTemplate({
    admin,
    businessId,
    rule: trialBookedRule,
  });
  const templateNameConfigured = Boolean(trialBookedRule?.template_name?.trim());

  for (const item of trials) {
    const key = logKey(item.userId, item.classDate, item.classTime, item.className);
    const prior = seen.get(key);
    if (prior && trialBookingAlreadyHandled(prior.status)) {
      summary.already += 1;
      continue;
    }
    const attempts = prior?.attempts ?? 0;
    if (attempts >= ATTEMPT_CAP) {
      summary.abandoned += 1;
      continue;
    }

    const phone = canonicalContactPhone(item.row.phone);
    if (!phone) {
      await writeLog(admin, businessId, item, "no_phone", "skipped", "skipped", attempts, now, legacyLog);
      summary.no_phone += 1;
      continue;
    }

    if (!prior) {
      const claimRow: Record<string, unknown> = {
        business_id: businessId,
        user_id: item.userId,
        class_date: item.classDate,
        class_time: item.classTime,
        class_name: item.className,
        status: "pending",
        attempts: 0,
        processed_at: now.toISOString(),
      };
      if (!legacyLog) {
        claimRow.confirm_status = "pending";
        claimRow.template_status = "pending";
      }
      const { error: claimErr } = await admin.from(TABLE).insert(claimRow);
      if (claimErr) {
        if (claimErr.code === "23505") {
          summary.already += 1;
          continue;
        }
        summary.errors += 1;
        continue;
      }
    }

    let confirmStatus: PartStatus = prior?.confirm_status === "sent" || prior?.confirm_status === "skipped"
      ? prior.confirm_status
      : "pending";
    let templateStatus: PartStatus = prior?.template_status === "sent" || prior?.template_status === "skipped"
      ? prior.template_status
      : "pending";
    let failed = false;

    const optedOut = await evaluateSessionMessageSend({ admin, businessId, phone });
    if (optedOut.suppress) {
      confirmStatus = confirmStatus === "sent" ? "sent" : "skipped";
      templateStatus = templateStatus === "sent" ? "sent" : "skipped";
    }

    if (confirmStatus === "sent") templateStatus = "skipped";

    let freeBlocked = false;
    let emptyBody = false;
    if (confirmStatus === "pending") {
      const priorNotice = await loadTrialSignupNotice(admin, businessId, phone);
      if (trialPurchaseTemplateBlockedByZoe(priorNotice)) {
        confirmStatus = "skipped";
        templateStatus = "skipped";
      }
    }

    if (confirmStatus === "pending") {
      const instagramFollowPromptSent = await instagramAlreadySent(admin, businessId, phone);
      const result = await sendTrialRegisteredWhatsAppReplyIfInWindow({
        admin,
        businessId,
        businessSlug,
        phone,
        instagramFollowPromptSent,
        businessPlan: input.businessPlan,
        bookingSchedule: {
          date: formatTrialBookingConfirmDate(item.classDate),
          time: formatTrialBookingConfirmTime(item.classTime),
          serviceName: item.className,
        },
        declineEmptyBody: true,
      });
      if (result.sent) {
        confirmStatus = "sent";
        templateStatus = "skipped";
        summary.sent += 1;
      } else if (result.reason === "opted_out" || result.reason === "trial_template_already_sent") {
        confirmStatus = "skipped";
        templateStatus = "skipped";
        freeBlocked = true;
      } else if (result.reason === "empty_body") {
        confirmStatus = "skipped";
        emptyBody = true;
      } else if (trialBookingConfirmIsTerminalSkip(result)) {
        confirmStatus = "skipped";
        summary.skipped_window += 1;
      } else {
        failed = true;
      }
    }

    if (templateStatus === "pending" && (confirmStatus === "sent" || confirmStatus === "skipped")) {
      const followUp = trialBookingTemplateFollowUp({
        confirmStatus,
        freeBlocked,
        templateNameConfigured,
        templateApproved: Boolean(approvedTemplate),
      });
      if (emptyBody && followUp !== "send") {
        const channel = trialBookingInWindowChannel({
          resolvedBodyEmpty: true,
          templateApproved: Boolean(approvedTemplate),
        });
        console.warn(LOG, "trial booking not sent", {
          reason: "empty_registration_body",
          businessSlug,
          template: templateNameConfigured ? "not_approved" : "none",
          channel,
        });
      }
      if (followUp === "skip" || (emptyBody && !templateNameConfigured)) {
        templateStatus = "skipped";
      } else if (followUp === "wait" || !approvedTemplate || !trialBookedRule) {
        // Named template is not approved yet. Retry next cron without burning attempts.
      } else {
        const outcome = await sendTrialBookedTemplate({
          admin,
          businessId,
          businessSlug,
          phone,
          fullName: String(item.row.full_name ?? ""),
          className: item.className,
          classDate: item.classDate,
          classTime: item.classTime,
          rule: trialBookedRule,
          template: approvedTemplate,
        });
        if (outcome === "sent") {
          templateStatus = "sent";
          summary.template_sent += 1;
        } else if (outcome === "skipped") {
          templateStatus = "skipped";
        } else if (outcome === "failed") {
          failed = true;
        }
      }
    }

    const settled = confirmStatus !== "pending" && templateStatus !== "pending";
    let status: LogStatus = "pending";
    let nextAttempts = attempts;
    if (settled) {
      status = confirmStatus === "sent" || templateStatus === "sent" ? "sent" : "skipped";
    } else if (failed) {
      nextAttempts = attempts + 1;
      status = nextAttempts >= ATTEMPT_CAP ? "abandoned" : "pending";
    }
    await writeLog(
      admin,
      businessId,
      item,
      status,
      confirmStatus,
      templateStatus,
      nextAttempts,
      now,
      legacyLog
    );
    if (status === "abandoned") summary.abandoned += 1;
    else if (failed) summary.errors += 1;
  }

  return summary;
}

async function instagramAlreadySent(
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
    .limit(1);
  const row = (data ?? [])[0] as { instagram_follow_prompt_sent?: boolean } | undefined;
  return row?.instagram_follow_prompt_sent === true;
}

async function writeLog(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  item: { userId: number; classDate: string; classTime: string; className: string },
  status: LogStatus,
  confirmStatus: PartStatus,
  templateStatus: PartStatus,
  attempts: number,
  now: Date,
  legacy = false
): Promise<void> {
  const base = {
    business_id: businessId,
    user_id: item.userId,
    class_date: item.classDate,
    class_time: item.classTime,
    class_name: item.className,
    status,
    attempts,
    processed_at: now.toISOString(),
  };
  const row = legacy
    ? base
    : { ...base, confirm_status: confirmStatus, template_status: templateStatus };
  let { error } = await admin.from(TABLE).upsert(row, {
    onConflict: "business_id,user_id,class_date,class_time,class_name",
  });
  if (error && isMissingPartColumns(error.message)) {
    const retry = await admin.from(TABLE).upsert(base, {
      onConflict: "business_id,user_id,class_date,class_time,class_name",
    });
    error = retry.error;
  }
  if (error) console.error(LOG, "log upsert failed", error.message);
}
