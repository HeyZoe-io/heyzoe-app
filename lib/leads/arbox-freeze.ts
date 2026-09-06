/**
 * Freeze cluster: A8 freeze_created + C14 freeze_ending_unbooked + C15 freeze_ending_booked.
 * Shared membersOnHoldReport; future bookings split for ending (cron prefetch when
 * freeze ending needs it — not shared with attendance_gap).
 */
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import {
  nextCancellationSyncLogAfterDispatch,
  parseCancellationSyncAttempts,
  type CancellationSyncLogStatus,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import {
  fetchArboxMembersOnHoldReport,
  type ArboxMembersOnHoldRow,
} from "@/lib/leads/arbox-members-on-hold-report";
import {
  ATTENDANCE_GAP_FUTURE_SPAN_DAYS,
  attendanceGapFutureWindow,
} from "@/lib/leads/arbox-attendance-gap";
import {
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  parseClassDateYmd,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildFreezeCreatedScheduledDedupKey,
  buildFreezeEndingScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledFreezeCreatedTemplateTriggers,
  loadEnabledFreezeEndingBookedTemplateTriggers,
  loadEnabledFreezeEndingUnbookedTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HOLD_LOOKBACK_PAST_DAYS = 7;

export type FreezeEndingVariant = "booked" | "unbooked";

export type FreezeSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  lookback_from?: string;
  lookback_to?: string;
  future_from?: string;
  future_to?: string;
  fetched_holds: number;
  fetched_future: number;
  pages_fetched: number;
  created_seeded: number;
  ending_seeded: number;
  soft_seeded: number;
  created_processed: number;
  ending_processed: number;
  already: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  abandoned: number;
  skipped_ended: number;
  errors: number;
  fetch_error?: string;
};

export function addDaysYmd(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  const next = new Date(base + Math.trunc(days) * MS_PER_DAY);
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function parseHoldId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function parseHoldUserId(row: ArboxMembersOnHoldRow): number | null {
  return parseHoldId(row.user_id) ?? parseHoldId(row.membership_user_id);
}

/** Report may return ended holds — ending triggers require end strictly after today. */
export function isHoldEndInFuture(endYmd: string, todayYmd: string): boolean {
  return endYmd > todayYmd;
}

/**
 * Ending reminder due when today is within delay_days before end (and end is still future).
 * delay_days=3, end=2026-09-10 → due from 2026-09-07 through 2026-09-09.
 */
export function isFreezeEndingDue(input: {
  endYmd: string;
  delayDays: number;
  todayYmd: string;
}): boolean {
  if (!isHoldEndInFuture(input.endYmd, input.todayYmd)) return false;
  const days = Math.max(0, Math.trunc(input.delayDays));
  const notifyFrom = addDaysYmd(input.endYmd, -days);
  if (!notifyFrom) return false;
  return input.todayYmd >= notifyFrom;
}

export function freezeReportFetchWindow(input: {
  now: Date;
  maxEndingDelayDays: number;
}): { fromDate: string; toDate: string } {
  const today = formatDateYmdIsrael(input.now);
  const [y, m, d] = today.split("-").map((n) => Number(n));
  const todayUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const pastDays = HOLD_LOOKBACK_PAST_DAYS;
  const futureDays = Math.min(
    29 - pastDays,
    Math.max(ATTENDANCE_GAP_FUTURE_SPAN_DAYS, Math.trunc(input.maxEndingDelayDays) || 0)
  );
  const fromUtc = new Date(todayUtc.getTime() - pastDays * MS_PER_DAY);
  const toUtc = new Date(todayUtc.getTime() + futureDays * MS_PER_DAY);
  const fmt = (dt: Date) => {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };
  return { fromDate: fmt(fromUtc), toDate: fmt(toUtc) };
}

export function futureBookingUserIds(
  futureRows: readonly ArboxBookingReportRow[],
  todayYmd: string
): Map<number, { className: string | null }> {
  const out = new Map<number, { className: string | null; nextDate: string }>();
  for (const row of futureRows) {
    const userId = parseHoldId(row.user_id);
    const classDateYmd = parseClassDateYmd(row.date);
    if (userId == null || !classDateYmd || classDateYmd <= todayYmd) continue;
    const prev = out.get(userId);
    if (!prev || classDateYmd < prev.nextDate) {
      out.set(userId, {
        className: String(row.class_name ?? "").trim() || null,
        nextDate: classDateYmd,
      });
    }
  }
  const slim = new Map<number, { className: string | null }>();
  for (const [id, v] of out) slim.set(id, { className: v.className });
  return slim;
}

export function endingVariantForUser(
  userId: number,
  futureByUser: Map<number, { className: string | null }>
): FreezeEndingVariant {
  return futureByUser.has(userId) ? "booked" : "unbooked";
}

/**
 * Soft-seed after the business flag is true: empty created/ending tables need a
 * no-WhatsApp pass (or sentinel) so enabling a second freeze type does not blast.
 */
export function freezeTablesNeedingSoftSeed(input: {
  freezeSeeded: boolean;
  createdRuleEnabled: boolean;
  endingRuleEnabled: boolean;
  createdLogCount: number;
  endingLogCount: number;
}): { softSeedCreated: boolean; softSeedEnding: boolean } {
  if (!input.freezeSeeded) {
    return { softSeedCreated: false, softSeedEnding: false };
  }
  return {
    softSeedCreated: input.createdRuleEnabled && input.createdLogCount === 0,
    softSeedEnding: input.endingRuleEnabled && input.endingLogCount === 0,
  };
}

/**
 * True when any freeze rule is enabled with a template (daily cron step / future GET).
 */
export async function businessNeedsFreezeSync(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<{ needsFreeze: boolean; needsEndingFuture: boolean }> {
  const { data, error } = await admin
    .from("template_triggers")
    .select("trigger_type, template_name")
    .eq("business_id", businessId)
    .eq("enabled", true)
    .in("trigger_type", [
      "freeze_created",
      "freeze_ending_booked",
      "freeze_ending_unbooked",
    ])
    .limit(20);
  if (error) {
    console.error("[leads/arbox-freeze] needs-sync lookup failed:", error.message);
    return { needsFreeze: true, needsEndingFuture: true };
  }
  const live = (data ?? []).filter((r) =>
    String((r as { template_name?: unknown }).template_name ?? "").trim()
  );
  const needsEndingFuture = live.some((r) => {
    const t = String((r as { trigger_type?: unknown }).trigger_type ?? "");
    return t === "freeze_ending_booked" || t === "freeze_ending_unbooked";
  });
  return { needsFreeze: live.length > 0, needsEndingFuture };
}

function resolveHoldFullName(row: ArboxMembersOnHoldRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

function pickNewestRule(rules: PurchaseTemplateTriggerRule[]): PurchaseTemplateTriggerRule | null {
  const withTpl = rules
    .filter((r) => r.template_name?.trim())
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  return withTpl[0] ?? null;
}

type ContactRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  arbox_user_id: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxMembersOnHoldRow;
  userId: number | null;
  source: string;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const contactSelect = "id, phone, full_name, arbox_user_id";
  const arboxUserId = input.userId != null ? String(input.userId) : "";
  let phoneNorm = normalizePhone(input.row.phone);
  const fullName = resolveHoldFullName(input.row);

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
      source: input.source,
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();
  if (error || !inserted) {
    console.error("[leads/arbox-freeze] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertCreatedLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  holdId: number;
  userId: number | null;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
}): Promise<boolean> {
  const { error } = await input.admin.from("arbox_freeze_created_sync_log").upsert(
    {
      business_id: input.businessId,
      membership_hold_id: input.holdId,
      user_id: input.userId,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    { onConflict: "business_id,membership_hold_id" }
  );
  if (error) {
    console.error("[leads/arbox-freeze] created sync_log upsert failed:", error.message);
    return false;
  }
  return true;
}

async function upsertEndingLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  holdId: number;
  endYmd: string;
  variant: FreezeEndingVariant;
  userId: number | null;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
}): Promise<boolean> {
  const { error } = await input.admin.from("arbox_freeze_ending_sync_log").upsert(
    {
      business_id: input.businessId,
      membership_hold_id: input.holdId,
      end_suspend_ymd: input.endYmd,
      variant: input.variant,
      user_id: input.userId,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    { onConflict: "business_id,membership_hold_id,end_suspend_ymd" }
  );
  if (error) {
    console.error("[leads/arbox-freeze] ending sync_log upsert failed:", error.message);
    return false;
  }
  return true;
}

async function dispatchFreezeTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  startYmd: string | null;
  endYmd: string | null;
  className: string | null;
  triggerType: string;
  rule: PurchaseTemplateTriggerRule;
  dedupKey: string;
  now: Date;
}): Promise<{ dispatch: "immediate" | "deferred" | "gated" | "send_failed" | "no_rule"; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const dueAt = computeDueAt({ delay_days: 0, delay_direction: "after" }, input.now);
  if (dueAt.getTime() > input.now.getTime() + 15_000) {
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: input.dedupKey,
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-freeze] enqueue failed:", enqueueResult.error);
      return { dispatch: "send_failed", ok: false };
    }
    return { dispatch: "deferred", ok: true };
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
    triggerType: input.triggerType,
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    className: input.className,
    startDateYmd: input.startYmd,
    expiryDateYmd: input.endYmd,
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-freeze] template send failed:", sendResult.error);
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

function mapDispatch(d: string): "immediate" | "deferred" | "gated" | "send_failed" {
  if (d === "immediate") return "immediate";
  if (d === "deferred") return "deferred";
  if (d === "gated") return "gated";
  return "send_failed";
}

export async function syncArboxFreezeForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  freezeSeeded: boolean;
  now?: Date;
  prefetchedFutureRows?: ArboxBookingReportRow[];
  prefetchedFuturePages?: number;
}): Promise<FreezeSyncSummary> {
  const summary: FreezeSyncSummary = {
    fetched_holds: 0,
    fetched_future: 0,
    pages_fetched: 0,
    created_seeded: 0,
    ending_seeded: 0,
    soft_seeded: 0,
    created_processed: 0,
    ending_processed: 0,
    already: 0,
    notified: 0,
    deferred: 0,
    gated: 0,
    no_phone: 0,
    abandoned: 0,
    skipped_ended: 0,
    errors: 0,
  };

  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const todayYmd = formatDateYmdIsrael(now);

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const [createdRules, endingBookedRules, endingUnbookedRules] = await Promise.all([
    loadEnabledFreezeCreatedTemplateTriggers(input.admin, businessId),
    loadEnabledFreezeEndingBookedTemplateTriggers(input.admin, businessId),
    loadEnabledFreezeEndingUnbookedTemplateTriggers(input.admin, businessId),
  ]);
  const createdRule = pickNewestRule(createdRules);
  const endingBookedRule = pickNewestRule(endingBookedRules);
  const endingUnbookedRule = pickNewestRule(endingUnbookedRules);
  if (!createdRule && !endingBookedRule && !endingUnbookedRule) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  const maxEndingDelay = Math.max(
    endingBookedRule ? Math.max(0, Math.trunc(Number(endingBookedRule.delay_days) || 0)) : 0,
    endingUnbookedRule ? Math.max(0, Math.trunc(Number(endingUnbookedRule.delay_days) || 0)) : 0
  );
  const needsEnding = Boolean(endingBookedRule || endingUnbookedRule);

  const holdWindow = freezeReportFetchWindow({ now, maxEndingDelayDays: maxEndingDelay || 14 });
  summary.lookback_from = holdWindow.fromDate;
  summary.lookback_to = holdWindow.toDate;

  const holdReport = await fetchArboxMembersOnHoldReport({
    apiKey,
    fromDate: holdWindow.fromDate,
    toDate: holdWindow.toDate,
    locationId: boxId,
  });
  summary.pages_fetched = holdReport.pagesFetched;
  if (!holdReport.ok) {
    summary.fetch_error = holdReport.error;
    summary.errors += 1;
    return summary;
  }
  const holdRows = holdReport.rows;
  summary.fetched_holds = holdRows.length;

  let futureByUser = new Map<number, { className: string | null }>();
  if (needsEnding) {
    const futureWindow = attendanceGapFutureWindow(now);
    summary.future_from = futureWindow.fromDate;
    summary.future_to = futureWindow.toDate;
    let futureRows: ArboxBookingReportRow[];
    if (input.prefetchedFutureRows) {
      futureRows = input.prefetchedFutureRows;
      summary.pages_fetched += input.prefetchedFuturePages ?? 0;
    } else {
      const futureReport = await fetchArboxBookingsReport({
        apiKey,
        fromDate: futureWindow.fromDate,
        toDate: futureWindow.toDate,
        locationId: boxId,
      });
      summary.pages_fetched += futureReport.pagesFetched;
      if (!futureReport.ok) {
        summary.fetch_error = futureReport.error;
        summary.errors += 1;
        return summary;
      }
      futureRows = futureReport.rows;
    }
    summary.fetched_future = futureRows.length;
    futureByUser = futureBookingUserIds(futureRows, todayYmd);
  }

  const needsFullSeed = !input.freezeSeeded;

  let softSeedCreated = false;
  let softSeedEnding = false;
  if (!needsFullSeed) {
    let createdLogCount = 0;
    let endingLogCount = 0;
    if (createdRule) {
      const { count, error } = await input.admin
        .from("arbox_freeze_created_sync_log")
        .select("membership_hold_id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if (error) {
        console.error("[leads/arbox-freeze] soft-seed created count failed:", error.message);
        createdLogCount = 0;
      } else createdLogCount = count ?? 0;
    }
    if (needsEnding) {
      const { count, error } = await input.admin
        .from("arbox_freeze_ending_sync_log")
        .select("membership_hold_id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if (error) {
        console.error("[leads/arbox-freeze] soft-seed ending count failed:", error.message);
        endingLogCount = 0;
      } else endingLogCount = count ?? 0;
    }
    const soft = freezeTablesNeedingSoftSeed({
      freezeSeeded: true,
      createdRuleEnabled: Boolean(createdRule),
      endingRuleEnabled: needsEnding,
      createdLogCount,
      endingLogCount,
    });
    softSeedCreated = soft.softSeedCreated;
    softSeedEnding = soft.softSeedEnding;
  }

  const seedCreated = needsFullSeed || softSeedCreated;
  const seedEnding = needsFullSeed || softSeedEnding;

  for (const row of holdRows) {
    const holdId = parseHoldId(row.membership_hold_id);
    if (holdId == null) {
      summary.errors += 1;
      continue;
    }
    const userId = parseHoldUserId(row);
    const startYmd = parseClassDateYmd(row.start_suspend_time);
    const endYmd = parseClassDateYmd(row.end_suspend_time);

    // ——— A8 created ———
    if (createdRule && seedCreated) {
      const ok = await upsertCreatedLog({
        admin: input.admin,
        businessId,
        holdId,
        userId,
        contactId: null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (ok) {
        if (needsFullSeed) summary.created_seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
    } else if (createdRule && !seedCreated) {
      try {
        const { data: existing } = await input.admin
          .from("arbox_freeze_created_sync_log")
          .select("status, attempts")
          .eq("business_id", businessId)
          .eq("membership_hold_id", holdId)
          .maybeSingle();
        const status = String((existing as { status?: unknown } | null)?.status ?? "");
        if (status === "seeded" || status === "sent" || status === "abandoned" || status === "no_phone") {
          summary.already += 1;
        } else if (!existing) {
          // New hold after seed → send
          const attemptsSoFar = 0;
          const resolved = await resolveOrCreateContact({
            admin: input.admin,
            businessId,
            row,
            userId,
            source: "arbox_freeze_created",
          });
          if (!resolved.phone || !resolved.contact?.id) {
            summary.no_phone += 1;
            await upsertCreatedLog({
              admin: input.admin,
              businessId,
              holdId,
              userId,
              contactId: resolved.contact?.id ?? null,
              attempts: attemptsSoFar,
              status: "no_phone",
              nowIso,
            });
          } else {
            const send = await dispatchFreezeTemplate({
              admin: input.admin,
              businessId,
              businessSlug,
              phone: resolved.phone,
              fullName: resolveHoldFullName(row) ?? resolved.contact.full_name,
              startYmd,
              endYmd,
              className: null,
              triggerType: "freeze_created",
              rule: createdRule,
              dedupKey: buildFreezeCreatedScheduledDedupKey(
                businessId,
                createdRule.id,
                holdId,
                startYmd,
                endYmd
              ),
              now,
            });
            const next = nextCancellationSyncLogAfterDispatch({
              dispatch: mapDispatch(send.dispatch),
              attemptsSoFar,
            });
            await upsertCreatedLog({
              admin: input.admin,
              businessId,
              holdId,
              userId,
              contactId: resolved.contact.id,
              attempts: next.attempts,
              status: next.status,
              nowIso,
            });
            summary.created_processed += 1;
            if (send.dispatch === "immediate") summary.notified += 1;
            else if (send.dispatch === "deferred") summary.deferred += 1;
            else if (send.dispatch === "gated") summary.gated += 1;
            else if (send.dispatch === "send_failed") {
              if (next.hitCap) summary.abandoned += 1;
              else summary.errors += 1;
            }
            console.info("[leads/arbox-freeze] created dispatch", {
              businessId,
              hold_id: holdId,
              contact: maskPhoneForLog(resolved.phone),
              dispatch: send.dispatch,
              status: next.status,
            });
          }
        } else {
          // pending retry
          const attemptsSoFar = parseCancellationSyncAttempts(
            (existing as { attempts?: unknown }).attempts
          );
          const resolved = await resolveOrCreateContact({
            admin: input.admin,
            businessId,
            row,
            userId,
            source: "arbox_freeze_created",
          });
          if (!resolved.phone || !resolved.contact?.id) {
            summary.no_phone += 1;
            await upsertCreatedLog({
              admin: input.admin,
              businessId,
              holdId,
              userId,
              contactId: resolved.contact?.id ?? null,
              attempts: attemptsSoFar,
              status: "no_phone",
              nowIso,
            });
          } else {
            const send = await dispatchFreezeTemplate({
              admin: input.admin,
              businessId,
              businessSlug,
              phone: resolved.phone,
              fullName: resolveHoldFullName(row) ?? resolved.contact.full_name,
              startYmd,
              endYmd,
              className: null,
              triggerType: "freeze_created",
              rule: createdRule,
              dedupKey: buildFreezeCreatedScheduledDedupKey(
                businessId,
                createdRule.id,
                holdId,
                startYmd,
                endYmd
              ),
              now,
            });
            const next = nextCancellationSyncLogAfterDispatch({
              dispatch: mapDispatch(send.dispatch),
              attemptsSoFar,
            });
            await upsertCreatedLog({
              admin: input.admin,
              businessId,
              holdId,
              userId,
              contactId: resolved.contact.id,
              attempts: next.attempts,
              status: next.status,
              nowIso,
            });
            summary.created_processed += 1;
            if (send.dispatch === "immediate") summary.notified += 1;
            else if (send.dispatch === "deferred") summary.deferred += 1;
            else if (send.dispatch === "gated") summary.gated += 1;
            else if (send.dispatch === "send_failed") {
              if (next.hitCap) summary.abandoned += 1;
              else summary.errors += 1;
            }
          }
        }
      } catch (e) {
        summary.errors += 1;
        console.error("[leads/arbox-freeze] created row threw", {
          businessId,
          hold_id: holdId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ——— C14/C15 ending ———
    if (!needsEnding || !endYmd) continue;
    if (!isHoldEndInFuture(endYmd, todayYmd)) {
      summary.skipped_ended += 1;
      continue;
    }

    const variant: FreezeEndingVariant =
      userId != null ? endingVariantForUser(userId, futureByUser) : "unbooked";
    const endingRule = variant === "booked" ? endingBookedRule : endingUnbookedRule;
    if (!endingRule) continue;

    const delayDays = Math.max(0, Math.trunc(Number(endingRule.delay_days) || 0));
    const due = isFreezeEndingDue({ endYmd, delayDays, todayYmd });

    // Seed/soft-seed every future-ending hold (not only currently due) so later
    // window entry does not blast historical holds.
    if (seedEnding) {
      const ok = await upsertEndingLog({
        admin: input.admin,
        businessId,
        holdId,
        endYmd,
        variant,
        userId,
        contactId: null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (ok) {
        if (needsFullSeed) summary.ending_seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
      continue;
    }

    if (!due) continue;

    try {
      const { data: existing } = await input.admin
        .from("arbox_freeze_ending_sync_log")
        .select("status, attempts, variant")
        .eq("business_id", businessId)
        .eq("membership_hold_id", holdId)
        .eq("end_suspend_ymd", endYmd)
        .maybeSingle();

      const status = String((existing as { status?: unknown } | null)?.status ?? "");
      if (status === "seeded" || status === "sent" || status === "abandoned" || status === "no_phone") {
        summary.already += 1;
        continue;
      }

      const attemptsSoFar = parseCancellationSyncAttempts(
        (existing as { attempts?: unknown } | null)?.attempts
      );
      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row,
        userId,
        source: `arbox_freeze_ending_${variant}`,
      });
      if (!resolved.phone || !resolved.contact?.id) {
        summary.no_phone += 1;
        await upsertEndingLog({
          admin: input.admin,
          businessId,
          holdId,
          endYmd,
          variant,
          userId,
          contactId: resolved.contact?.id ?? null,
          attempts: attemptsSoFar,
          status: "no_phone",
          nowIso,
        });
        continue;
      }

      const className =
        variant === "booked" && userId != null
          ? futureByUser.get(userId)?.className ?? null
          : null;
      const triggerType =
        variant === "booked" ? "freeze_ending_booked" : "freeze_ending_unbooked";
      const send = await dispatchFreezeTemplate({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: resolved.phone,
        fullName: resolveHoldFullName(row) ?? resolved.contact.full_name,
        startYmd,
        endYmd,
        className,
        triggerType,
        rule: endingRule,
        dedupKey: buildFreezeEndingScheduledDedupKey(
          variant,
          businessId,
          endingRule.id,
          holdId,
          endYmd,
          className
        ),
        now,
      });
      const next = nextCancellationSyncLogAfterDispatch({
        dispatch: mapDispatch(send.dispatch),
        attemptsSoFar,
      });
      await upsertEndingLog({
        admin: input.admin,
        businessId,
        holdId,
        endYmd,
        variant,
        userId,
        contactId: resolved.contact.id,
        attempts: next.attempts,
        status: next.status,
        nowIso,
      });
      summary.ending_processed += 1;
      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "deferred") summary.deferred += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "send_failed") {
        if (next.hitCap) summary.abandoned += 1;
        else summary.errors += 1;
      }
      console.info("[leads/arbox-freeze] ending dispatch", {
        businessId,
        hold_id: holdId,
        end: endYmd,
        variant,
        contact: maskPhoneForLog(resolved.phone),
        dispatch: send.dispatch,
        status: next.status,
      });
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-freeze] ending row threw", {
        businessId,
        hold_id: holdId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Soft-seed empty sentinels
  if (!needsFullSeed) {
    if (softSeedCreated && createdRule) {
      const { count } = await input.admin
        .from("arbox_freeze_created_sync_log")
        .select("membership_hold_id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if ((count ?? 0) === 0) {
        const ok = await upsertCreatedLog({
          admin: input.admin,
          businessId,
          holdId: 0,
          userId: null,
          contactId: null,
          attempts: 0,
          status: "seeded",
          nowIso,
        });
        if (ok) summary.soft_seeded += 1;
        else summary.errors += 1;
      }
    }
    if (softSeedEnding && needsEnding) {
      const { count } = await input.admin
        .from("arbox_freeze_ending_sync_log")
        .select("membership_hold_id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if ((count ?? 0) === 0) {
        const ok = await upsertEndingLog({
          admin: input.admin,
          businessId,
          holdId: 0,
          endYmd: "1970-01-01",
          variant: "unbooked",
          userId: null,
          contactId: null,
          attempts: 0,
          status: "seeded",
          nowIso,
        });
        if (ok) summary.soft_seeded += 1;
        else summary.errors += 1;
      }
    }
  }

  if (needsFullSeed) {
    const { error: seedFlagErr } = await input.admin
      .from("businesses")
      .update({ arbox_freeze_seeded: true })
      .eq("id", businessId);
    if (seedFlagErr) {
      console.error("[leads/arbox-freeze] seed flag update failed:", seedFlagErr.message);
      summary.errors += 1;
    }
    console.info("[leads/arbox-freeze] seeded holds", {
      businessId,
      businessSlug,
      created_seeded: summary.created_seeded,
      ending_seeded: summary.ending_seeded,
    });
    return summary;
  }

  warnAbandonedCancellationSyncLog({
    businessId,
    abandoned: summary.abandoned,
    reason: "freeze_send_failed_cap",
  });

  return summary;
}
