/**
 * Freeze cluster: A8 freeze_created + C14 freeze_ending_unbooked + C15 freeze_ending_booked.
 * membersOnHoldReport has fromDate/toDate and only start/end suspend times — no
 * registration timestamp — so the filter is the freeze start. freeze_created runs
 * on the 15-minute trial-sync worker (yesterday…today+60, two calls under the
 * 31-day cap, quiet 21:00–08:00). freeze_ending_* stays on the daily cron.
 */
import { MORNING_SLOT_IL } from "@/lib/daily-run-slots";
import { logMessage } from "@/lib/analytics";
import { isRetentionStaff, retentionStaffIndex } from "@/lib/leads/arbox-staff";
import { upsertOptionalReason } from "@/lib/leads/sync-log-reason";
import { claimPendingSyncLog, logDedupBlockedSend } from "@/lib/leads/dedup-fail-closed";
import {
  addCalendarDaysYmd,
  decideActivationEventAction,
  eventBeforeRuleActivation,
  israelSlotInstant,
  parseReportEventInstant,
} from "@/lib/rule-activation";
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import {
  isCancellationSyncLogTerminal,
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
import { templateFailureDispatch } from "@/lib/business-sends-hold";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildFreezeCreatedScheduledDedupKey,
  buildFreezeEndingScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import {
  freezeCreatedTemplateParamValues,
  templateBodyUsesFirstNameSlot,
  templateSendPayload,
} from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledFreezeCreatedTemplateTriggers,
  loadEnabledFreezeEndingBookedTemplateTriggers,
  loadEnabledFreezeEndingUnbookedTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { rulesForCompanionSend, runCompanionTemplateSends } from "@/lib/same-trigger-template-order";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HOLD_LOOKBACK_PAST_DAYS = 7;
/** Arbox fromDate→toDate difference. 30 days apart is 31 inclusive dates. */
const FREEZE_CREATED_SPAN_CAP_DAYS = 30;
/** Start-date horizon when the report cannot filter by registration time. */
const FREEZE_CREATED_FUTURE_DAYS = 60;
const ISRAEL_TZ = "Asia/Jerusalem";

export type FreezeEndingVariant = "booked" | "unbooked";

export type FreezeSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials" | "quiet_hours";
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

/** Quiet hours are 21:00–08:00 Asia/Jerusalem. The 08:00 run is the first that sends. */
export function isFreezeCreatedQuietHours(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ISRAEL_TZ,
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .find((part) => part.type === "hour")?.value
  );
  return hour >= 21 || hour < 8;
}

/**
 * membersOnHoldReport cannot filter by registration time. Two GETs cover
 * yesterday through today+60 without crossing the 31-day cap.
 */
export function freezeCreatedReportWindows(now: Date): { fromDate: string; toDate: string }[] {
  const today = formatDateYmdIsrael(now);
  const from = addDaysYmd(today, -1);
  const end = addDaysYmd(today, FREEZE_CREATED_FUTURE_DAYS);
  if (!from || !end) return [];
  const windows: { fromDate: string; toDate: string }[] = [];
  let cursor = from;
  while (cursor <= end) {
    const chunkEnd = addDaysYmd(cursor, FREEZE_CREATED_SPAN_CAP_DAYS);
    if (!chunkEnd) break;
    const toDate = chunkEnd < end ? chunkEnd : end;
    windows.push({ fromDate: cursor, toDate });
    if (toDate >= end) break;
    const next = addDaysYmd(toDate, 1);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return windows;
}

/** Freeze start inside yesterday…today+60. That is the registration proxy. */
export function freezeCreatedStartInSpan(startYmd: string, now: Date): boolean {
  const windows = freezeCreatedReportWindows(now);
  const from = windows[0]?.fromDate;
  const to = windows[windows.length - 1]?.toDate;
  if (!from || !to) return false;
  return startYmd >= from && startYmd <= to;
}

const FREEZE_CREATED_TERMINAL = { has: (status: string) => isCancellationSyncLogTerminal(status) };

/**
 * Marker row per rule: membership_hold_id 0, user_id = this version, status seeded.
 * A widened window on an already-seeded business is missing the marker, so the
 * first run inserts dedup rows and does not send.
 */
export const FREEZE_CREATED_WINDOW_VERSION = 2;
export const FREEZE_CREATED_WINDOW_MARKER_HOLD_ID = 0;

export function freezeCreatedHasWindowMarker(userId: unknown, status: unknown): boolean {
  return String(status ?? "") === "seeded" && Number(userId) === FREEZE_CREATED_WINDOW_VERSION;
}

/** Already-seeded business without the current window marker: seed, do not send. */
export function planFreezeCreatedWindowPass(input: {
  freezeSeeded: boolean;
  hasWindowMarker: boolean;
  holds: { id: number; priorStatus: string | null }[];
}): { seedIds: number[]; sendIds: number[] } {
  const open = input.holds.filter(
    (hold) => !hold.priorStatus || !FREEZE_CREATED_TERMINAL.has(hold.priorStatus)
  );
  if (!input.freezeSeeded || !input.hasWindowMarker) {
    return { seedIds: open.map((hold) => hold.id), sendIds: [] };
  }
  return { seedIds: [], sendIds: open.map((hold) => hold.id) };
}

/** A logged hold is not sent again. Quiet hours leave it for the 08:00 run. */
export function freezeCreatedShouldNotify(input: {
  startYmd: string;
  now: Date;
  priorStatus: string | null;
}): "send" | "skip_quiet" | "skip_already" | "skip_window" {
  if (isFreezeCreatedQuietHours(input.now)) return "skip_quiet";
  if (input.priorStatus && FREEZE_CREATED_TERMINAL.has(input.priorStatus)) return "skip_already";
  if (!freezeCreatedStartInSpan(input.startYmd, input.now)) return "skip_window";
  return "send";
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
  triggerId: string;
  holdId: number;
  userId: number | null;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
  /** Leave an existing row (a prior send) unchanged. */
  ignoreExisting?: boolean;
}): Promise<boolean> {
  const { ok } = await upsertOptionalReason(
    input.admin,
    "arbox_freeze_created_sync_log",
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      membership_hold_id: input.holdId,
      user_id: input.userId,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    "business_id,trigger_id,membership_hold_id",
    undefined,
    { ignoreDuplicates: input.ignoreExisting === true }
  );
  return ok;
}

async function upsertEndingLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  holdId: number;
  endYmd: string;
  variant: FreezeEndingVariant;
  userId: number | null;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
}): Promise<boolean> {
  const { ok } = await upsertOptionalReason(
    input.admin,
    "arbox_freeze_ending_sync_log",
    {
      business_id: input.businessId,
      trigger_id: input.triggerId,
      membership_hold_id: input.holdId,
      end_suspend_ymd: input.endYmd,
      variant: input.variant,
      user_id: input.userId,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    "business_id,trigger_id,membership_hold_id,end_suspend_ymd"
  );
  return ok;
}

async function dispatchFreezeTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  contactFullName?: string | null;
  startYmd: string | null;
  endYmd: string | null;
  className: string | null;
  triggerType: string;
  rule: PurchaseTemplateTriggerRule;
  dedupKey: string;
  now: Date;
}): Promise<{ dispatch: "immediate" | "deferred" | "gated" | "skipped" | "send_failed" | "send_unknown" | "no_rule"; ok: boolean }> {
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
      arboxFullName: input.fullName,
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

  const firstName = resolveTemplateFirstName(
    { full_name: input.contactFullName ?? null },
    input.fullName
  );
  if (!firstName && templateBodyUsesFirstNameSlot(input.triggerType, (approvedTpl as { components?: unknown }).components)) {
    console.info("[leads/arbox-freeze] skip", { reason: "no_valid_name" });
    return { dispatch: "skipped", ok: false };
  }
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const businessName = String((bizRow as { name?: unknown } | null)?.name ?? "");
  let sendComponents: ReturnType<typeof templateSendPayload>["sendComponents"];
  let bodyParams: string[] = [];
  if (input.triggerType === "freeze_created") {
    const planned = freezeCreatedTemplateParamValues({
      storedComponents,
      firstName,
      startYmd: input.startYmd,
      endYmd: input.endYmd,
    });
    if (!planned.ok) {
      console.error("[leads/arbox-freeze] template param mismatch", {
        businessId: input.businessId,
        templateName,
        varCount: planned.varCount,
      });
      return { dispatch: "skipped", ok: false };
    }
    bodyParams = planned.values;
    if (planned.values.length) {
      sendComponents = [
        { type: "body", parameters: planned.values.map((text) => ({ type: "text" as const, text })) },
      ];
    }
  } else {
    const payload = templateSendPayload({
      triggerType: input.triggerType,
      storedComponents,
      firstName,
      businessName,
      className: input.className,
      startDateYmd: input.startYmd,
      expiryDateYmd: input.endYmd,
    });
    sendComponents = payload.sendComponents;
    bodyParams = payload.bodyParams;
  }

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    alertTriggerId: input.rule.id,
    eventDedupKey: input.dedupKey,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-freeze] template send failed:", sendResult.error);
    return { dispatch: templateFailureDispatch(sendResult.error), ok: false };
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

function mapDispatch(d: string): "immediate" | "deferred" | "gated" | "send_failed" | "send_unknown" | "skipped" {
  if (d === "send_unknown") return "send_unknown";
  if (d === "immediate") return "immediate";
  if (d === "deferred") return "deferred";
  if (d === "gated") return "gated";
  if (d === "skipped") return "skipped";
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
  /** created = 15-minute worker. ending = daily cron. Never both in one call. */
  part: "created" | "ending";
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
  const staffIndex = await retentionStaffIndex(input.admin, businessId);
  const todayYmd = formatDateYmdIsrael(now);

  if (!apiKey || !boxId) {
    summary.skipped = true;
    summary.skip_reason = "missing_credentials";
    return summary;
  }

  const part = input.part === "created" ? "created" : "ending";
  const [createdRules, endingBookedRules, endingUnbookedRules] = await Promise.all([
    part === "created"
      ? loadEnabledFreezeCreatedTemplateTriggers(input.admin, businessId)
      : Promise.resolve([]),
    part === "ending"
      ? loadEnabledFreezeEndingBookedTemplateTriggers(input.admin, businessId)
      : Promise.resolve([]),
    part === "ending"
      ? loadEnabledFreezeEndingUnbookedTemplateTriggers(input.admin, businessId)
      : Promise.resolve([]),
  ]);
  const createdSendRules = rulesForCompanionSend(createdRules);
  const endingBookedSend = rulesForCompanionSend(endingBookedRules);
  const endingUnbookedSend = rulesForCompanionSend(endingUnbookedRules);
  if (!createdSendRules.length && !endingBookedSend.length && !endingUnbookedSend.length) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  if (part === "created" && isFreezeCreatedQuietHours(now)) {
    summary.skipped = true;
    summary.skip_reason = "quiet_hours";
    return summary;
  }

  const maxEndingDelay = Math.max(
    0,
    ...[...endingBookedSend, ...endingUnbookedSend].map((item) =>
      Math.max(0, Math.trunc(Number(item.delay_days) || 0))
    )
  );
  const needsEnding = endingBookedSend.length > 0 || endingUnbookedSend.length > 0;

  let holdRows: ArboxMembersOnHoldRow[] = [];
  if (part === "created") {
    const windows = freezeCreatedReportWindows(now);
    summary.lookback_from = windows[0]?.fromDate;
    summary.lookback_to = windows[windows.length - 1]?.toDate;
    const seenHolds = new Set<number>();
    for (const window of windows) {
      const holdReport = await fetchArboxMembersOnHoldReport({
        apiKey,
        fromDate: window.fromDate,
        toDate: window.toDate,
        locationId: boxId,
      });
      summary.pages_fetched += holdReport.pagesFetched;
      if (!holdReport.ok) {
        summary.fetch_error = holdReport.error;
        summary.errors += 1;
        return summary;
      }
      for (const row of holdReport.rows) {
        const holdId = parseHoldId(row.membership_hold_id);
        const startYmd = parseClassDateYmd(row.start_suspend_time);
        if (holdId == null || !startYmd || seenHolds.has(holdId)) continue;
        if (!freezeCreatedStartInSpan(startYmd, now)) continue;
        seenHolds.add(holdId);
        holdRows.push(row);
      }
    }
  } else {
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
    holdRows = holdReport.rows;
  }
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
    if (createdSendRules.length) {
      const { count, error } = await input.admin
        .from("arbox_freeze_created_sync_log")
        .select("membership_hold_id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if (error) {
        logDedupBlockedSend({
          log: "[leads/arbox-freeze]",
          businessId,
          reason: error.message,
        });
        summary.errors += 1;
        summary.fetch_error = error.message;
        return summary;
      } else createdLogCount = count ?? 0;
    }
    if (needsEnding) {
      const { count, error } = await input.admin
        .from("arbox_freeze_ending_sync_log")
        .select("membership_hold_id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if (error) {
        logDedupBlockedSend({
          log: "[leads/arbox-freeze]",
          businessId,
          reason: error.message,
        });
        summary.errors += 1;
        summary.fetch_error = error.message;
        return summary;
      } else endingLogCount = count ?? 0;
    }
    const soft = freezeTablesNeedingSoftSeed({
      freezeSeeded: true,
      createdRuleEnabled: createdSendRules.length > 0,
      endingRuleEnabled: needsEnding,
      createdLogCount,
      endingLogCount,
    });
    softSeedCreated = soft.softSeedCreated;
    softSeedEnding = soft.softSeedEnding;
  }

  const seedCreated = needsFullSeed || softSeedCreated;
  const seedEnding = needsFullSeed || softSeedEnding;

  const missingWindowMarker = new Set<string>();
  if (part === "created" && input.freezeSeeded && createdSendRules.length) {
    const { data: markerRows, error: markerErr } = await input.admin
      .from("arbox_freeze_created_sync_log")
      .select("trigger_id, user_id, status")
      .eq("business_id", businessId)
      .eq("membership_hold_id", FREEZE_CREATED_WINDOW_MARKER_HOLD_ID)
      .in(
        "trigger_id",
        createdSendRules.map((rule) => rule.id)
      );
    if (markerErr) {
      console.error("[leads/arbox-freeze] window marker lookup failed:", markerErr.message);
      for (const rule of createdSendRules) missingWindowMarker.add(rule.id);
    } else {
      const marked = new Set(
        (markerRows ?? [])
          .filter((row) =>
            freezeCreatedHasWindowMarker(
              (row as { user_id?: unknown }).user_id,
              (row as { status?: unknown }).status
            )
          )
          .map((row) => String((row as { trigger_id?: unknown }).trigger_id ?? ""))
      );
      for (const rule of createdSendRules) {
        if (!marked.has(rule.id)) missingWindowMarker.add(rule.id);
      }
    }
  }
  const createdRulesToSend = createdSendRules.filter((rule) => !missingWindowMarker.has(rule.id));

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
    if (missingWindowMarker.size && !seedCreated) {
      let ok = true;
      for (const rule of createdSendRules) {
        if (!missingWindowMarker.has(rule.id)) continue;
        const up = await upsertCreatedLog({
          admin: input.admin,
          businessId,
          triggerId: rule.id,
          holdId,
          userId,
          contactId: null,
          attempts: 0,
          status: "seeded",
          nowIso,
          ignoreExisting: true,
        });
        if (!up) ok = false;
      }
      if (ok) summary.soft_seeded += 1;
      else summary.errors += 1;
    }
    if (createdSendRules.length && seedCreated) {
      let ok = true;
      for (const rule of createdSendRules) {
        const up = await upsertCreatedLog({
          admin: input.admin,
          businessId,
          triggerId: rule.id,
          holdId,
          userId,
          contactId: null,
          attempts: 0,
          status: "seeded",
          nowIso,
        });
        if (!up) ok = false;
      }
      if (ok) {
        if (needsFullSeed) summary.created_seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
    } else if (createdRulesToSend.length && !seedCreated) {
      try {
        const { data: existingRows, error: existingErr } = await input.admin
          .from("arbox_freeze_created_sync_log")
          .select("trigger_id, status, attempts")
          .eq("business_id", businessId)
          .eq("membership_hold_id", holdId)
          .in(
            "trigger_id",
            createdRulesToSend.map((item) => item.id)
          );
        if (existingErr) {
          logDedupBlockedSend({
            log: "[leads/arbox-freeze]",
            businessId,
            reason: existingErr.message,
          });
          summary.errors += 1;
        }
        const terminalIds = new Set(
          existingErr
            ? createdRulesToSend.map((item) => item.id)
            : (existingRows ?? [])
                .filter((log) => {
                  const status = String((log as { status?: unknown }).status ?? "");
                  return FREEZE_CREATED_TERMINAL.has(status);
                })
                .map((log) => String((log as { trigger_id?: unknown }).trigger_id ?? ""))
        );
        const pendingRules = createdRulesToSend.filter(
          (item) =>
            item.id &&
            !terminalIds.has(item.id) &&
            !eventBeforeRuleActivation(parseReportEventInstant(startYmd), item)
        );
        if (!pendingRules.length) {
          summary.already += 1;
        } else {
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
            for (const rule of pendingRules) {
              await upsertCreatedLog({
                admin: input.admin,
                businessId,
                triggerId: rule.id,
                holdId,
                userId,
                contactId: resolved.contact?.id ?? null,
                attempts: attemptsSoFar,
                status: "no_phone",
                nowIso,
              });
            }
          } else {
            const sendPhone = resolved.phone;
            const sendContact = resolved.contact;
            if (isRetentionStaff(staffIndex, { userId, phone: sendPhone })) {
              for (const rule of pendingRules) {
                const marked = await upsertOptionalReason(
                  input.admin,
                  "arbox_freeze_created_sync_log",
                  {
                    business_id: businessId,
                    trigger_id: rule.id,
                    membership_hold_id: holdId,
                    user_id: userId,
                    contact_id: sendContact.id,
                    processed_at: nowIso,
                    attempts: attemptsSoFar,
                    status: "seeded",
                  },
                  "business_id,trigger_id,membership_hold_id",
                  "staff",
                );
                if (!marked.ok) summary.errors += 1;
              }
              console.info("[retention-staff] skip", {
                trigger: "freeze_created",
                businessId,
                user_id: userId,
              });
              continue;
            }
            const claimedRules: typeof pendingRules = [];
            for (const rule of pendingRules) {
              if (isArboxDailyDryRun()) {
                claimedRules.push(rule);
                continue;
              }
              const prior = (existingRows ?? []).find(
                (log) => String((log as { trigger_id?: unknown }).trigger_id ?? "") === rule.id
              );
              const priorAttempts = prior
                ? parseCancellationSyncAttempts((prior as { attempts?: unknown }).attempts)
                : null;
              const claim = await claimPendingSyncLog({
                admin: input.admin,
                table: "arbox_freeze_created_sync_log",
                insertRow: {
                  business_id: businessId,
                  trigger_id: rule.id,
                  membership_hold_id: holdId,
                  user_id: userId,
                  contact_id: sendContact.id,
                  processed_at: nowIso,
                  attempts: priorAttempts ?? 0,
                  status: "pending",
                },
                filters: [
                  ["business_id", businessId],
                  ["trigger_id", rule.id],
                  ["membership_hold_id", holdId],
                ],
                existingAttempts: prior ? priorAttempts : null,
                nowIso,
              });
              if (claim === "won") claimedRules.push(rule);
              else if (claim === "error") {
                logDedupBlockedSend({
                  log: "[leads/arbox-freeze]",
                  businessId,
                  triggerId: rule.id,
                  reason: "claim_failed",
                });
                summary.errors += 1;
              }
            }
            if (!claimedRules.length) {
              summary.already += 1;
            } else {
            const sendDispatch = await runCompanionTemplateSends({
              rules: claimedRules,
              dryRun: isArboxDailyDryRun(),
              send: (rule) =>
                dispatchFreezeTemplate({
                  admin: input.admin,
                  businessId,
                  businessSlug,
                  phone: sendPhone,
                  fullName: resolveHoldFullName(row),
                  contactFullName: sendContact.full_name,
                  startYmd,
                  endYmd,
                  className: null,
                  triggerType: "freeze_created",
                  rule,
                  dedupKey: buildFreezeCreatedScheduledDedupKey(
                    businessId,
                    rule.id,
                    holdId,
                    startYmd,
                    endYmd
                  ),
                  now,
                }).then((send) => send.dispatch),
            });
            const next = nextCancellationSyncLogAfterDispatch({
              dispatch: mapDispatch(sendDispatch),
              attemptsSoFar,
            });
            for (const rule of claimedRules) {
              await upsertCreatedLog({
                admin: input.admin,
                businessId,
                triggerId: rule.id,
                holdId,
                userId,
                contactId: sendContact.id,
                attempts: next.attempts,
                status: next.status,
                nowIso,
              });
            }
            summary.created_processed += 1;
            console.info("[leads/arbox-freeze] dispatch", {
              businessId,
              step: "created",
              user_id: userId,
              phone: sendPhone.slice(-4),
              start: startYmd,
              end: endYmd,
              dispatch: sendDispatch,
            });
            if (sendDispatch === "immediate") summary.notified += 1;
            else if (sendDispatch === "deferred") summary.deferred += 1;
            else if (sendDispatch === "gated") summary.gated += 1;
            else if (sendDispatch === "send_failed" || sendDispatch === "send_unknown") {
              if (next.hitCap) summary.abandoned += 1;
              else summary.errors += 1;
            }
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
    const endingPool = variant === "booked" ? endingBookedSend : endingUnbookedSend;
    if (!endingPool.length) continue;

    const dueRules = endingPool.filter((item) =>
      isFreezeEndingDue({
        endYmd,
        delayDays: Math.max(0, Math.trunc(Number(item.delay_days) || 0)),
        todayYmd,
      })
    );

    // Seed/soft-seed every future-ending hold (not only currently due) so later
    // window entry does not blast historical holds.
    if (seedEnding) {
      let ok = true;
      let seededAny = false;
      for (const rule of endingPool) {
        const days = Math.max(0, Math.trunc(Number(rule.delay_days) || 0));
        const notifyFrom = addCalendarDaysYmd(endYmd, -days);
        const sendAt = notifyFrom ? israelSlotInstant(notifyFrom, MORNING_SLOT_IL) : null;
        if (decideActivationEventAction({ sendAt, now }) === "send") continue;
        seededAny = true;
        const up = await upsertEndingLog({
          admin: input.admin,
          businessId,
          triggerId: rule.id,
          holdId,
          endYmd,
          variant,
          userId,
          contactId: null,
          attempts: 0,
          status: "seeded",
          nowIso,
        });
        if (!up) ok = false;
      }
      if (seededAny) {
        if (ok) {
          if (needsFullSeed) summary.ending_seeded += 1;
          else summary.soft_seeded += 1;
        } else summary.errors += 1;
        continue;
      }
    }

    if (!dueRules.length) continue;

    try {
      const { data: existingRows, error: existingErr } = await input.admin
        .from("arbox_freeze_ending_sync_log")
        .select("trigger_id, status, attempts, variant")
        .eq("business_id", businessId)
        .eq("membership_hold_id", holdId)
        .eq("end_suspend_ymd", endYmd)
        .in(
          "trigger_id",
          dueRules.map((item) => item.id)
        );
      if (existingErr) {
        logDedupBlockedSend({
          log: "[leads/arbox-freeze]",
          businessId,
          reason: existingErr.message,
        });
        summary.errors += 1;
        continue;
      }
      const terminalIds = new Set(
        (existingRows ?? [])
          .filter((log) => {
            const status = String((log as { status?: unknown }).status ?? "");
            return isCancellationSyncLogTerminal(status);
          })
          .map((log) => String((log as { trigger_id?: unknown }).trigger_id ?? ""))
      );
      const pendingRules = dueRules.filter(
        (item) =>
          item.id &&
          !terminalIds.has(item.id) &&
          !eventBeforeRuleActivation(
            israelSlotInstant(
              addCalendarDaysYmd(endYmd, -Math.max(0, Math.trunc(Number(item.delay_days) || 0))) ?? "",
              MORNING_SLOT_IL
            ) ?? parseReportEventInstant(startYmd),
            item
          )
      );
      if (!pendingRules.length) {
        summary.already += 1;
        continue;
      }

      const attemptsSoFar = 0;
      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row,
        userId,
        source: `arbox_freeze_ending_${variant}`,
      });
      if (!resolved.phone || !resolved.contact?.id) {
        summary.no_phone += 1;
        for (const rule of pendingRules) {
          await upsertEndingLog({
            admin: input.admin,
            businessId,
            triggerId: rule.id,
            holdId,
            endYmd,
            variant,
            userId,
            contactId: resolved.contact?.id ?? null,
            attempts: attemptsSoFar,
            status: "no_phone",
            nowIso,
          });
        }
        continue;
      }

      const className =
        variant === "booked" && userId != null
          ? futureByUser.get(userId)?.className ?? null
          : null;
      const triggerType =
        variant === "booked" ? "freeze_ending_booked" : "freeze_ending_unbooked";
      const sendPhone = resolved.phone;
      const sendContact = resolved.contact;
      if (isRetentionStaff(staffIndex, { userId, phone: sendPhone })) {
        for (const rule of pendingRules) {
          const marked = await upsertOptionalReason(
            input.admin,
            "arbox_freeze_ending_sync_log",
            {
              business_id: businessId,
              trigger_id: rule.id,
              membership_hold_id: holdId,
              end_suspend_ymd: endYmd,
              variant,
              user_id: userId,
              contact_id: sendContact.id,
              processed_at: nowIso,
              attempts: 0,
              status: "seeded",
            },
            "business_id,trigger_id,membership_hold_id,end_suspend_ymd",
            "staff",
          );
          if (!marked.ok) summary.errors += 1;
        }
        console.info("[retention-staff] skip", {
          trigger: triggerType,
          businessId,
          user_id: userId,
        });
        continue;
      }
      const claimedRules: typeof pendingRules = [];
      for (const rule of pendingRules) {
        if (isArboxDailyDryRun()) {
          claimedRules.push(rule);
          continue;
        }
        const prior = (existingRows ?? []).find(
          (log) => String((log as { trigger_id?: unknown }).trigger_id ?? "") === rule.id
        );
        const priorAttempts = prior
          ? parseCancellationSyncAttempts((prior as { attempts?: unknown }).attempts)
          : null;
        const claim = await claimPendingSyncLog({
          admin: input.admin,
          table: "arbox_freeze_ending_sync_log",
          insertRow: {
            business_id: businessId,
            trigger_id: rule.id,
            membership_hold_id: holdId,
            end_suspend_ymd: endYmd,
            variant,
            user_id: userId,
            contact_id: sendContact.id,
            processed_at: nowIso,
            attempts: priorAttempts ?? 0,
            status: "pending",
          },
          filters: [
            ["business_id", businessId],
            ["trigger_id", rule.id],
            ["membership_hold_id", holdId],
            ["end_suspend_ymd", endYmd],
          ],
          existingAttempts: prior ? priorAttempts : null,
          nowIso,
        });
        if (claim === "won") claimedRules.push(rule);
        else if (claim === "error") {
          logDedupBlockedSend({
            log: "[leads/arbox-freeze]",
            businessId,
            triggerId: rule.id,
            reason: "claim_failed",
          });
          summary.errors += 1;
        }
      }
      if (!claimedRules.length) {
        summary.already += 1;
        continue;
      }
      const sendDispatch = await runCompanionTemplateSends({
        rules: claimedRules,
        dryRun: isArboxDailyDryRun(),
        send: (rule) =>
          dispatchFreezeTemplate({
            admin: input.admin,
            businessId,
            businessSlug,
            phone: sendPhone,
            fullName: resolveHoldFullName(row),
            contactFullName: sendContact.full_name,
            startYmd,
            endYmd,
            className,
            triggerType,
            rule,
            dedupKey: buildFreezeEndingScheduledDedupKey(
              variant,
              businessId,
              rule.id,
              holdId,
              endYmd,
              className
            ),
            now,
          }).then((send) => send.dispatch),
      });
      const next = nextCancellationSyncLogAfterDispatch({
        dispatch: mapDispatch(sendDispatch),
        attemptsSoFar,
      });
      for (const rule of claimedRules) {
        await upsertEndingLog({
          admin: input.admin,
          businessId,
          triggerId: rule.id,
          holdId,
          endYmd,
          variant,
          userId,
          contactId: sendContact.id,
          attempts: next.attempts,
          status: next.status,
          nowIso,
        });
      }
      summary.ending_processed += 1;
      console.info("[leads/arbox-freeze] dispatch", {
        businessId,
        step: "ending",
        user_id: userId,
        phone: sendPhone.slice(-4),
        end: endYmd,
        dispatch: sendDispatch,
      });
      if (sendDispatch === "immediate") summary.notified += 1;
      else if (sendDispatch === "deferred") summary.deferred += 1;
      else if (sendDispatch === "gated") summary.gated += 1;
      else if (sendDispatch === "send_failed" || sendDispatch === "send_unknown") {
        if (next.hitCap) summary.abandoned += 1;
        else summary.errors += 1;
      }
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-freeze] ending row threw", {
        businessId,
        hold_id: holdId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (part === "created" && createdSendRules.length && (needsFullSeed || missingWindowMarker.size > 0)) {
    for (const rule of createdSendRules) {
      if (!needsFullSeed && !missingWindowMarker.has(rule.id)) continue;
      const marked = await upsertCreatedLog({
        admin: input.admin,
        businessId,
        triggerId: rule.id,
        holdId: FREEZE_CREATED_WINDOW_MARKER_HOLD_ID,
        userId: FREEZE_CREATED_WINDOW_VERSION,
        contactId: null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (!marked) summary.errors += 1;
    }
    if (missingWindowMarker.size > 0 && !needsFullSeed) {
      console.info("[leads/arbox-freeze] widened window seeded without sending", {
        businessId,
        businessSlug,
        rules: missingWindowMarker.size,
        holds: holdRows.length,
      });
    }
  }

  // Soft-seed empty sentinels
  if (!needsFullSeed) {
    if (softSeedCreated && createdSendRules.length) {
      const { count } = await input.admin
        .from("arbox_freeze_created_sync_log")
        .select("membership_hold_id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if ((count ?? 0) === 0) {
        const ok = await upsertCreatedLog({
          admin: input.admin,
          businessId,
          triggerId: "00000000-0000-0000-0000-000000000000",
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
          triggerId: "00000000-0000-0000-0000-000000000000",
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
