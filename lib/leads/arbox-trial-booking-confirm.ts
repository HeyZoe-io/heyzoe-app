/**
 * Registration confirmation when a trial class is on the calendar and there is
 * no sale. Studio Tights books trials (Arbox label trialClassTitle) and takes
 * payment outside Arbox, so the sale-based confirm never fires.
 *
 * IO per trial-sync run, tights only: 1 bookingsReport (today…+14, usually 1–2
 * pages) + 1 membershipTypes. No extra calls for other businesses. First pass
 * seeds and sends nothing. Later passes, per new booking: the in-window
 * registration text, and the purchase template that matches a trial product
 * (works outside the 24h window too). The day-before trial_reminder still applies.
 */
import { logMessage } from "@/lib/analytics";
import { fetchAllArboxMembershipTypes, membershipTypeNameById } from "@/lib/arbox-membership-types";
import { formatLeadTemplateMessageContent, LEAD_TEMPLATE_MODEL } from "@/lib/lead-template";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  normalizeMembershipTypeName,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, canonicalContactPhone, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { computeDueAt, enqueueScheduledTemplateSend } from "@/lib/scheduled-template-sends";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import { resolvePurchaseTemplateTriggerForSale } from "@/lib/template-triggers-match";
import { stampTrialSignupNotice } from "@/lib/trial-signup-notice";
import {
  sendTrialRegisteredWhatsAppReplyIfInWindow,
  type TrialRegisteredWaReplyResult,
} from "@/lib/trial-registered-wa-reply";
import { delayDirectionForTrigger } from "@/lib/trigger-catalog";
import { evaluateSessionMessageSend } from "@/lib/wa-marketing-opt-out";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const LOG = "[leads/arbox-trial-booking-confirm]";
const CONFIRM_SLUGS = new Set(["tights"]);
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

export function trialBookingConfirmEnabled(slug: string): boolean {
  return CONFIRM_SLUGS.has(String(slug ?? "").trim().toLowerCase());
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
    errors: 0,
  };
}

export async function syncTrialBookingConfirmForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  trialMembershipTypeIds?: unknown;
  businessPlan?: unknown;
  now?: Date;
}): Promise<TrialBookingConfirmSummary> {
  const summary = emptySummary();
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  if (!trialBookingConfirmEnabled(businessSlug)) {
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

  const { data: existing, error: existingErr } = await admin
    .from(TABLE)
    .select(
      "user_id, class_date, class_time, class_name, status, attempts, confirm_status, template_status"
    )
    .eq("business_id", businessId)
    .gte("class_date", today);
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

  for (const item of trials) {
    const key = logKey(item.userId, item.classDate, item.classTime, item.className);
    const prior = seen.get(key);
    if (prior && prior.status !== "pending") {
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
      await writeLog(admin, businessId, item, "no_phone", "skipped", "skipped", attempts, now);
      summary.no_phone += 1;
      continue;
    }

    if (!prior) {
      const { error: claimErr } = await admin.from(TABLE).insert({
        business_id: businessId,
        user_id: item.userId,
        class_date: item.classDate,
        class_time: item.classTime,
        class_name: item.className,
        status: "pending",
        confirm_status: "pending",
        template_status: "pending",
        attempts: 0,
        processed_at: now.toISOString(),
      });
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
      });
      if (result.sent) {
        confirmStatus = "sent";
        summary.sent += 1;
      } else if (trialBookingConfirmIsTerminalSkip(result)) {
        confirmStatus = "skipped";
        summary.skipped_window += 1;
      } else {
        failed = true;
      }
    }

    if (templateStatus === "pending" && !optedOut.suppress) {
      const templateResult = await sendTrialBookingPurchaseTemplate({
        admin,
        businessId,
        businessSlug,
        phone,
        fullName: bookingFullName(item.row),
        trialTypeIds,
        userId: item.userId,
        classDate: item.classDate,
        classTime: item.classTime,
        className: item.className,
        now,
      });
      if (templateResult === "sent") {
        templateStatus = "sent";
        summary.template_sent += 1;
        if (confirmStatus !== "sent") {
          await stampTrialSignupNotice(admin, businessId, phone, "template");
        }
      } else if (templateResult === "skipped") {
        templateStatus = "skipped";
      } else {
        failed = true;
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
    await writeLog(admin, businessId, item, status, confirmStatus, templateStatus, nextAttempts, now);
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

function bookingFullName(row: ArboxBookingReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

type TemplateSendOutcome = "sent" | "skipped" | "failed";

/** Purchase template whose rule includes the studio's trial products. Sends outside the 24h window. */
async function sendTrialBookingPurchaseTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  trialTypeIds: number[];
  userId: number;
  classDate: string;
  classTime: string;
  className: string;
  now: Date;
}): Promise<TemplateSendOutcome> {
  const trialId = input.trialTypeIds[0] ?? null;
  const rule = await resolvePurchaseTemplateTriggerForSale({
    admin: input.admin,
    businessId: input.businessId,
    membershipTypeId: trialId,
    match: { trialMembershipTypeIds: input.trialTypeIds },
  });
  const templateName = rule?.template_name?.trim() || "";
  if (!rule || !templateName) return "skipped";

  if (rule.delay_days > 0) {
    const dueAt = computeDueAt(
      {
        delay_days: rule.delay_days,
        delay_direction: delayDirectionForTrigger("purchase", rule.delay_direction),
      },
      input.now
    );
    const enqueued = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: `trial_booking:${input.businessId}:${rule.id}:${input.userId}:${input.classDate}:${input.classTime}`,
    });
    return enqueued.ok ? "sent" : "failed";
  }

  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return "skipped";

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
  if (!wabaId || !approvedTpl?.id) return "skipped";

  const firstName = resolveTemplateFirstName(null, input.fullName);
  if (
    !firstName &&
    templateBodyUsesFirstNameSlot("purchase", (approvedTpl as { components?: unknown }).components)
  ) {
    console.info(LOG, "template skip", { reason: "no_valid_name", businessSlug: input.businessSlug });
    return "skipped";
  }

  const languageCode = String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "purchase",
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
    console.error(LOG, "template send failed", sendResult.error);
    return "failed";
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
  return "sent";
}

async function writeLog(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  item: { userId: number; classDate: string; classTime: string; className: string },
  status: LogStatus,
  confirmStatus: PartStatus,
  templateStatus: PartStatus,
  attempts: number,
  now: Date
): Promise<void> {
  const { error } = await admin.from(TABLE).upsert(
    {
      business_id: businessId,
      user_id: item.userId,
      class_date: item.classDate,
      class_time: item.classTime,
      class_name: item.className,
      status,
      confirm_status: confirmStatus,
      template_status: templateStatus,
      attempts,
      processed_at: now.toISOString(),
    },
    { onConflict: "business_id,user_id,class_date,class_time,class_name" }
  );
  if (error) console.error(LOG, "log upsert failed", error.message);
}
