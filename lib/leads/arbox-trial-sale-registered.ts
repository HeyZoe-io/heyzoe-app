import { getArboxApiKey } from "@/lib/business-secret-read";
import { HEYZOE_SF_REGISTERED, logMessage } from "@/lib/analytics";
import {
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { resolveTemplateFirstName } from "@/lib/template-first-name";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { isSendsHoldError } from "@/lib/business-sends-hold";
import {
  buildPurchaseScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateBodyUsesFirstNameSlot, templateSendPayload } from "@/lib/template-send-params";
import {
  loadEnabledPurchaseTemplateTriggers,
  matchingPurchaseTemplateTriggerRules,
  type PurchaseMatchContext,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { planTrialRegistrationSends } from "@/lib/leads/trial-registration-plan";
import {
  loadTrialSignupNotice,
  trialPurchaseTemplateBlockedByZoe,
} from "@/lib/trial-signup-notice";
import { delayDirectionForTrigger } from "@/lib/template-trigger-types";
import { buildTrialRegisteredContactPatch } from "@/lib/trial-registered-manual";
import {
  arboxTrialTaskTypeIdFromSocial,
  createArboxCrmTask,
  shouldOpenArboxTrialPurchaseTask,
} from "@/lib/crm/adapters/arbox";
import { buildCrmEventNote } from "@/lib/crm/types";
import {
  buildWaSessionId,
  canonicalContactPhone,
  contactPhoneLookupVariants,
} from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logDedupBlockedSend } from "@/lib/leads/dedup-fail-closed";
import {
  claimSyncLogBeforeSend,
  sendWithSyncLogClaim,
  settleSyncLogClaim,
  syncLogRowRetryable,
  type SyncLogSettle,
} from "@/lib/leads/sync-log-claim";

const SALE_LOG_SENTINEL_TRIGGER_ID = "00000000-0000-0000-0000-000000000000";

async function markPurchaseSaleSeen(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  saleId: number;
  triggerId: string;
  contactId: string | null;
  nowIso: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await input.admin.from("arbox_trial_sync_log").upsert(
    {
      business_id: input.businessId,
      sale_id: input.saleId,
      trigger_id: input.triggerId,
      contact_id: input.contactId,
      processed_at: input.nowIso,
    },
    { onConflict: "business_id,sale_id,trigger_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
import { sendTrialRegisteredWhatsAppReplyIfInWindow } from "@/lib/trial-registered-wa-reply";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

/** One row from Arbox GET /v3/reports/salesReport `data[]`. */
export type ArboxSalesReportRow = {
  sale_id: unknown;
  user_id: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  date?: unknown;
  membership_type_id: unknown;
  item_type?: unknown;
  item_name?: unknown;
  paid?: unknown;
  debt?: unknown;
  price?: unknown;
};

/** Payment-link / invoice still open — not a completed registration. */
export function arboxSaleHasOutstandingDebt(row: { debt?: unknown }): boolean {
  const debt = Number(row.debt);
  return Number.isFinite(debt) && debt > 0;
}

export type ArboxTrialSaleRegisteredResult =
  | { ok: true; already: true }
  | { ok: true; unpaid: true }
  | {
      ok: true;
      trial_registered_at: string;
      whatsapp:
        | "sent"
        | "no_channel"
        | "outside_24h_window"
        | "no_user_session"
        | "send_failed"
        | "throttled_2d"
        | "template_not_configured"
        | "no_matching_rule"
        | "collapsed_same_day"
        | "deferred"
        | "opted_out"
        | "skipped_zoe_confirm"
        | "skipped_trial_template";
      contact_created: boolean;
    }
  | { ok: false; error: string };

const MS_2_DAYS = 2 * 24 * 60 * 60 * 1000;

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

function parseSaleId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function resolveReportFullName(row: ArboxSalesReportRow): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

type ExistingContactRow = {
  id: string;
  phone?: string;
  full_name?: string | null;
  trial_registered?: boolean | null;
  session_phase?: string | null;
  opted_out?: boolean | null;
  not_relevant_at?: string | null;
  instagram_follow_prompt_sent?: boolean | null;
  arbox_user_id?: string | null;
  arbox_trial_last_notified_at?: string | null;
  sales_flow_started_at?: string | null;
};

function parseMembershipTypeId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

/** Arbox salesReport `date` is day-only (YYYY-MM-DD); fall back to now. */
function parseSaleEventDate(raw: unknown): Date {
  const s = String(raw ?? "").trim();
  if (!s) return new Date();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

type OpeningTemplateDispatch = "immediate" | "deferred" | "gated" | "no_rule";

type OpeningTemplateResult =
  | { outcome: "sent" }
  | { outcome: "skipped_trial_template"; dispatch: "no_rule" }
  | { outcome: "template_not_configured"; dispatch: OpeningTemplateDispatch }
  | { outcome: "no_matching_rule"; dispatch: "no_rule" }
  | { outcome: "collapsed_same_day"; dispatch: "no_rule" }
  | { outcome: "deferred"; dispatch: "deferred" }
  | { outcome: "send_failed"; dispatch: OpeningTemplateDispatch };

const PURCHASE_SAME_DAY_SENT_CHUNK = 100;

/** `userId|YYYY-MM-DD|triggerId` — one purchase template per person per sale day per rule. */
export function purchaseSameDaySentKey(input: {
  userId: string;
  saleDateYmd: string;
  triggerId: string;
}): string | null {
  const userId = String(input.userId ?? "").trim();
  const ymd = String(input.saleDateYmd ?? "").trim().slice(0, 10);
  const triggerId = String(input.triggerId ?? "").trim();
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !triggerId) return null;
  if (triggerId === SALE_LOG_SENTINEL_TRIGGER_ID) return null;
  return `${userId}|${ymd}|${triggerId}`;
}

export function saleDateYmdFromRaw(raw: unknown): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw ?? "").trim());
  return match?.[1] ?? "";
}

export function purchaseTemplateCollapsedForSameDay(
  keys: ReadonlySet<string> | undefined,
  input: { userId: string; saleDateYmd: string; triggerId: string }
): boolean {
  const key = purchaseSameDaySentKey(input);
  if (!key || !keys) return false;
  return keys.has(key);
}

export function rememberPurchaseSameDaySend(
  keys: Set<string> | undefined,
  input: { userId: string; saleDateYmd: string; triggerId: string }
): void {
  const key = purchaseSameDaySentKey(input);
  if (key && keys) keys.add(key);
}

/**
 * Sales already logged for this trigger, grouped so a second line on the same
 * user+day does not send again. One indexed read per 100 sibling sales, and
 * only when the report actually has two sales for one person on one date.
 * A lookup failure leaves the set empty (the old per-sale send).
 */
export async function loadPurchaseSameDaySentKeys(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  rows: ReadonlyArray<{ sale_id?: unknown; user_id?: unknown; date?: unknown }>;
}): Promise<Set<string>> {
  const keys = new Set<string>();
  const saleMeta = new Map<number, { userId: string; ymd: string }>();
  const groupCount = new Map<string, number>();
  for (const row of input.rows) {
    const saleId = parseSaleId(row.sale_id);
    const userId = String(row.user_id ?? "").trim();
    const ymd = saleDateYmdFromRaw(row.date);
    if (saleId == null || !userId || !ymd) continue;
    saleMeta.set(saleId, { userId, ymd });
    const group = `${userId}|${ymd}`;
    groupCount.set(group, (groupCount.get(group) ?? 0) + 1);
  }
  const interesting = [...saleMeta.entries()]
    .filter(([, meta]) => (groupCount.get(`${meta.userId}|${meta.ymd}`) ?? 0) > 1)
    .map(([saleId]) => saleId);
  if (!interesting.length) return keys;

  for (let i = 0; i < interesting.length; i += PURCHASE_SAME_DAY_SENT_CHUNK) {
    const chunk = interesting.slice(i, i + PURCHASE_SAME_DAY_SENT_CHUNK);
    const { data, error } = await input.admin
      .from("arbox_trial_sync_log")
      .select("sale_id, trigger_id")
      .eq("business_id", input.businessId)
      .in("sale_id", chunk);
    if (error) {
      console.error("[leads/arbox-trial-sale-registered] same-day sent lookup failed:", error.message);
      return keys;
    }
    for (const row of data ?? []) {
      const saleId = parseSaleId((row as { sale_id?: unknown }).sale_id);
      const meta = saleId == null ? undefined : saleMeta.get(saleId);
      if (!meta) continue;
      const key = purchaseSameDaySentKey({
        userId: meta.userId,
        saleDateYmd: meta.ymd,
        triggerId: String((row as { trigger_id?: unknown }).trigger_id ?? ""),
      });
      if (key) keys.add(key);
    }
  }
  return keys;
}

/**
 * Out-of-window path: resolve template_triggers purchase rule →
 * delay_days=0 send immediately; delay_days>0 enqueue scheduled_template_sends.
 */
async function sendOpeningTemplateAfterTrialSaleIfConfigured(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  saleId: number;
  saleDate: unknown;
  membershipTypeId: number | null;
  itemType: string | null;
  phoneNumberId: string;
  fullName: string | null;
  sessionId: string | null;
  match?: PurchaseMatchContext;
  /** Configured trial product — never send a purchase-rule template. */
  isTrialProduct?: boolean;
  /** Rules that already have a sync-log row for this sale. */
  skipTriggerIds?: ReadonlySet<string>;
  /** Meta failures so far, per rule, for a sale the next run retries. */
  attemptsByTrigger?: ReadonlyMap<string, number>;
  arboxUserId?: string;
  /** Shared across the cron batch. A hit means this rule already sent for this user today. */
  purchaseSameDaySent?: Set<string>;
}): Promise<OpeningTemplateResult> {
  if (input.isTrialProduct) {
    console.info("[leads/arbox-trial-sale-registered] trial purchase skips purchase template", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
    });
    return { outcome: "skipped_trial_template", dispatch: "no_rule" };
  }
  const allRules = await loadEnabledPurchaseTemplateTriggers(input.admin, input.businessId);
  const matchedRules = matchingPurchaseTemplateTriggerRules(
    allRules,
    input.membershipTypeId,
    input.itemType,
    input.match
  ).filter((rule) => !input.skipTriggerIds?.has(rule.id));

  if (!matchedRules.length) {
    return { outcome: "no_matching_rule", dispatch: "no_rule" };
  }

  let result: OpeningTemplateResult = { outcome: "no_matching_rule", dispatch: "no_rule" };
  for (const matchedRule of matchedRules) {
    const one = await sendOnePurchaseTemplate({ ...input, matchedRule });
    if (one.outcome === "send_failed") return one;
    if (
      one.outcome === "collapsed_same_day" &&
      (result.outcome === "sent" || result.outcome === "deferred")
    ) {
      continue;
    }
    result = one;
  }
  return result;
}

async function sendOnePurchaseTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  saleId: number;
  saleDate: unknown;
  membershipTypeId: number | null;
  itemType: string | null;
  phoneNumberId: string;
  fullName: string | null;
  sessionId: string | null;
  isTrialProduct?: boolean;
  arboxUserId?: string;
  purchaseSameDaySent?: Set<string>;
  attemptsByTrigger?: ReadonlyMap<string, number>;
  matchedRule: PurchaseTemplateTriggerRule;
}): Promise<OpeningTemplateResult> {
  const matchedRule = input.matchedRule;
  const templateName = matchedRule.template_name?.trim() || null;
  let dispatch: OpeningTemplateDispatch = "no_rule";

  if (!templateName) {
    console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
      matched_rule_id: matchedRule?.id ?? "none",
      template_name: templateName ?? "none",
      dispatch: "no_rule",
    });
    return { outcome: "no_matching_rule", dispatch: "no_rule" };
  }

  const sameDayIdentity = {
    userId: String(input.arboxUserId ?? "").trim(),
    saleDateYmd: saleDateYmdFromRaw(input.saleDate),
    triggerId: matchedRule.id,
  };
  if (purchaseTemplateCollapsedForSameDay(input.purchaseSameDaySent, sameDayIdentity)) {
    const seenMark = await markPurchaseSaleSeen({
      admin: input.admin,
      businessId: input.businessId,
      saleId: input.saleId,
      triggerId: matchedRule.id,
      contactId: null,
      nowIso: new Date().toISOString(),
    });
    if (!seenMark.ok) {
      console.error("[leads/arbox-trial-sale-registered] same-day collapse seen failed:", seenMark.error);
      return { outcome: "send_failed", dispatch: "immediate" };
    }
    console.info("[leads/arbox-trial-sale-registered] purchase template collapsed same day", {
      businessId: input.businessId,
      sale_id: input.saleId,
      matched_rule_id: matchedRule.id,
      template_name: templateName,
    });
    return { outcome: "collapsed_same_day", dispatch: "no_rule" };
  }

  if (matchedRule.delay_days > 0) {
    dispatch = "deferred";
    const dueAt = computeDueAt(
      {
        delay_days: matchedRule.delay_days,
        delay_direction: delayDirectionForTrigger("purchase", matchedRule.delay_direction),
      },
      parseSaleEventDate(input.saleDate)
    );
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: matchedRule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildPurchaseScheduledDedupKey(input.businessId, matchedRule.id, input.saleId),
    });

    console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
      matched_rule_id: matchedRule.id,
      template_name: templateName,
      dispatch,
      delay_days: matchedRule.delay_days,
      delay_direction: matchedRule.delay_direction,
      due_at: dueAt.toISOString(),
      enqueue_ok: enqueueResult.ok,
      enqueue_inserted: enqueueResult.ok ? enqueueResult.inserted : false,
      enqueue_error: enqueueResult.ok ? undefined : enqueueResult.error,
    });

    if (!enqueueResult.ok) {
      return { outcome: "send_failed", dispatch: "deferred" };
    }
    rememberPurchaseSameDaySend(input.purchaseSameDaySent, sameDayIdentity);
    await markPurchaseSaleSeen({
      admin: input.admin,
      businessId: input.businessId,
      saleId: input.saleId,
      triggerId: matchedRule.id,
      contactId: null,
      nowIso: new Date().toISOString(),
    });
    return { outcome: "deferred", dispatch };
  }

  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  if (!phoneNumberId) {
    dispatch = "gated";
    console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
      matched_rule_id: matchedRule.id,
      template_name: templateName,
      dispatch,
      gate: "no_channel",
    });
    return { outcome: "template_not_configured", dispatch };
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
    dispatch = "gated";
    console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
      businessId: input.businessId,
      sale_id: input.saleId,
      membership_type_id: input.membershipTypeId ?? "none",
      matched_rule_id: matchedRule.id,
      template_name: templateName,
      dispatch,
      gate: !wabaId ? "no_waba" : "template_not_approved",
    });
    return { outcome: "template_not_configured", dispatch };
  }

  dispatch = "immediate";
  const firstName = resolveTemplateFirstName(null, input.fullName);
  if (!firstName && templateBodyUsesFirstNameSlot("purchase", (approvedTpl as { components?: unknown }).components)) {
    console.info("[leads/arbox-trial-sale-registered] skip", {
      reason: "no_valid_name",
      sale_id: input.saleId,
    });
    return { outcome: "template_not_configured", dispatch: "gated" };
  }
  const languageCode = String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "purchase",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });

  const claimed = await sendWithSyncLogClaim({
    admin: input.admin,
    ...trialSaleClaimKey(
      input.businessId,
      input.saleId,
      matchedRule.id,
      null,
      input.attemptsByTrigger?.get(matchedRule.id) ?? 0
    ),
    send: async () => {
      const sendResult = await sendBusinessTemplate({
        to: input.phone,
        phoneNumberId,
        templateName,
        alertTriggerId: matchedRule.id,
        languageCode,
        ...(sendComponents ? { components: sendComponents } : {}),
      });
      if (!sendResult.ok) {
        return {
          settle: isSendsHoldError(sendResult.error) ? ("release" as const) : ("failed" as const),
          reason: String(sendResult.error ?? "send_failed").slice(0, 200),
          value: sendResult,
        };
      }
      return { settle: "sent" as const, value: sendResult };
    },
  });

  if (claimed.claim !== "won" || !claimed.value) {
    if (claimed.claim === "error") {
      logDedupBlockedSend({
        log: "[leads/arbox-trial-sale-registered]",
        businessId: input.businessId,
        triggerId: matchedRule.id,
        reason: "claim_failed",
      });
    }
    return { outcome: "no_matching_rule", dispatch: "no_rule" };
  }
  const sendResult = claimed.value;

  console.info("[leads/arbox-trial-sale-registered] template trigger resolution", {
    businessId: input.businessId,
    sale_id: input.saleId,
    membership_type_id: input.membershipTypeId ?? "none",
    matched_rule_id: matchedRule.id,
    template_name: templateName,
    dispatch,
    send_ok: sendResult.ok,
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-trial-sale-registered] template send failed:", sendResult.error);
    if (isSendsHoldError(sendResult.error)) return { outcome: "send_failed", dispatch: "gated" };
    return { outcome: "send_failed", dispatch };
  }

  if (input.sessionId) {
    await logMessage({
      business_slug: input.businessSlug,
      role: "assistant",
      content: formatLeadTemplateMessageContent(templateName, {
        firstName,
        components: storedComponents,
        bodyParams,
      }),
      model_used: LEAD_TEMPLATE_MODEL,
      session_id: input.sessionId,
    });
  }

  rememberPurchaseSameDaySend(input.purchaseSameDaySent, sameDayIdentity);
  return { outcome: "sent" };
}

/** One sale, one rule. The sentinel rule id marks the trial-registration side effects. */
export function trialSaleClaimKey(
  businessId: number,
  saleId: number,
  triggerId: string,
  contactId: string | null = null,
  attempts = 0
): { table: string; row: Record<string, unknown>; filters: Array<[string, string | number]> } {
  return {
    table: "arbox_trial_sync_log",
    row: {
      business_id: businessId,
      sale_id: saleId,
      trigger_id: triggerId,
      contact_id: contactId,
      processed_at: new Date().toISOString(),
      attempts,
    },
    filters: [
      ["business_id", businessId],
      ["sale_id", saleId],
      ["trigger_id", triggerId],
    ],
  };
}

function isWithinTwoDayNotifyThrottle(lastNotifiedAtIso: string | null | undefined): boolean {
  if (!lastNotifiedAtIso) return false;
  const ts = Date.parse(lastNotifiedAtIso);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < MS_2_DAYS;
}

/**
 * רישום לשיעור ניסיון ב-Arbox (salesReport trial membership) → contact בזואי + הודעה.
 * טריגר רכישה נשלח על כל מכירה חדשה שתואמת את הכלל, גם אם האיש כבר רשום,
 * וגם אם הודעת ההרשמה של זואי כבר יצאה (שיעור נקבע לפני התשלום).
 * אותה מכירה לא נשלחת פעמיים (arbox_trial_sync_log לפי sale_id).
 * שתי מכירות של אותו משתמש באותו תאריך מכירה, שמתאימות לאותו כלל, שולחות את הטמפלייט פעם אחת.
 * Arbox הוא מקור האמת — לא שולח חזרה ל-CRM.
 * מכירה עם חוב פתוח לא נחשבת רישום (לינק תשלום / חשבונית) — לא מסמנים seen, כדי שתשלום מאוחר יישלח.
 */
export async function handleArboxTrialSaleRegistered(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  row: ArboxSalesReportRow;
  trialMembershipTypeIds?: readonly number[];
  purchaseMatch?: PurchaseMatchContext;
  /** Shared for this cron batch. Second sale of the same user on the same date does not send again. */
  purchaseSameDaySent?: Set<string>;
}): Promise<ArboxTrialSaleRegisteredResult> {
  const businessId = Number(input.businessId);
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  if (!Number.isFinite(businessId) || businessId <= 0) {
    return { ok: false, error: "invalid_business_id" };
  }
  if (!businessSlug) {
    return { ok: false, error: "missing_business_slug" };
  }

  const saleId = parseSaleId(input.row.sale_id);
  if (saleId == null) {
    return { ok: false, error: "missing_sale_id" };
  }

  if (arboxSaleHasOutstandingDebt(input.row)) {
    console.info("[leads/arbox-trial-sale-registered] skip unpaid sale", {
      businessSlug,
      sale_id: saleId,
      debt: input.row.debt ?? null,
      paid: input.row.paid ?? null,
      price: input.row.price ?? null,
      phone: maskPhoneForLog(String(input.row.phone ?? "")),
    });
    return { ok: true, unpaid: true };
  }

  const arboxUserId = String(input.row.user_id ?? "").trim();
  if (!arboxUserId) {
    return { ok: false, error: "missing_arbox_user_id" };
  }

  const fullName = resolveReportFullName(input.row);
  const membershipTypeId = parseMembershipTypeId(input.row.membership_type_id);
  const itemTypeRaw = String(input.row.item_type ?? "").trim().toLowerCase() || null;

  // 1) Seen check — one row per sale per rule. Any row means trial side effects already ran.
  const { data: existingSeen, error: seenErr } = await input.admin
    .from("arbox_trial_sync_log")
    .select("*")
    .eq("business_id", businessId)
    .eq("sale_id", saleId);

  if (seenErr) {
    console.error("[leads/arbox-trial-sale-registered] seen check failed:", seenErr.message);
    return { ok: false, error: "seen_check_failed" };
  }
  const seenTriggerIds = new Set(
    (existingSeen ?? [])
      .filter((row) => !syncLogRowRetryable((row as { status?: unknown }).status))
      .map((row) => String((row as { trigger_id?: unknown }).trigger_id ?? "").trim())
      .filter(Boolean)
  );
  const saleAlreadyHandled = (existingSeen ?? []).length > 0;
  const attemptsByTrigger = new Map<string, number>();
  for (const row of existingSeen ?? []) {
    const r = row as { status?: unknown; trigger_id?: unknown; attempts?: unknown };
    if (syncLogRowRetryable(r.status)) attemptsByTrigger.set(String(r.trigger_id ?? ""), Number(r.attempts) || 0);
  }

  // 2) Contact lookup
  const contactSelect =
    "id, phone, full_name, trial_registered, session_phase, opted_out, not_relevant_at, instagram_follow_prompt_sent, arbox_user_id, arbox_trial_last_notified_at, sales_flow_started_at";

  let existing: ExistingContactRow | undefined;

  const { data: byArboxRows, error: byArboxErr } = await input.admin
    .from("contacts")
    .select(contactSelect)
    .eq("business_id", businessId)
    .eq("arbox_user_id", arboxUserId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (byArboxErr) {
    console.error(
      "[leads/arbox-trial-sale-registered] contact lookup by arbox_user_id failed:",
      byArboxErr.message
    );
    return { ok: false, error: "contact_lookup_failed" };
  }
  existing = byArboxRows?.[0] as ExistingContactRow | undefined;

  const phoneNorm = canonicalContactPhone(input.row.phone);
  let matchedByPhone = false;

  if (!existing && phoneNorm) {
    const phoneVariants = [
      ...new Set([
        ...contactPhoneLookupVariants(input.row.phone),
        ...contactPhoneLookupVariants(phoneNorm),
      ]),
    ];
    const { data: byPhoneRows, error: byPhoneErr } = await input.admin
      .from("contacts")
      .select(contactSelect)
      .eq("business_id", businessId)
      .in("phone", phoneVariants.length ? phoneVariants : [phoneNorm])
      .order("updated_at", { ascending: false })
      .limit(1);

    if (byPhoneErr) {
      console.error(
        "[leads/arbox-trial-sale-registered] contact lookup by phone failed:",
        byPhoneErr.message
      );
      return { ok: false, error: "contact_lookup_failed" };
    }
    existing = byPhoneRows?.[0] as ExistingContactRow | undefined;
    matchedByPhone = Boolean(existing);
  }

  if (existing?.id) {
    const storedArboxId = String(existing.arbox_user_id ?? "").trim();
    if (storedArboxId !== arboxUserId) {
      const { error: idUpErr } = await input.admin
        .from("contacts")
        .update({ arbox_user_id: arboxUserId })
        .eq("id", existing.id);
      if (idUpErr) {
        console.warn(
          "[leads/arbox-trial-sale-registered] arbox_user_id update failed:",
          idUpErr.message
        );
      } else {
        existing.arbox_user_id = arboxUserId;
        if (matchedByPhone && storedArboxId) {
          console.info("[leads/arbox-trial-sale-registered] arbox_user_id updated from phone match", {
            businessSlug,
            phone: maskPhoneForLog(String(existing.phone ?? phoneNorm ?? "")),
            from: storedArboxId,
            to: arboxUserId,
          });
        }
      }
    }
  }

  if (!existing && !phoneNorm) {
    return { ok: false, error: "invalid_phone" };
  }

  if (saleAlreadyHandled) {
    const canonicalPhone = String(existing?.phone ?? phoneNorm ?? "").trim();
    if (!canonicalPhone) return { ok: true, already: true };
    const channel = await resolveSendChannelForContact(input.admin, businessId, canonicalPhone);
    const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
    const sessionId =
      phoneNumberId && canonicalPhone ? buildWaSessionId(phoneNumberId, canonicalPhone) : null;
    const configuredTrial =
      membershipTypeId != null && (input.trialMembershipTypeIds ?? []).includes(membershipTypeId);
    if (configuredTrial) return { ok: true, already: true };
    const templateResult = await sendOpeningTemplateAfterTrialSaleIfConfigured({
      admin: input.admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      saleId,
      saleDate: input.row.date,
      membershipTypeId,
      itemType: itemTypeRaw,
      phoneNumberId,
      fullName,
      sessionId,
      match: input.purchaseMatch,
      isTrialProduct: false,
      skipTriggerIds: seenTriggerIds,
      attemptsByTrigger,
      arboxUserId,
      purchaseSameDaySent: input.purchaseSameDaySent,
    });
    if (
      templateResult.outcome === "no_matching_rule" ||
      templateResult.outcome === "skipped_trial_template" ||
      templateResult.outcome === "collapsed_same_day"
    ) {
      return { ok: true, already: true };
    }
    return {
      ok: true,
      trial_registered_at: new Date().toISOString(),
      whatsapp: templateResult.outcome,
      contact_created: false,
    };
  }

  const alreadyRegistered =
    existing?.trial_registered === true ||
    String(existing?.session_phase ?? "").trim() === "registered";
  if (alreadyRegistered && existing?.id) {
    // Same person, new sale. Do not repeat the trial-registration side effects.
    // A non-trial purchase still sends its purchase templates. A trial product does not.
    const nowIso = new Date().toISOString();
    const contactId = String(existing.id);
    const seenMark = await markPurchaseSaleSeen({
      admin: input.admin,
      businessId,
      saleId,
      triggerId: SALE_LOG_SENTINEL_TRIGGER_ID,
      contactId,
      nowIso,
    });
    if (!seenMark.ok) {
      console.error("[leads/arbox-trial-sale-registered] seen upsert failed:", seenMark.error);
      return { ok: false, error: "seen_upsert_failed" };
    }

    const canonicalPhone = String(existing.phone ?? phoneNorm ?? "").trim();
    const channel = canonicalPhone
      ? await resolveSendChannelForContact(input.admin, businessId, canonicalPhone)
      : null;
    const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
    const sessionId =
      phoneNumberId && canonicalPhone ? buildWaSessionId(phoneNumberId, canonicalPhone) : null;
    const configuredTrial =
      membershipTypeId != null && (input.trialMembershipTypeIds ?? []).includes(membershipTypeId);
    if (configuredTrial) return { ok: true, already: true };
    const templateResult = await sendOpeningTemplateAfterTrialSaleIfConfigured({
      admin: input.admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      saleId,
      saleDate: input.row.date,
      membershipTypeId,
      itemType: itemTypeRaw,
      phoneNumberId,
      fullName,
      sessionId,
      match: input.purchaseMatch,
      isTrialProduct: false,
      skipTriggerIds: seenTriggerIds,
      attemptsByTrigger,
      arboxUserId,
      purchaseSameDaySent: input.purchaseSameDaySent,
    });
    if (templateResult.outcome === "no_matching_rule" || templateResult.outcome === "collapsed_same_day") {
      return { ok: true, already: true };
    }
    console.info("[leads/arbox-trial-sale-registered] repeat purchase template", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      sale_id: saleId,
      outcome: templateResult.outcome,
    });
    return {
      ok: true,
      trial_registered_at: nowIso,
      whatsapp: templateResult.outcome,
      contact_created: false,
    };
  }

  // 3) Mark trial_registered
  const nowIso = new Date().toISOString();
  const hadNotRelevant = Boolean(existing?.not_relevant_at);
  const hadOptedOut = existing?.opted_out === true;

  const patch: Record<string, unknown> = {
    ...buildTrialRegisteredContactPatch(nowIso),
    not_relevant_at: null,
    not_relevant_reason: "",
    human_requested_at: null,
    wa_no_response_at: null,
    updated_at: nowIso,
    arbox_user_id: arboxUserId,
  };
  if (fullName) patch.full_name = fullName;

  let contactCreated = false;
  let contactId = existing?.id ? String(existing.id) : "";
  const canonicalPhone = String(existing?.phone ?? phoneNorm ?? "").trim();
  let lastNotifiedAt = existing?.arbox_trial_last_notified_at ?? null;
  const instagramFollowPromptSent = existing?.instagram_follow_prompt_sent === true;

  if (!existing) {
    const { data: inserted, error: insertErr } = await input.admin
      .from("contacts")
      .insert({
        business_id: businessId,
        phone: phoneNorm,
        full_name: fullName,
        source: "arbox_trial",
        ...patch,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error(
        "[leads/arbox-trial-sale-registered] contact insert failed:",
        insertErr?.message ?? "no_row"
      );
      return { ok: false, error: "contact_upsert_failed" };
    }
    contactId = String((inserted as { id?: string }).id ?? "").trim();
    if (!contactId) {
      return { ok: false, error: "contact_upsert_failed" };
    }
    contactCreated = true;
    lastNotifiedAt = null;
  } else {
    const { error: updateErr } = await input.admin
      .from("contacts")
      .update(patch)
      .eq("business_id", businessId)
      .eq("id", existing.id);
    if (updateErr) {
      console.error("[leads/arbox-trial-sale-registered] contact update failed:", updateErr.message);
      return { ok: false, error: "contact_upsert_failed" };
    }
  }

  if (hadNotRelevant || hadOptedOut) {
    console.info("[leads/arbox-trial-sale-registered] arbox overrode zoe status", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      had_not_relevant: hadNotRelevant,
      had_opted_out: hadOptedOut,
    });
  }

  // 4) Claim the sale before any WhatsApp. A run that loses the claim stops here.
  const saleKey = trialSaleClaimKey(businessId, saleId, SALE_LOG_SENTINEL_TRIGGER_ID, contactId);
  const saleClaim = await claimSyncLogBeforeSend({ admin: input.admin, ...saleKey });
  if (saleClaim === "lost") return { ok: true, already: true };
  if (saleClaim === "error") {
    console.error("[leads/arbox-trial-sale-registered] sale claim failed", { businessSlug, sale_id: saleId });
    return { ok: false, error: "seen_upsert_failed" };
  }
  const settleSale = (outcome: SyncLogSettle, reason?: string) =>
    settleSyncLogClaim({ admin: input.admin, ...saleKey, outcome, reason: reason ?? null });

  const channel = await resolveSendChannelForContact(input.admin, businessId, canonicalPhone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  const sessionId =
    phoneNumberId && canonicalPhone ? buildWaSessionId(phoneNumberId, canonicalPhone) : null;

  await logMessage({
    business_slug: businessSlug,
    role: "event",
    content: HEYZOE_SF_REGISTERED,
    model_used: "sf_registered_arbox_sale",
    session_id: sessionId,
  });

  // 6) Notify: a trial purchase sends only the free in-window message.
  // A non-trial purchase sends its purchase templates.
  const { data: business } = await input.admin
    .from("businesses")
    .select("id, plan, arbox_trial_membership_type_ids, social_links, crm_api_key, crm_api_key_enc, crm_box_id")
    .eq("id", businessId)
    .maybeSingle();

  const trialMembershipTypeIds = (() => {
    const raw = (business as { arbox_trial_membership_type_ids?: unknown } | null)
      ?.arbox_trial_membership_type_ids;
    if (!Array.isArray(raw)) return [] as number[];
    return raw
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
  })();
  const isTrialSale =
    membershipTypeId != null && trialMembershipTypeIds.includes(membershipTypeId);

  let whatsapp:
    | "sent"
    | "no_channel"
    | "outside_24h_window"
    | "no_user_session"
    | "send_failed"
    | "template_not_configured"
    | "no_matching_rule"
    | "collapsed_same_day"
    | "deferred"
    | "opted_out"
    | "skipped_zoe_confirm"
    | "skipped_trial_template";

  let saleHeld = false;
  if (isTrialSale) {
    const trialTaskTypeId = arboxTrialTaskTypeIdFromSocial(
      (business as { social_links?: unknown } | null)?.social_links
    );
    if (
      shouldOpenArboxTrialPurchaseTask({
        isTrialProduct: true,
        salesFlowStartedAt: existing?.sales_flow_started_at,
        taskTypeId: trialTaskTypeId,
      })
    ) {
      const taskTypeNum = Number.parseInt(trialTaskTypeId, 10);
      const eventDateIl = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date());
      const taskOk = await createArboxCrmTask({
        apiKey: getArboxApiKey(business),
        boxId: String((business as { crm_box_id?: unknown } | null)?.crm_box_id ?? ""),
        taskTypeId: taskTypeNum,
        userId: arboxUserId,
        kind: "trial_registered",
        noteText: buildCrmEventNote("trial_registered", eventDateIl, {
          offerKind: "trial",
          serviceName: String(input.row.item_name ?? "").trim() || null,
        }),
      });
      if (!taskOk) {
        console.error("[leads/arbox-trial-sale-registered] trial task create failed", {
          businessSlug,
          sale_id: saleId,
          taskTypeId: taskTypeNum,
        });
      } else {
        console.info("[leads/arbox-trial-sale-registered] trial task created", {
          businessSlug,
          sale_id: saleId,
          taskTypeId: taskTypeNum,
        });
      }
    }
    // Trial welcome stays once per 2 days. Purchase templates are not throttled.
    if (isWithinTwoDayNotifyThrottle(lastNotifiedAt)) {
      await settleSale("skipped", "throttled_2d");
      console.info("[leads/arbox-trial-sale-registered] notify throttled (2d)", {
        businessSlug,
        phone: maskPhoneForLog(canonicalPhone),
        sale_id: saleId,
      });
      return {
        ok: true,
        trial_registered_at: nowIso,
        whatsapp: "throttled_2d",
        contact_created: contactCreated,
      };
    }
    const priorNotice = canonicalPhone
      ? await loadTrialSignupNotice(input.admin, businessId, canonicalPhone)
      : null;
    const freeAlreadySent = trialPurchaseTemplateBlockedByZoe(priorNotice);
    const sendFreeMessage = planTrialRegistrationSends({
      source: "purchase",
      isTrialProduct: true,
      inWindow: true,
      freeAlreadySent,
      classStarted: false,
      trialBookedRuleCount: 0,
      purchaseRuleCount: 0,
    }).freeMessage;
    if (!sendFreeMessage) {
      console.info("[leads/arbox-trial-sale-registered] trial purchase free message already sent", {
        businessSlug,
        sale_id: saleId,
      });
      whatsapp = "skipped_zoe_confirm";
    } else {
      const waResult = await sendTrialRegisteredWhatsAppReplyIfInWindow({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: canonicalPhone,
        instagramFollowPromptSent,
        businessPlan: (business as { plan?: unknown } | null)?.plan,
      });
      if (!waResult.sent && waResult.reason === "sends_hold") saleHeld = true;

      if (waResult.sent) {
        whatsapp = "sent";
      } else if (waResult.reason === "trial_template_already_sent") {
        whatsapp = "skipped_zoe_confirm";
      } else if (waResult.reason === "send_failed") {
        whatsapp = "send_failed";
      } else if (waResult.reason === "sends_hold") {
        whatsapp = "send_failed";
      } else if (waResult.reason === "opted_out") {
        whatsapp = "opted_out";
      } else {
        whatsapp = waResult.reason;
      }
    }
  } else {
    // Non-trial purchase (membership/punch-card): template-only — skip trial freeform
    const templateResult = await sendOpeningTemplateAfterTrialSaleIfConfigured({
      admin: input.admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      saleId,
      saleDate: input.row.date,
      membershipTypeId,
      itemType: itemTypeRaw,
      phoneNumberId,
      fullName,
      sessionId,
      match: input.purchaseMatch,
      isTrialProduct: false,
      arboxUserId,
      purchaseSameDaySent: input.purchaseSameDaySent,
    });
    whatsapp = templateResult.outcome;
    saleHeld = templateResult.outcome === "send_failed" && templateResult.dispatch === "gated";
  }

  // The trial side effects above already ran, so only a hold reopens the sale.
  if (saleHeld) await settleSale("release");
  else if (whatsapp === "sent") await settleSale("sent");
  else await settleSale("skipped", whatsapp);

  // 7) Throttle stamp only after a real notify (in-window send or out-of-window template no-op)
  if (whatsapp === "sent" || whatsapp === "template_not_configured") {
    const { error: throttleUpErr } = await input.admin
      .from("contacts")
      .update({ arbox_trial_last_notified_at: nowIso })
      .eq("id", contactId);
    if (throttleUpErr) {
      console.warn(
        "[leads/arbox-trial-sale-registered] arbox_trial_last_notified_at update failed:",
        throttleUpErr.message
      );
    }
  }

  if (whatsapp !== "sent") {
    console.info("[leads/arbox-trial-sale-registered] whatsapp outcome", {
      businessSlug,
      phone: maskPhoneForLog(canonicalPhone),
      sale_id: saleId,
      reason: whatsapp,
    });
  }

  return {
    ok: true,
    trial_registered_at: nowIso,
    whatsapp,
    contact_created: contactCreated,
  };
}
