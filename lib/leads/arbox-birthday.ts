import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  leadTemplateUsesFirstName,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildBirthdayScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  resolveBirthdayTemplateTrigger,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const ISRAEL_TZ = "Asia/Jerusalem";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_REPORT_PAGES = 20;

export type ArboxBirthdayReportRow = {
  user_id: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  birthday?: unknown;
};

export type BirthdayDispatch =
  | "immediate"
  | "deferred"
  | "gated"
  | "dedup"
  | "no_rule"
  | "no_phone"
  | "not_due"
  | "send_failed";

export type BirthdaySyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  fetched: number;
  pages_fetched: number;
  due_today: number;
  processed: number;
  dedup: number;
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

export function formatDateYmdIsrael(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function celebrationYearIsrael(now: Date = new Date()): number {
  return Number(formatDateYmdIsrael(now).slice(0, 4));
}

/** Parse Arbox birthday (YYYY-MM-DD or MM-DD) → month/day. */
export function parseBirthdayMonthDay(raw: unknown): { month: number; day: number } | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const month = m.length === 4 ? Number(m[2]) : Number(m[1]);
  const day = m.length === 4 ? Number(m[3]) : Number(m[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { month, day };
}

/**
 * Calendar date of this year's birthday occurrence (Israel YMD parts).
 * Uses the celebration year from `now`.
 */
export function birthdayOccurrenceYmdThisYear(
  birthdayRaw: unknown,
  now: Date = new Date()
): string | null {
  const md = parseBirthdayMonthDay(birthdayRaw);
  if (!md) return null;
  const year = celebrationYearIsrael(now);
  const mm = String(md.month).padStart(2, "0");
  const dd = String(md.day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function ymdFromUtcNoon(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Trigger send date for a birthday + rule.
 * after → birthdayOccurrence + delay_days; before → birthdayOccurrence - delay_days.
 * Tries celebration year ±1 so year-boundary before/after delays still match today.
 */
export function computeBirthdayTriggerDateYmd(
  birthdayRaw: unknown,
  rule: { delay_days: number; delay_direction: string },
  now: Date = new Date()
): string | null {
  const md = parseBirthdayMonthDay(birthdayRaw);
  if (!md) return null;
  const todayYmd = formatDateYmdIsrael(now);
  const year = celebrationYearIsrael(now);
  const mm = String(md.month).padStart(2, "0");
  const dd = String(md.day).padStart(2, "0");

  let fallback: string | null = null;
  for (const y of [year - 1, year, year + 1]) {
    const occurrence = `${y}-${mm}-${dd}`;
    const [oy, om, od] = occurrence.split("-").map((n) => Number(n));
    const base = new Date(Date.UTC(oy!, om! - 1, od!, 12, 0, 0));
    const due = computeDueAt(
      {
        delay_days: rule.delay_days,
        delay_direction: rule.delay_direction,
      },
      base
    );
    const triggerYmd = ymdFromUtcNoon(due);
    if (triggerYmd === todayYmd) return triggerYmd;
    if (y === year) fallback = triggerYmd;
  }
  return fallback;
}

export function isBirthdayTriggerDueToday(
  birthdayRaw: unknown,
  rule: { delay_days: number; delay_direction: string },
  now: Date = new Date()
): boolean {
  const triggerYmd = computeBirthdayTriggerDateYmd(birthdayRaw, rule, now);
  if (!triggerYmd) return false;
  return triggerYmd === formatDateYmdIsrael(now);
}

/**
 * Which birthday calendar day(s) to fetch so that rows due today (given the rule) are included.
 * after N → fetch the day that was N days ago; before N → fetch the day N days ahead; 0 → today.
 */
export function birthdayReportFetchWindowForRule(
  rule: { delay_days: number; delay_direction: string },
  now: Date = new Date()
): { fromDate: string; toDate: string } {
  const todayYmd = formatDateYmdIsrael(now);
  const [y, m, d] = todayYmd.split("-").map((n) => Number(n));
  const todayUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const days = Math.max(0, Math.trunc(Number(rule.delay_days) || 0));
  const direction = String(rule.delay_direction ?? "after").trim().toLowerCase();
  // after: birthday was `days` ago; before: birthday is `days` ahead
  const offsetMs = (direction === "before" ? days : -days) * MS_PER_DAY;
  const target = new Date(todayUtc.getTime() + offsetMs);
  const yy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  const ymd = `${yy}-${mm}-${dd}`;
  return { fromDate: ymd, toDate: ymd };
}

export function buildBirthdayReportPath(input: {
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
  return `/v3/reports/birthdayReport?${qs.toString()}`;
}

async function fetchBirthdayReportRows(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
}): Promise<
  | { ok: true; rows: ArboxBirthdayReportRow[]; pagesFetched: number }
  | { ok: false; error: string; pagesFetched: number }
> {
  const rows: ArboxBirthdayReportRow[] = [];
  let pagesFetched = 0;
  let page = 1;

  while (pagesFetched < MAX_REPORT_PAGES) {
    const path = buildBirthdayReportPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await arboxPublicFetch(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;
    if (!res.ok) {
      console.error("[leads/arbox-birthday] birthdayReport fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
        page,
      });
      return { ok: false, error: "arbox_birthday_report_fetch_failed", pagesFetched };
    }
    const payload = res.json as {
      data?: Record<string, unknown>[];
      extra?: { pagination?: { next_page_url?: string | null } };
    } | null;
    const pageRows = Array.isArray(payload?.data) ? payload!.data! : [];
    rows.push(...(pageRows as ArboxBirthdayReportRow[]));
    const next = String(payload?.extra?.pagination?.next_page_url ?? "").trim();
    if (!next) break;
    page += 1;
  }

  return { ok: true, rows, pagesFetched };
}

function resolveReportFullName(row: ArboxBirthdayReportRow): string | null {
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
  row: ArboxBirthdayReportRow;
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
      source: "arbox_birthday",
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();

  if (error || !inserted) {
    console.error("[leads/arbox-birthday] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function sendBirthdayTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  userId: number;
  birthdayYear: number;
  birthdayRaw: unknown;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: BirthdayDispatch; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  if (input.rule.delay_days > 0) {
    const triggerYmd = computeBirthdayTriggerDateYmd(input.birthdayRaw, input.rule, input.now);
    const dueAt = triggerYmd
      ? new Date(`${triggerYmd}T12:00:00.000Z`)
      : computeDueAt(
          { delay_days: input.rule.delay_days, delay_direction: input.rule.delay_direction },
          input.now
        );
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildBirthdayScheduledDedupKey(
        input.businessId,
        input.rule.id,
        input.userId,
        input.birthdayYear
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-birthday] enqueue failed:", enqueueResult.error);
      return { dispatch: "send_failed", ok: false };
    }
    return { dispatch: "deferred", ok: true };
  }

  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return { dispatch: "gated", ok: false };

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language")
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

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(leadTemplateUsesFirstName(templateName)
      ? {
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: firstName }],
            },
          ],
        }
      : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-birthday] template send failed:", sendResult.error);
    return { dispatch: "send_failed", ok: false };
  }

  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(templateName, { firstName }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: buildWaSessionId(phoneNumberId, input.phone),
  });

  return { dispatch: "immediate", ok: true };
}

/**
 * Daily birthday step for one Arbox business.
 * birthdayReport supports fromDate/toDate — we fetch the single calendar day that maps to "due today" for the rule.
 */
export async function syncArboxBirthdaysForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  now?: Date;
}): Promise<BirthdaySyncSummary> {
  const summary: BirthdaySyncSummary = {
    fetched: 0,
    pages_fetched: 0,
    due_today: 0,
    processed: 0,
    dedup: 0,
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
  const birthdayYear = celebrationYearIsrael(now);

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const rule = await resolveBirthdayTemplateTrigger({ admin: input.admin, businessId });
  if (!rule?.template_name?.trim()) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    console.info("[leads/arbox-birthday] skip — no enabled birthday rule", {
      businessId,
      businessSlug,
      dispatch: "no_rule",
    });
    return summary;
  }

  const window = birthdayReportFetchWindowForRule(rule, now);
  const report = await fetchBirthdayReportRows({
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

    if (!isBirthdayTriggerDueToday(row.birthday, rule, now)) {
      console.info("[leads/arbox-birthday] dispatch", {
        businessId,
        user_id: userId,
        contact: null,
        dispatch: "not_due",
      });
      continue;
    }
    summary.due_today += 1;

    try {
      const { data: existingSeen } = await input.admin
        .from("arbox_birthday_sync_log")
        .select("user_id")
        .eq("business_id", businessId)
        .eq("user_id", userId)
        .eq("birthday_year", birthdayYear)
        .maybeSingle();

      if (existingSeen) {
        summary.dedup += 1;
        console.info("[leads/arbox-birthday] dispatch", {
          businessId,
          user_id: userId,
          contact: null,
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
        console.info("[leads/arbox-birthday] dispatch", {
          businessId,
          user_id: userId,
          contact: null,
          dispatch: "no_phone",
        });
        continue;
      }

      const send = await sendBirthdayTemplate({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: resolved.phone,
        fullName: resolveReportFullName(row) ?? resolved.contact.full_name ?? null,
        userId,
        birthdayYear,
        birthdayRaw: row.birthday,
        rule,
        now,
      });

      summary.processed += 1;
      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "deferred") summary.deferred += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "send_failed") summary.errors += 1;

      console.info("[leads/arbox-birthday] dispatch", {
        businessId,
        user_id: userId,
        contact: maskPhoneForLog(resolved.phone),
        dispatch: send.dispatch,
      });

      if (send.ok && (send.dispatch === "immediate" || send.dispatch === "deferred")) {
        const { error: logErr } = await input.admin.from("arbox_birthday_sync_log").upsert(
          {
            business_id: businessId,
            user_id: userId,
            birthday_year: birthdayYear,
            contact_id: resolved.contact.id,
            processed_at: now.toISOString(),
          },
          { onConflict: "business_id,user_id,birthday_year" }
        );
        if (logErr) {
          console.error("[leads/arbox-birthday] sync_log upsert failed:", logErr.message);
          summary.errors += 1;
        }
      }
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-birthday] row threw", {
        businessId,
        user_id: userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return summary;
}
