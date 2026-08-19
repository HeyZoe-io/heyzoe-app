import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { logMessage } from "@/lib/analytics";
import {
  buildTemplateIncomingContactPatch,
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
  type OpeningTemplateLeadSource,
} from "@/lib/lead-template";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildArboxNewLeadScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  resolveArboxNewLeadTemplateTrigger,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

/**
 * Contact source for Arbox-native new leads.
 * Must stay in OPENING_TEMPLATE_LEAD_SOURCES so wa-status-check
 * (template no-response, source in meta_lead_ad|site_lead) includes them.
 * site_lead matches /api/leads/incoming when a rule is used — not a new source.
 */
export const ARBOX_NEW_LEAD_CONTACT_SOURCE: OpeningTemplateLeadSource = "site_lead";

const ISRAEL_TZ = "Asia/Jerusalem";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Arbox allLeadsReport: date range must not exceed 31 days (API returns 400). */
export const MAX_ALL_LEADS_REPORT_SPAN_DAYS = 30;
const MAX_REPORT_PAGES = 20;

/** Live allLeadsReport row (acrobyjoe, Aug 2026). No separate lead_id — user_id is the stable id. */
export type ArboxAllLeadsReportRow = {
  user_id: unknown;
  phone?: unknown;
  additional_phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  lead_source?: unknown;
  campaign?: unknown;
  status?: unknown;
};

export type ArboxNewLeadDispatch =
  | "immediate"
  | "deferred"
  | "gated"
  | "no_rule"
  | "seeded"
  | "already"
  | "no_phone"
  | "send_failed";

export type ArboxNewLeadSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched: number;
  pages_fetched: number;
  seeded: number;
  processed: number;
  already: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  errors: number;
  fetch_error?: string;
};

/** Arbox lead status name for prospects that have not been contacted yet. */
export const ARBOX_UNCONTACTED_LEAD_STATUS = "לא נוצר קשר";

/** Lead source name Arbox stores when Zoe created the lead from WhatsApp. */
export const ARBOX_ZOE_LEAD_SOURCE = "זואי";

export function isArboxUncontactedLeadStatus(status: unknown): boolean {
  return String(status ?? "").replace(/\s+/g, " ").trim() === ARBOX_UNCONTACTED_LEAD_STATUS;
}

export function isArboxZoeCreatedLeadSource(source: unknown): boolean {
  return String(source ?? "").trim() === ARBOX_ZOE_LEAD_SOURCE;
}

/** True when a Meta template BODY includes {{1}} (first-name param). */
export function templateComponentsUseFirstName(components: unknown): boolean {
  if (!Array.isArray(components)) return false;
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { type?: unknown; text?: unknown };
    if (String(c.type ?? "").toUpperCase() !== "BODY") continue;
    if (/\{\{\s*1\s*\}\}/.test(String(c.text ?? ""))) return true;
  }
  return false;
}

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

function parseYmdUtcMs(ymd: string): number | null {
  const parts = ymd.split("-").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  return Date.UTC(y!, m! - 1, d!);
}

/** Ensures fromDate→toDate span is within Arbox allLeadsReport limit (≤31 calendar days). */
export function clampAllLeadsReportDateRange(input: { fromDate: string; toDate: string }): {
  fromDate: string;
  toDate: string;
} {
  const fromMs = parseYmdUtcMs(input.fromDate);
  const toMs = parseYmdUtcMs(input.toDate);
  if (fromMs == null || toMs == null) return input;
  const spanDays = Math.floor((toMs - fromMs) / MS_PER_DAY);
  if (spanDays <= MAX_ALL_LEADS_REPORT_SPAN_DAYS) return input;
  const clampedFrom = new Date(toMs - MAX_ALL_LEADS_REPORT_SPAN_DAYS * MS_PER_DAY);
  return { fromDate: formatDateYmdIsrael(clampedFrom), toDate: input.toDate };
}

/** Process window: since last sync (or 1 day), clamped to 30 days. */
export function resolveAllLeadsReportDateRange(input: {
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
  return clampAllLeadsReportDateRange({ fromDate, toDate });
}

/** First-run seed window: max 30-day span so historical prospects are marked seen, not messaged. */
export function seedAllLeadsReportDateRange(now: Date): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(now);
  const fromDate = formatDateYmdIsrael(
    new Date(now.getTime() - MAX_ALL_LEADS_REPORT_SPAN_DAYS * MS_PER_DAY)
  );
  return { fromDate, toDate };
}

export function parseLeadIdFromUserId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function buildAllLeadsReportPath(input: {
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
  return `/v3/reports/allLeadsReport?${qs.toString()}`;
}

function resolveReportFullName(row: ArboxAllLeadsReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function parseCreatedEventDate(raw: unknown): Date {
  const s = String(raw ?? "").trim();
  if (!s) return new Date();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0));
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function fetchAllLeadsReportRows(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
}): Promise<
  | { ok: true; rows: ArboxAllLeadsReportRow[]; pagesFetched: number }
  | { ok: false; error: string; pagesFetched: number }
> {
  const rows: ArboxAllLeadsReportRow[] = [];
  let pagesFetched = 0;
  let page = 1;

  while (pagesFetched < MAX_REPORT_PAGES) {
    const path = buildAllLeadsReportPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await arboxPublicFetch(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;

    if (!res.ok) {
      console.error("[leads/arbox-new-lead] allLeadsReport fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
        page,
      });
      return { ok: false, error: "arbox_all_leads_report_fetch_failed", pagesFetched };
    }

    const payload = res.json as {
      data?: Record<string, unknown>[];
      extra?: { pagination?: { next_page_url?: string | null } };
    } | null;
    const pageRows = Array.isArray(payload?.data) ? payload!.data! : [];
    rows.push(...(pageRows as ArboxAllLeadsReportRow[]));

    const next = String(payload?.extra?.pagination?.next_page_url ?? "").trim();
    if (!next) break;
    page += 1;
  }

  return { ok: true, rows, pagesFetched };
}

async function fetchArboxUserPhone(
  apiKey: string,
  userId: string
): Promise<{ phone: string | null; fullName: string | null }> {
  const res = await arboxPublicFetch(`/v3/users/${encodeURIComponent(userId)}`, {
    apiKey,
    method: "GET",
  });
  if (!res.ok) {
    console.error("[leads/arbox-new-lead] user lookup failed", {
      user_id: userId,
      status: res.status,
      body: res.rawText.slice(0, 300),
    });
    return { phone: null, fullName: null };
  }
  const data =
    (res.json as { data?: Record<string, unknown> } | null)?.data ??
    (res.json as Record<string, unknown> | null);
  if (!data || typeof data !== "object") return { phone: null, fullName: null };
  const phone =
    normalizePhone((data as { phone?: unknown }).phone) ??
    normalizePhone((data as { additional_phone?: unknown }).additional_phone);
  const full =
    String((data as { full_name?: unknown }).full_name ?? "").trim() ||
    [
      String((data as { first_name?: unknown }).first_name ?? "").trim(),
      String((data as { last_name?: unknown }).last_name ?? "").trim(),
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;
  return { phone, fullName: full };
}

type ContactRow = {
  id: string;
  phone?: string | null;
  full_name?: string | null;
  arbox_user_id?: string | null;
  source?: string | null;
};

const CONTACT_SELECT = "id, phone, full_name, arbox_user_id, source";

async function findExistingContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  arboxUserId: string;
  phone: string | null;
}): Promise<ContactRow | null> {
  if (input.arboxUserId) {
    const { data } = await input.admin
      .from("contacts")
      .select(CONTACT_SELECT)
      .eq("business_id", input.businessId)
      .eq("arbox_user_id", input.arboxUserId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const row = data?.[0] as ContactRow | undefined;
    if (row?.id) return row;
  }

  if (input.phone) {
    const variants = contactPhoneLookupVariants(input.phone);
    const { data } = await input.admin
      .from("contacts")
      .select(CONTACT_SELECT)
      .eq("business_id", input.businessId)
      .in("phone", variants.length ? variants : [input.phone])
      .order("updated_at", { ascending: false })
      .limit(1);
    const row = data?.[0] as ContactRow | undefined;
    if (row?.id) return row;
  }

  return null;
}

async function resolveOrUpsertContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  apiKey: string;
  row: ArboxAllLeadsReportRow;
  nowIso: string;
}): Promise<{ contact: ContactRow | null; created: boolean; phone: string | null }> {
  const arboxUserId = String(input.row.user_id ?? "").trim();

  let phoneNorm = normalizePhone(input.row.phone) ?? normalizePhone(input.row.additional_phone);
  let fullName = resolveReportFullName(input.row);

  const existing = await findExistingContact({
    admin: input.admin,
    businessId: input.businessId,
    arboxUserId,
    phone: phoneNorm,
  });
  if (existing?.phone) phoneNorm = normalizePhone(existing.phone) ?? phoneNorm;

  if (!phoneNorm && arboxUserId) {
    const profile = await fetchArboxUserPhone(input.apiKey, arboxUserId);
    phoneNorm = profile.phone;
    if (!fullName && profile.fullName) fullName = profile.fullName;
  }

  const openingPatch = buildTemplateIncomingContactPatch(
    input.nowIso,
    ARBOX_NEW_LEAD_CONTACT_SOURCE
  );

  if (existing?.id) {
    const patch: Record<string, unknown> = {
      ...openingPatch,
    };
    if (arboxUserId) patch.arbox_user_id = arboxUserId;
    if (fullName) patch.full_name = fullName;
    const { error } = await input.admin.from("contacts").update(patch).eq("id", existing.id);
    if (error) {
      console.error("[leads/arbox-new-lead] contact update failed:", error.message);
      return { contact: null, created: false, phone: phoneNorm };
    }
    return {
      contact: {
        ...existing,
        ...patch,
        phone: existing.phone ?? phoneNorm,
        full_name: fullName ?? existing.full_name,
        arbox_user_id: arboxUserId || existing.arbox_user_id,
      },
      created: false,
      phone: normalizePhone(existing.phone) ?? phoneNorm,
    };
  }

  if (!phoneNorm) return { contact: null, created: false, phone: null };

  const { data: inserted, error } = await input.admin
    .from("contacts")
    .insert({
      business_id: input.businessId,
      phone: phoneNorm,
      full_name: fullName,
      arbox_user_id: arboxUserId || null,
      ...openingPatch,
    })
    .select(CONTACT_SELECT)
    .single();

  if (error || !inserted) {
    console.error("[leads/arbox-new-lead] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, created: false, phone: phoneNorm };
  }

  return { contact: inserted as ContactRow, created: true, phone: phoneNorm };
}

async function sendArboxNewLeadTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  leadId: number;
  createdAt: unknown;
  rule: PurchaseTemplateTriggerRule;
}): Promise<{ dispatch: ArboxNewLeadDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) {
    return { dispatch: "no_rule", ok: false };
  }

  if (input.rule.delay_days > 0) {
    const dueAt = computeDueAt(
      {
        delay_days: input.rule.delay_days,
        delay_direction: "after",
      },
      parseCreatedEventDate(input.createdAt)
    );
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildArboxNewLeadScheduledDedupKey(
        input.businessId,
        input.rule.id,
        input.leadId
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-new-lead] enqueue failed:", enqueueResult.error);
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

  const firstName = firstNameFromFullName(String(input.fullName ?? ""));
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "arbox_new_lead",
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
    console.error("[leads/arbox-new-lead] template send failed:", sendResult.error);
    return { dispatch: "send_failed", ok: false };
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

async function markArboxNewLeadSeen(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  leadId: number;
  contactId: string | null;
  nowIso: string;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_new_lead_sync_log").upsert(
    {
      business_id: input.businessId,
      lead_id: input.leadId,
      contact_id: input.contactId,
      processed_at: input.nowIso,
    },
    { onConflict: "business_id,lead_id" }
  );
  if (error) {
    console.error("[leads/arbox-new-lead] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Arbox allLeadsReport → opening template for uncontacted leads (status «לא נוצר קשר»).
 * Scheduling: same ~15-min cron-job.org job as arbox-trial-sync (separate step).
 *
 * Historical contacted/lost/converted rows are seeded (marked seen, no WhatsApp).
 * Uncontacted rows are held until the template is APPROVED, then messaged once.
 * Gated sends (pending template / no channel) do not consume the dedup log.
 *
 * IO at 10x clients: only businesses with an enabled arbox_new_lead rule call Arbox
 * (~1 GET allLeadsReport per 15 min; 30-day window until seeded, then 1–2 days).
 * Profile GET /v3/users/{id} only when the report row has no phone.
 * WhatsApp: 1 template per lead ever (dedup log after successful send).
 */
export async function syncArboxNewLeadsForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  arboxLastSyncAt: string | null;
  leadsSeeded: boolean;
  now?: Date;
}): Promise<ArboxNewLeadSyncSummary> {
  const summary: ArboxNewLeadSyncSummary = {
    fetched: 0,
    pages_fetched: 0,
    seeded: 0,
    processed: 0,
    already: 0,
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

  const rule = await resolveArboxNewLeadTemplateTrigger({
    admin: input.admin,
    businessId,
  });
  if (!rule?.template_name?.trim()) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-new-lead] skip — no enabled arbox_new_lead rule", {
      businessId,
      businessSlug,
      dispatch: "no_rule",
    });
    return summary;
  }

  const { fromDate, toDate } = input.leadsSeeded
    ? resolveAllLeadsReportDateRange({ arboxLastSyncAt: input.arboxLastSyncAt, now })
    : seedAllLeadsReportDateRange(now);

  const report = await fetchAllLeadsReportRows({
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

  if (!input.leadsSeeded) {
    for (const row of report.rows) {
      if (isArboxUncontactedLeadStatus(row.status)) continue;
      const leadId = parseLeadIdFromUserId(row.user_id);
      if (leadId == null) {
        summary.errors += 1;
        console.error("[leads/arbox-new-lead] seed skipped — missing user_id", {
          slug: businessSlug,
        });
        continue;
      }
      const marked = await markArboxNewLeadSeen({
        admin: input.admin,
        businessId,
        leadId,
        contactId: null,
        nowIso,
      });
      if (!marked.ok) {
        summary.errors += 1;
        continue;
      }
      summary.seeded += 1;
      console.info("[leads/arbox-new-lead] dispatch", {
        businessId,
        lead_id: leadId,
        user_id: String(row.user_id ?? ""),
        contact: null,
        dispatch: "seeded" satisfies ArboxNewLeadDispatch,
      });
    }
  }

  for (const row of report.rows) {
    if (!isArboxUncontactedLeadStatus(row.status)) continue;

    const leadId = parseLeadIdFromUserId(row.user_id);
    const userId = String(row.user_id ?? "").trim();
    if (leadId == null || !userId) {
      summary.errors += 1;
      continue;
    }

    try {
      const { data: existingSeen } = await input.admin
        .from("arbox_new_lead_sync_log")
        .select("lead_id")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .maybeSingle();

      if (existingSeen) {
        summary.already += 1;
        console.info("[leads/arbox-new-lead] dispatch", {
          businessId,
          lead_id: leadId,
          user_id: userId,
          contact: null,
          dispatch: "already" satisfies ArboxNewLeadDispatch,
        });
        continue;
      }

      const reportPhone =
        normalizePhone(row.phone) ?? normalizePhone(row.additional_phone);
      const existingContact = await findExistingContact({
        admin: input.admin,
        businessId,
        arboxUserId: userId,
        phone: reportPhone,
      });

      if (existingContact?.id || isArboxZoeCreatedLeadSource(row.lead_source)) {
        const marked = await markArboxNewLeadSeen({
          admin: input.admin,
          businessId,
          leadId,
          contactId: existingContact?.id ? String(existingContact.id) : null,
          nowIso,
        });
        if (!marked.ok) {
          summary.errors += 1;
          continue;
        }
        summary.already += 1;
        console.info("[leads/arbox-new-lead] dispatch", {
          businessId,
          lead_id: leadId,
          user_id: userId,
          contact: null,
          dispatch: "already" satisfies ArboxNewLeadDispatch,
          reason: "already_in_app",
        });
        continue;
      }

      let phone = reportPhone;
      let fullName = resolveReportFullName(row);
      if (!phone) {
        const profile = await fetchArboxUserPhone(apiKey, userId);
        phone = profile.phone;
        if (!fullName && profile.fullName) fullName = profile.fullName;
      }

      if (!phone) {
        summary.no_phone += 1;
        await markArboxNewLeadSeen({
          admin: input.admin,
          businessId,
          leadId,
          contactId: null,
          nowIso,
        });
        console.info("[leads/arbox-new-lead] dispatch", {
          businessId,
          lead_id: leadId,
          user_id: userId,
          contact: null,
          dispatch: "no_phone" satisfies ArboxNewLeadDispatch,
        });
        continue;
      }

      const send = await sendArboxNewLeadTemplate({
        admin: input.admin,
        businessId,
        businessSlug,
        phone,
        fullName,
        leadId,
        createdAt: row.created_at,
        rule,
      });

      if (send.dispatch === "gated" || send.dispatch === "send_failed") {
        summary.processed += 1;
        if (send.dispatch === "gated") summary.gated += 1;
        else summary.errors += 1;
        console.info("[leads/arbox-new-lead] dispatch", {
          businessId,
          lead_id: leadId,
          user_id: userId,
          lead_source: row.lead_source ?? null,
          campaign: row.campaign ?? null,
          contact: maskPhoneForLog(phone),
          dispatch: send.dispatch,
        });
        continue;
      }

      const resolved = await resolveOrUpsertContact({
        admin: input.admin,
        businessId,
        apiKey,
        row,
        nowIso,
      });
      const contactId = resolved.contact?.id ? String(resolved.contact.id) : null;

      const marked = await markArboxNewLeadSeen({
        admin: input.admin,
        businessId,
        leadId,
        contactId,
        nowIso,
      });
      if (!marked.ok) {
        summary.errors += 1;
        continue;
      }

      summary.processed += 1;
      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "deferred") summary.deferred += 1;

      console.info("[leads/arbox-new-lead] dispatch", {
        businessId,
        lead_id: leadId,
        user_id: userId,
        lead_source: row.lead_source ?? null,
        campaign: row.campaign ?? null,
        contact: maskPhoneForLog(phone),
        dispatch: send.dispatch,
      });
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-new-lead] row threw", {
        businessId,
        lead_id: leadId,
        user_id: userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!input.leadsSeeded && summary.gated === 0) {
    const { error: flagErr } = await input.admin
      .from("businesses")
      .update({ arbox_leads_seeded: true })
      .eq("id", businessId);
    if (flagErr) {
      console.error("[leads/arbox-new-lead] seeded flag update failed:", flagErr.message);
      summary.errors += 1;
      summary.fetch_error = "arbox_leads_seeded_flag_failed";
    }
  }

  return summary;
}
