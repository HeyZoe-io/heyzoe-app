import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import {
  arboxFlagYes,
  endDateToUtcNoon,
  formatDateYmdIsrael,
  isMembershipEndDateInPast,
  isMembershipExpiringPastDue,
  MEMBERSHIP_EXPIRING_PAST_DUE_GRACE_MS,
  parseEndDateYmd,
} from "@/lib/leads/arbox-membership-expiring";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildSessionsExpiringScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  resolveSessionsExpiringTemplateTrigger,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Same grace as membership_expiring. */
export const SESSIONS_EXPIRING_PAST_DUE_GRACE_MS = MEMBERSHIP_EXPIRING_PAST_DUE_GRACE_MS;
/** Arbox report date range must not exceed 31 days. */
const MAX_REPORT_SPAN_DAYS = 30;
const MAX_REPORT_PAGES = 20;

/**
 * Live expiringSessionsReport row (acrobyjoe, Aug 2026).
 * No membership_user_id / session_user_id / has_another_session_pack.
 * end_date may be null — those rows are skipped (cannot schedule).
 */
export type ArboxExpiringSessionRow = {
  user_id: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  membership_type_name?: unknown;
  sessions_left?: unknown;
  count_session?: unknown;
  cancelled?: unknown;
  has_another_session?: unknown;
  has_another_plan?: unknown;
  /** Not present in live API; kept as optional alias. */
  has_another_session_pack?: unknown;
};

export type SessionsExpiringDispatch =
  | "enqueued"
  | "immediate"
  | "gated"
  | "dedup"
  | "skipped_renewed"
  | "skipped_cancelled"
  | "skipped_past_due"
  | "skipped_expired_end"
  | "skipped_no_end_date"
  | "skipped_outside_horizon"
  | "no_rule"
  | "no_phone"
  | "send_failed";

export type SessionsExpiringSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched: number;
  pages_fetched: number;
  processed: number;
  dedup: number;
  notified: number;
  deferred: number;
  gated: number;
  skipped_renewed: number;
  skipped_cancelled: number;
  skipped_past_due: number;
  skipped_expired_end: number;
  skipped_no_end_date: number;
  skipped_outside_horizon: number;
  no_phone: number;
  errors: number;
  fetch_error?: string;
};

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

/** Fetch window: today → today+30 (Arbox max span). Dates are required; API does not filter by end_date. */
export function expiringSessionsReportFetchWindow(
  now: Date = new Date()
): { fromDate: string; toDate: string } {
  const fromDate = formatDateYmdIsrael(now);
  const [y, m, d] = fromDate.split("-").map((n) => Number(n));
  const fromUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const toUtc = new Date(fromUtc.getTime() + MAX_REPORT_SPAN_DAYS * MS_PER_DAY);
  const yy = toUtc.getUTCFullYear();
  const mm = String(toUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(toUtc.getUTCDate()).padStart(2, "0");
  return { fromDate, toDate: `${yy}-${mm}-${dd}` };
}

export function buildExpiringSessionsReportPath(input: {
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
  return `/v3/reports/expiringSessionsReport?${qs.toString()}`;
}

export function rowHasSessionRenewal(row: ArboxExpiringSessionRow): boolean {
  return (
    arboxFlagYes(row.has_another_session) ||
    arboxFlagYes(row.has_another_plan) ||
    arboxFlagYes(row.has_another_session_pack)
  );
}

/**
 * due_at from rule relative to pack end_date.
 * Default direction for this trigger is `before` (dashboard default).
 */
export function computeSessionsExpiringDueAt(
  endDateYmd: string,
  rule: { delay_days: number; delay_direction?: string }
): Date {
  const direction = String(rule.delay_direction ?? "before").trim().toLowerCase() || "before";
  return computeDueAt(
    { delay_days: rule.delay_days, delay_direction: direction },
    endDateToUtcNoon(endDateYmd)
  );
}

/** Client-side horizon: only packs whose end_date falls in [today, today+30]. */
export function isSessionsEndDateWithinHorizon(
  endDateYmd: string,
  window: { fromDate: string; toDate: string }
): boolean {
  return endDateYmd >= window.fromDate && endDateYmd <= window.toDate;
}

async function fetchExpiringSessionRows(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
}): Promise<
  | { ok: true; rows: ArboxExpiringSessionRow[]; pagesFetched: number }
  | { ok: false; error: string; pagesFetched: number }
> {
  const rows: ArboxExpiringSessionRow[] = [];
  let pagesFetched = 0;
  let page = 1;

  while (pagesFetched < MAX_REPORT_PAGES) {
    const path = buildExpiringSessionsReportPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await arboxPublicFetch(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;
    if (!res.ok) {
      console.error("[leads/arbox-sessions-expiring] report fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
        page,
      });
      return { ok: false, error: "arbox_expiring_sessions_fetch_failed", pagesFetched };
    }
    const payload = res.json as {
      data?: Record<string, unknown>[];
      extra?: { pagination?: { next_page_url?: string | null } };
    } | null;
    const pageRows = Array.isArray(payload?.data) ? payload!.data! : [];
    rows.push(...(pageRows as ArboxExpiringSessionRow[]));
    const next = String(payload?.extra?.pagination?.next_page_url ?? "").trim();
    if (!next) break;
    page += 1;
  }

  return { ok: true, rows, pagesFetched };
}

function resolveReportFullName(row: ArboxExpiringSessionRow): string | null {
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
  row: ArboxExpiringSessionRow;
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
      source: "arbox_sessions_expiring",
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error(
      "[leads/arbox-sessions-expiring] contact insert failed:",
      error?.message ?? "no_row"
    );
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

function dueAtIsTodayIsrael(dueAt: Date, now: Date): boolean {
  return formatDateYmdIsrael(dueAt) === formatDateYmdIsrael(now);
}

async function dispatchSessionsExpiringTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  userId: number;
  startDateYmd: string;
  endDateYmd: string;
  dueAt: Date;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: SessionsExpiringDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const delayDays = Math.max(0, Math.trunc(Number(input.rule.delay_days) || 0));
  const sendImmediate = delayDays === 0 && dueAtIsTodayIsrael(input.dueAt, input.now);

  if (!sendImmediate) {
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt: input.dueAt,
      dedupKey: buildSessionsExpiringScheduledDedupKey(
        input.businessId,
        input.rule.id,
        input.userId,
        input.startDateYmd,
        input.endDateYmd
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-sessions-expiring] enqueue failed:", enqueueResult.error);
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
    triggerType: "sessions_expiring",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
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
    console.error("[leads/arbox-sessions-expiring] template send failed:", sendResult.error);
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
 * Daily sessions_expiring step for one Arbox business (punch-card / session pack).
 * Report requires fromDate/toDate (max 31 days) but does NOT filter by end_date —
 * client filters end_date into [today, today+30], skips null end_date / renewed / cancelled.
 */
export async function syncArboxSessionsExpiringForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  now?: Date;
}): Promise<SessionsExpiringSyncSummary> {
  const summary: SessionsExpiringSyncSummary = {
    fetched: 0,
    pages_fetched: 0,
    processed: 0,
    dedup: 0,
    notified: 0,
    deferred: 0,
    gated: 0,
    skipped_renewed: 0,
    skipped_cancelled: 0,
    skipped_past_due: 0,
    skipped_expired_end: 0,
    skipped_no_end_date: 0,
    skipped_outside_horizon: 0,
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

  const rule = await resolveSessionsExpiringTemplateTrigger({ admin: input.admin, businessId });
  if (!rule?.template_name?.trim()) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-sessions-expiring] skip — no enabled sessions_expiring rule", {
      businessId,
      businessSlug,
      dispatch: "no_rule",
    });
    return summary;
  }

  const window = expiringSessionsReportFetchWindow(now);
  const report = await fetchExpiringSessionRows({
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

  for (const row of report.rows) {
    const userIdRaw = Number(row.user_id);
    if (!Number.isFinite(userIdRaw) || userIdRaw <= 0) {
      summary.errors += 1;
      continue;
    }
    const userId = Math.trunc(userIdRaw);
    const startDateYmd = parseEndDateYmd(row.start_date);
    const endDateYmd = parseEndDateYmd(row.end_date);

    const logBase = {
      businessId,
      user_id: userId,
      start_date: startDateYmd,
      end_date: endDateYmd,
      sessions_left: row.sessions_left ?? null,
      due_at: null as string | null,
      contact: null as string | null,
    };

    if (!endDateYmd) {
      summary.skipped_no_end_date += 1;
      console.info("[leads/arbox-sessions-expiring] dispatch", {
        ...logBase,
        dispatch: "skipped_no_end_date",
      });
      continue;
    }
    if (!startDateYmd) {
      summary.errors += 1;
      continue;
    }

    if (rowHasSessionRenewal(row)) {
      summary.skipped_renewed += 1;
      console.info("[leads/arbox-sessions-expiring] dispatch", {
        ...logBase,
        dispatch: "skipped_renewed",
      });
      continue;
    }

    if (arboxFlagYes(row.cancelled)) {
      summary.skipped_cancelled += 1;
      console.info("[leads/arbox-sessions-expiring] dispatch", {
        ...logBase,
        dispatch: "skipped_cancelled",
      });
      continue;
    }

    if (isMembershipEndDateInPast(endDateYmd, now)) {
      summary.skipped_expired_end += 1;
      console.info("[leads/arbox-sessions-expiring] dispatch", {
        ...logBase,
        dispatch: "skipped_expired_end",
      });
      continue;
    }

    if (!isSessionsEndDateWithinHorizon(endDateYmd, window)) {
      summary.skipped_outside_horizon += 1;
      console.info("[leads/arbox-sessions-expiring] dispatch", {
        ...logBase,
        dispatch: "skipped_outside_horizon",
      });
      continue;
    }

    const dueAt = computeSessionsExpiringDueAt(endDateYmd, rule);
    logBase.due_at = dueAt.toISOString();

    if (isMembershipExpiringPastDue(dueAt, now, SESSIONS_EXPIRING_PAST_DUE_GRACE_MS)) {
      summary.skipped_past_due += 1;
      console.info("[leads/arbox-sessions-expiring] dispatch", {
        ...logBase,
        dispatch: "skipped_past_due",
      });
      continue;
    }

    try {
      const { data: existingSeen } = await input.admin
        .from("arbox_sessions_expiring_sync_log")
        .select("user_id")
        .eq("business_id", businessId)
        .eq("user_id", userId)
        .eq("start_date", startDateYmd)
        .eq("end_date", endDateYmd)
        .maybeSingle();

      if (existingSeen) {
        summary.dedup += 1;
        console.info("[leads/arbox-sessions-expiring] dispatch", {
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
        console.info("[leads/arbox-sessions-expiring] dispatch", {
          ...logBase,
          dispatch: "no_phone",
        });
        continue;
      }

      logBase.contact = maskPhoneForLog(resolved.phone);

      const send = await dispatchSessionsExpiringTemplate({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: resolved.phone,
        fullName: resolveReportFullName(row) ?? resolved.contact.full_name ?? null,
        userId,
        startDateYmd,
        endDateYmd,
        dueAt,
        rule,
        now,
      });

      summary.processed += 1;
      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "enqueued") summary.deferred += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "send_failed") summary.errors += 1;

      console.info("[leads/arbox-sessions-expiring] dispatch", {
        ...logBase,
        dispatch: send.dispatch,
      });

      if (send.ok && (send.dispatch === "immediate" || send.dispatch === "enqueued")) {
        const { error: logErr } = await input.admin.from("arbox_sessions_expiring_sync_log").upsert(
          {
            business_id: businessId,
            user_id: userId,
            start_date: startDateYmd,
            end_date: endDateYmd,
            contact_id: resolved.contact.id,
            processed_at: now.toISOString(),
          },
          { onConflict: "business_id,user_id,start_date,end_date" }
        );
        if (logErr) {
          console.error(
            "[leads/arbox-sessions-expiring] sync_log upsert failed:",
            logErr.message
          );
          summary.errors += 1;
        }
      }
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-sessions-expiring] row threw", {
        businessId,
        user_id: userId,
        start_date: startDateYmd,
        end_date: endDateYmd,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return summary;
}
