import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { claimPendingSyncLog, logDedupBlockedSend } from "@/lib/leads/dedup-fail-closed";
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { logMessage } from "@/lib/analytics";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildCreditRefusalScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { rulesForCompanionSend, runCompanionTemplateSends } from "@/lib/same-trigger-template-order";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { parseReportEventInstant, rulesOpenForEvent } from "@/lib/rule-activation";
import {
  loadEnabledCreditRefusalTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { delayDirectionForTrigger } from "@/lib/template-trigger-types";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

/** Default per-customer throttle between credit_refusal WhatsApp notifies. */
export const CREDIT_REFUSAL_THROTTLE_DAYS = Math.max(
  1,
  Number.parseInt(String(process.env.CREDIT_REFUSAL_THROTTLE_DAYS ?? "3"), 10) || 3
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_REPORT_PAGES = 20;
const ISRAEL_TZ = "Asia/Jerusalem";

export type ArboxFailTransactionRow = {
  transaction_id: unknown;
  user_id: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  transaction_date?: unknown;
  amount?: unknown;
  last_four_digits?: unknown;
  type?: unknown;
  status?: unknown;
  item_name?: unknown;
};

export type CreditRefusalDispatch =
  | "immediate"
  | "deferred"
  | "gated"
  | "skipped"
  | "throttled"
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "send_failed";

export type CreditRefusalSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched: number;
  pages_fetched: number;
  seeded: number;
  processed: number;
  already: number;
  throttled: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  errors: number;
  fetch_error?: string;
};

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

export function isCreditRefusalFailStatus(status: unknown): boolean {
  return String(status ?? "").trim().toUpperCase() === "FAIL";
}

/**
 * transactionsReport.phone is the selling staff member's number, not the member.
 * Credit-refusal WhatsApp goes only to the customer card (`GET /v3/users/{id}`).
 */
export function resolveCreditRefusalDestinationPhone(input: {
  reportPhone: unknown;
  customerCardPhone: unknown;
}): string | null {
  void input.reportPhone;
  return normalizePhone(input.customerCardPhone);
}

export function isWithinCreditRefusalThrottle(
  lastNotifiedAtIso: string | null | undefined,
  now: Date = new Date(),
  throttleDays: number = CREDIT_REFUSAL_THROTTLE_DAYS
): boolean {
  if (!lastNotifiedAtIso) return false;
  const ts = Date.parse(lastNotifiedAtIso);
  if (!Number.isFinite(ts)) return false;
  const days = Math.max(1, Math.trunc(throttleDays) || CREDIT_REFUSAL_THROTTLE_DAYS);
  return now.getTime() - ts < days * MS_PER_DAY;
}

export function buildTransactionsReportFailPath(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  page?: number;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    location_id: input.locationId,
    status: "FAIL",
  });
  if (input.page != null && input.page > 1) qs.set("page", String(input.page));
  return `/v3/reports/transactionsReport?${qs.toString()}`;
}

function formatDateYmdIsrael(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function resolveCreditRefusalDateRange(input: {
  arboxLastSyncAt: string | null;
  now: Date;
}): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(input.now);
  let fromDate: string;
  if (input.arboxLastSyncAt) {
    const parsed = new Date(input.arboxLastSyncAt);
    if (!Number.isNaN(parsed.getTime())) {
      fromDate = formatDateYmdIsrael(parsed);
    } else {
      fromDate = formatDateYmdIsrael(new Date(input.now.getTime() - MS_PER_DAY));
    }
  } else {
    fromDate = formatDateYmdIsrael(new Date(input.now.getTime() - MS_PER_DAY));
  }
  // Clamp to ≤30 days (Arbox report span limit)
  const fromMs = Date.parse(`${fromDate}T12:00:00.000Z`);
  const toMs = Date.parse(`${toDate}T12:00:00.000Z`);
  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs - fromMs > 30 * MS_PER_DAY) {
    fromDate = formatDateYmdIsrael(new Date(toMs - 30 * MS_PER_DAY));
  }
  return { fromDate, toDate };
}

function parseTransactionId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function resolveReportFullName(row: ArboxFailTransactionRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function parseTransactionEventDate(raw: unknown): Date {
  const s = String(raw ?? "").trim();
  if (!s) return new Date();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0));
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function fetchAllFailTransactionRows(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
}): Promise<
  | { ok: true; rows: ArboxFailTransactionRow[]; pagesFetched: number }
  | { ok: false; error: string; pagesFetched: number }
> {
  const rows: ArboxFailTransactionRow[] = [];
  let pagesFetched = 0;
  let page = 1;

  while (pagesFetched < MAX_REPORT_PAGES) {
    const path = buildTransactionsReportFailPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await arboxPublicFetch(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;

    if (!res.ok) {
      console.error("[leads/arbox-credit-refusal] transactionsReport FAIL fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
        page,
      });
      return { ok: false, error: "arbox_transactions_fail_fetch_failed", pagesFetched };
    }

    const payload = res.json as {
      data?: Record<string, unknown>[];
      extra?: { pagination?: { next_page_url?: string | null } };
    } | null;
    const pageRows = Array.isArray(payload?.data) ? payload!.data! : [];
    for (const row of pageRows) {
      if (isCreditRefusalFailStatus(row.status)) {
        rows.push(row as ArboxFailTransactionRow);
      }
    }

    const next = String(payload?.extra?.pagination?.next_page_url ?? "").trim();
    if (!next) break;
    page += 1;
  }

  return { ok: true, rows, pagesFetched };
}

async function fetchArboxUserPhone(
  apiKey: string,
  userId: string
): Promise<{ ok: boolean; phone: string | null; fullName: string | null }> {
  const res = await arboxPublicFetch(`/v3/users/${encodeURIComponent(userId)}`, {
    apiKey,
    method: "GET",
  });
  if (!res.ok) {
    console.error("[leads/arbox-credit-refusal] user lookup failed", {
      user_id: userId,
      status: res.status,
      body: res.rawText.slice(0, 300),
    });
    return { ok: false, phone: null, fullName: null };
  }
  const data = (res.json as { data?: Record<string, unknown> } | null)?.data ??
    (res.json as Record<string, unknown> | null);
  if (!data || typeof data !== "object") return { ok: true, phone: null, fullName: null };
  const phone = normalizePhone((data as { phone?: unknown }).phone);
  const full =
    String((data as { full_name?: unknown }).full_name ?? "").trim() ||
    [String((data as { first_name?: unknown }).first_name ?? "").trim(), String((data as { last_name?: unknown }).last_name ?? "").trim()]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;
  return { ok: true, phone, fullName: full };
}

type ContactRow = {
  id: string;
  phone?: string | null;
  full_name?: string | null;
  arbox_user_id?: string | null;
  credit_refusal_last_notified_at?: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  apiKey: string;
  row: ArboxFailTransactionRow;
  profileCache: Map<string, { ok: boolean; phone: string | null; fullName: string | null }>;
}): Promise<{ contact: ContactRow | null; created: boolean; phone: string | null; retry?: boolean }> {
  const arboxUserId = String(input.row.user_id ?? "").trim();
  const contactSelect =
    "id, phone, full_name, arbox_user_id, credit_refusal_last_notified_at";

  let profile = input.profileCache.get(arboxUserId);
  if (!profile && arboxUserId) {
    profile = await fetchArboxUserPhone(input.apiKey, arboxUserId);
    input.profileCache.set(arboxUserId, profile);
  }
  if (profile && !profile.ok) {
    return { contact: null, created: false, phone: null, retry: true };
  }

  const phoneNorm = resolveCreditRefusalDestinationPhone({
    reportPhone: input.row.phone,
    customerCardPhone: profile?.phone ?? null,
  });
  const fullName = resolveReportFullName(input.row) ?? profile?.fullName ?? null;
  const reportPhone = normalizePhone(input.row.phone);
  if (phoneNorm && reportPhone && phoneNorm !== reportPhone) {
    console.info("[leads/arbox-credit-refusal] using customer card phone", {
      user_id: arboxUserId,
      report_phone: maskPhoneForLog(reportPhone),
      customer_phone: maskPhoneForLog(phoneNorm),
    });
  }

  let existing: ContactRow | undefined;

  if (arboxUserId && phoneNorm) {
    const { data } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", input.businessId)
      .eq("arbox_user_id", arboxUserId)
      .order("updated_at", { ascending: false })
      .limit(5);
    existing = (data as ContactRow[] | null)?.find(
      (row) => normalizePhone(row.phone) === phoneNorm
    );
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
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const linkedUserId = String(existing.arbox_user_id ?? "").trim();
    if (arboxUserId && !linkedUserId) {
      patch.arbox_user_id = arboxUserId;
    }
    if (fullName && !String(existing.full_name ?? "").trim()) patch.full_name = fullName;
    if (Object.keys(patch).length > 1) {
      await input.admin.from("contacts").update(patch).eq("id", existing.id);
    }
    return {
      contact: { ...existing, ...patch, phone: phoneNorm },
      created: false,
      phone: phoneNorm,
    };
  }

  if (!phoneNorm) return { contact: null, created: false, phone: null };

  const nowIso = new Date().toISOString();
  const { data: inserted, error } = await input.admin
    .from("contacts")
    .insert({
      business_id: input.businessId,
      phone: phoneNorm,
      full_name: fullName,
      source: "arbox_credit_refusal",
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error(
      "[leads/arbox-credit-refusal] contact insert failed:",
      error?.message ?? "no_row"
    );
    return { contact: null, created: false, phone: phoneNorm };
  }

  return { contact: inserted as ContactRow, created: true, phone: phoneNorm };
}

async function sendCreditRefusalTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  contactFullName?: string | null;
  transactionId: number;
  transactionDate: unknown;
  rule: PurchaseTemplateTriggerRule;
}): Promise<{ dispatch: CreditRefusalDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) {
    return { dispatch: "no_rule", ok: false };
  }

  if (input.rule.delay_days > 0) {
    const dueAt = computeDueAt(
      {
        delay_days: input.rule.delay_days,
        delay_direction: delayDirectionForTrigger("credit_refusal", input.rule.delay_direction),
      },
      parseTransactionEventDate(input.transactionDate)
    );
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildCreditRefusalScheduledDedupKey(
        input.businessId,
        input.rule.id,
        input.transactionId
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-credit-refusal] enqueue failed:", enqueueResult.error);
      return { dispatch: "send_failed", ok: false };
    }
    return { dispatch: "deferred", ok: true };
  }

  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) {
    return { dispatch: "gated", ok: false };
  }

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
  if (!wabaId || !approvedTpl?.id) {
    return { dispatch: "gated", ok: false };
  }

  const firstName = resolveTemplateFirstName(
    { full_name: input.contactFullName ?? null },
    input.fullName
  );
  if (!firstName && templateBodyUsesFirstNameSlot("credit_refusal", (approvedTpl as { components?: unknown }).components)) {
    console.info("[leads/arbox-credit-refusal] skip", { reason: "no_valid_name" });
    return { dispatch: "skipped", ok: false };
  }
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "credit_refusal",
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
    console.error("[leads/arbox-credit-refusal] template send failed:", sendResult.error);
    return { dispatch: templateFailureDispatch(sendResult.error), ok: false };
  }

  const sessionId = buildWaSessionId(phoneNumberId, input.phone);
  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(templateName, {
      firstName,
      components: storedComponents,
      bodyParams,
    }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: sessionId,
  });

  return { dispatch: "immediate", ok: true };
}

/**
 * Separate credit_refusal step for an Arbox business (transactionsReport status=FAIL).
 * Does not touch salesReport / purchase handling.
 */
export async function syncArboxCreditRefusalsForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  arboxLastSyncAt: string | null;
  creditRefusalSeeded: boolean;
  now?: Date;
}): Promise<CreditRefusalSyncSummary> {
  const summary: CreditRefusalSyncSummary = {
    fetched: 0,
    pages_fetched: 0,
    seeded: 0,
    processed: 0,
    already: 0,
    throttled: 0,
    notified: 0,
    deferred: 0,
    gated: 0,
    no_phone: 0,
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

  const rules = rulesForCompanionSend(
    await loadEnabledCreditRefusalTemplateTriggers(input.admin, businessId)
  );
  if (!rules.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-credit-refusal] skip — no enabled credit_refusal rule", {
      businessId,
      businessSlug,
      dispatch: "no_rule",
    });
    return summary;
  }

  const { fromDate, toDate } = resolveCreditRefusalDateRange({
    arboxLastSyncAt: input.arboxLastSyncAt,
    now,
  });

  const report = await fetchAllFailTransactionRows({
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

  if (!input.creditRefusalSeeded) {
    for (const row of report.rows) {
      const transactionId = parseTransactionId(row.transaction_id);
      if (transactionId == null) {
        summary.errors += 1;
        continue;
      }
      let error: { message: string } | null = null;
      for (const rule of rules) {
        const up = await input.admin.from("arbox_credit_refusal_sync_log").upsert(
          {
            business_id: businessId,
            trigger_id: rule.id,
            transaction_id: transactionId,
            contact_id: null,
            processed_at: nowIso,
          },
          { onConflict: "business_id,trigger_id,transaction_id" }
        );
        if (up.error) error = up.error;
      }
      if (error) {
        summary.errors += 1;
        console.error("[leads/arbox-credit-refusal] seed upsert failed:", error.message);
        continue;
      }
      summary.seeded += 1;
      console.info("[leads/arbox-credit-refusal] dispatch", {
        businessId,
        transaction_id: transactionId,
        user_id: String(row.user_id ?? ""),
        contact: null,
        dispatch: "seeded",
      });
    }

    const { error: flagErr } = await input.admin
      .from("businesses")
      .update({ arbox_credit_refusal_seeded: true })
      .eq("id", businessId);
    if (flagErr) {
      console.error("[leads/arbox-credit-refusal] seeded flag update failed:", flagErr.message);
      summary.errors += 1;
      summary.fetch_error = "credit_refusal_seeded_flag_failed";
    }

    return summary;
  }

  const profileCache = new Map<string, { ok: boolean; phone: string | null; fullName: string | null }>();

  for (const row of report.rows) {
    const transactionId = parseTransactionId(row.transaction_id);
    const userId = String(row.user_id ?? "").trim();
    if (transactionId == null || !userId) {
      summary.errors += 1;
      continue;
    }

    try {
      const { data: existingSeen, error: seenErr } = await input.admin
        .from("arbox_credit_refusal_sync_log")
        .select("trigger_id")
        .eq("business_id", businessId)
        .eq("transaction_id", transactionId)
        .in(
          "trigger_id",
          rules.map((item) => item.id)
        );
      if (seenErr) {
        logDedupBlockedSend({
          log: "[leads/arbox-credit-refusal]",
          businessId,
          reason: seenErr.message,
        });
        summary.errors += 1;
        continue;
      }
      const seenIds = new Set(
        (existingSeen ?? []).map((log) => String((log as { trigger_id?: unknown }).trigger_id ?? ""))
      );
      const pendingRules = rulesOpenForEvent(
        rules.filter((item) => item.id && !seenIds.has(item.id)),
        parseReportEventInstant(row.transaction_date)
      );
      if (!pendingRules.length) {
        summary.already += 1;
        console.info("[leads/arbox-credit-refusal] dispatch", {
          businessId,
          transaction_id: transactionId,
          user_id: userId,
          contact: null,
          dispatch: "already",
        });
        continue;
      }

      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        apiKey,
        row,
        profileCache,
      });

      if (resolved.retry) {
        summary.errors += 1;
        console.error("[leads/arbox-credit-refusal] customer card lookup failed", {
          businessId,
          transaction_id: transactionId,
          user_id: userId,
        });
        continue;
      }

      if (!resolved.phone || !resolved.contact?.id) {
        summary.no_phone += 1;
        for (const rule of pendingRules) {
          await input.admin.from("arbox_credit_refusal_sync_log").upsert(
            {
              business_id: businessId,
              trigger_id: rule.id,
              transaction_id: transactionId,
              contact_id: null,
              processed_at: nowIso,
            },
            { onConflict: "business_id,trigger_id,transaction_id" }
          );
        }
        console.info("[leads/arbox-credit-refusal] dispatch", {
          businessId,
          transaction_id: transactionId,
          user_id: userId,
          contact: null,
          dispatch: "no_phone",
        });
        continue;
      }

      const contact = resolved.contact;
      if (!contact?.id) continue;
      const contactId = String(contact.id);
      const phone = resolved.phone;

      const claimedRules: typeof pendingRules = [];
      for (const rule of pendingRules) {
        if (isArboxDailyDryRun()) {
          claimedRules.push(rule);
          continue;
        }
        const claim = await claimPendingSyncLog({
          admin: input.admin,
          table: "arbox_credit_refusal_sync_log",
          insertRow: {
            business_id: businessId,
            trigger_id: rule.id,
            transaction_id: transactionId,
            contact_id: contactId,
            processed_at: nowIso,
          },
          filters: [
            ["business_id", businessId],
            ["trigger_id", rule.id],
            ["transaction_id", transactionId],
          ],
          existingAttempts: null,
          nowIso,
        });
        if (claim === "won") {
          claimedRules.push(rule);
          continue;
        }
        logDedupBlockedSend({
          log: "[leads/arbox-credit-refusal]",
          businessId,
          triggerId: rule.id,
          reason: claim === "lost" ? "claim_lost" : "claim_failed",
        });
        if (claim === "error") summary.errors += 1;
      }
      if (!claimedRules.length) {
        summary.already += 1;
        continue;
      }

      if (isWithinCreditRefusalThrottle(contact.credit_refusal_last_notified_at, now)) {
        summary.throttled += 1;
        console.info("[leads/arbox-credit-refusal] dispatch", {
          businessId,
          transaction_id: transactionId,
          user_id: userId,
          contact: maskPhoneForLog(phone),
          dispatch: "throttled",
        });
        continue;
      }

      const sendDispatch = await runCompanionTemplateSends({
        rules: claimedRules,
        dryRun: isArboxDailyDryRun(),
        send: (rule) =>
          sendCreditRefusalTemplate({
            admin: input.admin,
            businessId,
            businessSlug,
            phone,
            fullName: resolveReportFullName(row),
            contactFullName: contact.full_name ?? null,
            transactionId,
            transactionDate: row.transaction_date,
            rule,
          }).then((send) =>
            send.dispatch === "immediate" ||
            send.dispatch === "deferred" ||
            send.dispatch === "gated" ||
            send.dispatch === "skipped" ||
            send.dispatch === "send_failed"
              ? send.dispatch
              : "skipped"
          ),
      });
      const send = { dispatch: sendDispatch, ok: sendDispatch === "immediate" || sendDispatch === "deferred" };

      summary.processed += 1;
      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "deferred") summary.deferred += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "send_failed") summary.errors += 1;

      console.info("[leads/arbox-credit-refusal] dispatch", {
        businessId,
        transaction_id: transactionId,
        user_id: userId,
        contact: maskPhoneForLog(phone),
        dispatch: send.dispatch,
      });

      if (
        send.dispatch === "skipped" ||
        (send.ok && (send.dispatch === "immediate" || send.dispatch === "deferred"))
      ) {
        const { error: throttleErr } = await input.admin
          .from("contacts")
          .update({ credit_refusal_last_notified_at: nowIso })
          .eq("id", contactId);
        if (throttleErr) {
          console.warn(
            "[leads/arbox-credit-refusal] credit_refusal_last_notified_at update failed:",
            throttleErr.message
          );
        }
      }
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-credit-refusal] row threw", {
        businessId,
        transaction_id: transactionId,
        user_id: userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return summary;
}
