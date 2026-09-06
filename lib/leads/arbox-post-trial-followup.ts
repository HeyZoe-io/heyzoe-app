/**
 * C5 registered_after_trial + C6 not_registered_after_trial.
 * Trial attendance (bookingsReport Yes) × post-trial plan/session sale (salesReport).
 * Replaces legacy trial_attended. delay_days = conversion decision window after class_date.
 */
import { fetchAllArboxMembershipTypes, membershipTypeNameById } from "@/lib/arbox-membership-types";
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
import { fetchAllSalesReportRows } from "@/lib/leads/arbox-sales-report";
import type { ArboxSalesReportRow } from "@/lib/leads/arbox-trial-sale-registered";
import {
  bookingMatchesTrialScope,
  fetchArboxBookingsReport,
  formatDateYmdIsrael,
  isBookingCheckedIn,
  membershipTypeNameLooksLikeTrial,
  normalizeMembershipTypeName,
  parseClassDateYmd,
  trialAttendedLookbackDays,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import {
  buildPostTrialFollowupScheduledDedupKey,
  computeDueAt,
  enqueueScheduledTemplateSend,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledNotRegisteredAfterTrialTemplateTriggers,
  loadEnabledRegisteredAfterTrialTemplateTriggers,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SEED_SPAN_DAYS = 30;

export type PostTrialOutcome = "registered" | "not_registered";
export type PostTrialTriggerType = "registered_after_trial" | "not_registered_after_trial";

export type PostTrialAttendance = {
  userId: number;
  classDateYmd: string;
  className: string | null;
  sampleRow: ArboxBookingReportRow;
};

export type PostTrialSyncSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "missing_credentials";
  lookback_from?: string;
  lookback_to?: string;
  sales_from?: string;
  sales_to?: string;
  fetched_bookings: number;
  fetched_sales: number;
  pages_fetched: number;
  trial_attended: number;
  due: number;
  seeded: number;
  soft_seeded: number;
  processed: number;
  already: number;
  notified: number;
  deferred: number;
  gated: number;
  no_phone: number;
  abandoned: number;
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

export function ymdCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function postTrialDecisionYmd(classDateYmd: string, delayDays: number): string | null {
  const d = Math.max(0, Math.trunc(delayDays));
  return addDaysYmd(classDateYmd, d);
}

export function isPostTrialDecisionDue(input: {
  classDateYmd: string;
  delayDays: number;
  todayYmd: string;
}): boolean {
  const decision = postTrialDecisionYmd(input.classDateYmd, input.delayDays);
  if (!decision) return false;
  return ymdCmp(input.todayYmd, decision) >= 0;
}

/**
 * True conversion after trial: plan or session purchase that is NOT a trial product.
 * item_type=trial never counts; membership_type_id in trial ids / trial-like name excluded.
 */
export function isPostTrialConversionSale(
  row: {
    item_type?: unknown;
    membership_type_id?: unknown;
    item_name?: unknown;
  },
  trialMembershipTypeIds: readonly number[]
): boolean {
  const itemType = String(row.item_type ?? "")
    .trim()
    .toLowerCase();
  if (itemType === "trial") return false;
  if (itemType !== "plan" && itemType !== "session") return false;

  const midRaw = Number(row.membership_type_id);
  if (Number.isFinite(midRaw) && midRaw > 0) {
    const mid = Math.trunc(midRaw);
    if (trialMembershipTypeIds.includes(mid)) return false;
  }

  const name = String(row.item_name ?? "").trim();
  if (name && membershipTypeNameLooksLikeTrial(name)) return false;

  return true;
}

export function outcomeForTrialAttendance(input: {
  userId: number;
  classDateYmd: string;
  salesRows: readonly ArboxSalesReportRow[];
  trialMembershipTypeIds: readonly number[];
}): PostTrialOutcome {
  for (const sale of input.salesRows) {
    const saleUser = Number(sale.user_id);
    if (!Number.isFinite(saleUser) || Math.trunc(saleUser) !== input.userId) continue;
    const saleYmd = parseClassDateYmd(sale.date);
    if (!saleYmd || ymdCmp(saleYmd, input.classDateYmd) < 0) continue;
    if (!isPostTrialConversionSale(sale, input.trialMembershipTypeIds)) continue;
    return "registered";
  }
  return "not_registered";
}

export function triggerTypeForOutcome(outcome: PostTrialOutcome): PostTrialTriggerType {
  return outcome === "registered" ? "registered_after_trial" : "not_registered_after_trial";
}

export function collectTrialAttendances(input: {
  pastRows: readonly ArboxBookingReportRow[];
  todayYmd: string;
  trialTypeIds: number[];
  trialTypeNamesNormalized: Set<string>;
  trialMatchMode: "ids_names" | "name_fallback";
}): PostTrialAttendance[] {
  const byKey = new Map<string, PostTrialAttendance>();
  for (const row of input.pastRows) {
    const userIdRaw = Number(row.user_id);
    if (!Number.isFinite(userIdRaw) || userIdRaw <= 0) continue;
    const userId = Math.trunc(userIdRaw);
    const classDateYmd = parseClassDateYmd(row.date);
    if (!classDateYmd || classDateYmd >= input.todayYmd) continue;
    if (!isBookingCheckedIn(row.check_in)) continue;

    const isTrial =
      input.trialMatchMode === "name_fallback"
        ? membershipTypeNameLooksLikeTrial(row.membership_type_name)
        : bookingMatchesTrialScope(row, {
            trialTypeIds: input.trialTypeIds,
            trialTypeNamesNormalized: input.trialTypeNamesNormalized,
          });
    if (!isTrial) continue;

    const key = `${userId}|${classDateYmd}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      userId,
      classDateYmd,
      className: String(row.class_name ?? "").trim() || null,
      sampleRow: row,
    });
  }
  return [...byKey.values()];
}

export function postTrialLookbackWindow(input: {
  now: Date;
  needsSeed: boolean;
  maxDelayDays: number;
}): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(input.now);
  const forwardLookback = Math.min(
    30,
    Math.max(
      1,
      Math.trunc(trialAttendedLookbackDays()) + Math.max(0, Math.trunc(input.maxDelayDays))
    )
  );
  const days = input.needsSeed ? SEED_SPAN_DAYS : forwardLookback;
  const [y, m, d] = toDate.split("-").map((n) => Number(n));
  const toUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const fromUtc = new Date(toUtc.getTime() - (days - 1) * MS_PER_DAY);
  const yy = fromUtc.getUTCFullYear();
  const mm = String(fromUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fromUtc.getUTCDate()).padStart(2, "0");
  return { fromDate: `${yy}-${mm}-${dd}`, toDate };
}

function parseIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n))
    ),
  ];
}

function resolveReportFullName(row: ArboxBookingReportRow): string | null {
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

type ContactRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  arbox_user_id: string | null;
};

async function resolveOrCreateContact(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  row: ArboxBookingReportRow;
  source: string;
}): Promise<{ contact: ContactRow | null; phone: string | null }> {
  const contactSelect = "id, phone, full_name, arbox_user_id";
  const arboxUserId = String(input.row.user_id ?? "").trim();
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
      source: input.source,
      arbox_user_id: arboxUserId || null,
      updated_at: nowIso,
    })
    .select(contactSelect)
    .single();
  if (error || !inserted) {
    console.error("[leads/arbox-post-trial-followup] contact insert failed:", error?.message ?? "no_row");
    return { contact: null, phone: phoneNorm };
  }
  return { contact: inserted as ContactRow, phone: phoneNorm };
}

async function upsertFollowupSyncLog(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  userId: number;
  classDateYmd: string;
  outcome: PostTrialOutcome;
  contactId: string | null;
  attempts: number;
  status: CancellationSyncLogStatus;
  nowIso: string;
}): Promise<{ ok: boolean }> {
  const { error } = await input.admin.from("arbox_post_trial_followup_sync_log").upsert(
    {
      business_id: input.businessId,
      user_id: input.userId,
      class_date: input.classDateYmd,
      outcome: input.outcome,
      contact_id: input.contactId,
      processed_at: input.nowIso,
      attempts: input.attempts,
      status: input.status,
    },
    { onConflict: "business_id,user_id,class_date" }
  );
  if (error) {
    console.error("[leads/arbox-post-trial-followup] sync_log upsert failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

function pickNewestRule(rules: PurchaseTemplateTriggerRule[]): PurchaseTemplateTriggerRule | null {
  const withTpl = rules
    .filter((r) => r.template_name?.trim())
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  return withTpl[0] ?? null;
}

async function dispatchFollowupTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  className: string | null;
  userId: number;
  classDateYmd: string;
  outcome: PostTrialOutcome;
  rule: PurchaseTemplateTriggerRule;
  now: Date;
}): Promise<{ dispatch: "immediate" | "deferred" | "gated" | "send_failed" | "no_rule"; ok: boolean }> {
  const templateName = input.rule.template_name?.trim() || "";
  if (!templateName) return { dispatch: "no_rule", ok: false };

  const triggerType = triggerTypeForOutcome(input.outcome);
  // Conversion window already waited via delay_days vs class_date; send immediate on decision day.
  const dueAt = computeDueAt({ delay_days: 0, delay_direction: "after" }, input.now);

  if (dueAt.getTime() > input.now.getTime() + 15_000) {
    const enqueueResult = await enqueueScheduledTemplateSend({
      admin: input.admin,
      businessId: input.businessId,
      triggerId: input.rule.id,
      contactPhone: input.phone,
      templateName,
      dueAt,
      dedupKey: buildPostTrialFollowupScheduledDedupKey(
        input.outcome,
        input.businessId,
        input.rule.id,
        input.userId,
        input.classDateYmd,
        input.className
      ),
    });
    if (!enqueueResult.ok) {
      console.error("[leads/arbox-post-trial-followup] enqueue failed:", enqueueResult.error);
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
    triggerType,
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
    className: input.className,
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  if (!sendResult.ok) {
    console.error("[leads/arbox-post-trial-followup] template send failed:", sendResult.error);
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

/** Soft-seed: outcomes with zero sync_log rows after global seed. */
export async function findPostTrialOutcomesNeedingSoftSeed(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  outcomes: PostTrialOutcome[];
}): Promise<PostTrialOutcome[]> {
  const needing: PostTrialOutcome[] = [];
  for (const outcome of input.outcomes) {
    const { count, error } = await input.admin
      .from("arbox_post_trial_followup_sync_log")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .eq("outcome", outcome);
    if (error) {
      console.error("[leads/arbox-post-trial-followup] soft-seed count failed:", error.message);
      needing.push(outcome);
      continue;
    }
    if ((count ?? 0) === 0) needing.push(outcome);
  }
  return needing;
}

export async function syncArboxPostTrialFollowupForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  postTrialFollowupSeeded: boolean;
  now?: Date;
  prefetchedPastRows?: ArboxBookingReportRow[];
  prefetchedPastPages?: number;
  lookbackFrom?: string;
  lookbackTo?: string;
}): Promise<PostTrialSyncSummary> {
  const summary: PostTrialSyncSummary = {
    fetched_bookings: 0,
    fetched_sales: 0,
    pages_fetched: 0,
    trial_attended: 0,
    due: 0,
    seeded: 0,
    soft_seeded: 0,
    processed: 0,
    already: 0,
    notified: 0,
    deferred: 0,
    gated: 0,
    no_phone: 0,
    abandoned: 0,
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

  const [registeredRules, notRegisteredRules] = await Promise.all([
    loadEnabledRegisteredAfterTrialTemplateTriggers(input.admin, businessId),
    loadEnabledNotRegisteredAfterTrialTemplateTriggers(input.admin, businessId),
  ]);
  const registeredRule = pickNewestRule(registeredRules);
  const notRegisteredRule = pickNewestRule(notRegisteredRules);
  if (!registeredRule && !notRegisteredRule) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  const maxDelayDays = Math.max(
    registeredRule ? Math.max(2, Math.trunc(Number(registeredRule.delay_days) || 0)) : 0,
    notRegisteredRule ? Math.max(2, Math.trunc(Number(notRegisteredRule.delay_days) || 0)) : 0
  );

  const { data: bizRow } = await input.admin
    .from("businesses")
    .select("arbox_trial_membership_type_ids")
    .eq("id", businessId)
    .maybeSingle();
  const businessTrialIds = parseIdList(
    (bizRow as { arbox_trial_membership_type_ids?: unknown } | null)
      ?.arbox_trial_membership_type_ids
  );
  const productFilterIds = parseIdList(
    registeredRule?.product_filter ?? notRegisteredRule?.product_filter
  );
  const trialTypeIds = productFilterIds.length ? productFilterIds : businessTrialIds;

  let trialMatchMode: "ids_names" | "name_fallback" = trialTypeIds.length
    ? "ids_names"
    : "name_fallback";
  const trialTypeNamesNormalized = new Set<string>();
  if (trialTypeIds.length) {
    const typesResult = await fetchAllArboxMembershipTypes({
      apiKey,
      logLabel: "leads/arbox-post-trial-followup",
    });
    const map = typesResult.ok ? membershipTypeNameById(typesResult.types) : new Map<number, string>();
    for (const id of trialTypeIds) {
      const name = map.get(id);
      if (name) trialTypeNamesNormalized.add(normalizeMembershipTypeName(name));
    }
    if (!trialTypeNamesNormalized.size) {
      trialMatchMode = "name_fallback";
    }
  }

  const needsSeed = !input.postTrialFollowupSeeded;
  let pastRows: ArboxBookingReportRow[];
  if (input.prefetchedPastRows) {
    const window = postTrialLookbackWindow({ now, needsSeed, maxDelayDays });
    summary.lookback_from = window.fromDate;
    summary.lookback_to = window.toDate;
    pastRows = input.prefetchedPastRows.filter((row) => {
      const ymd = parseClassDateYmd(row.date);
      return Boolean(ymd && ymd >= window.fromDate && ymd <= window.toDate);
    });
    summary.pages_fetched = input.prefetchedPastPages ?? 0;
  } else {
    const window = postTrialLookbackWindow({ now, needsSeed, maxDelayDays });
    summary.lookback_from = window.fromDate;
    summary.lookback_to = window.toDate;
    const report = await fetchArboxBookingsReport({
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
    pastRows = report.rows;
  }
  summary.fetched_bookings = pastRows.length;

  const salesFrom = summary.lookback_from!;
  const salesTo = summary.lookback_to!;
  summary.sales_from = salesFrom;
  summary.sales_to = salesTo;
  const salesReport = await fetchAllSalesReportRows({
    apiKey,
    fromDate: salesFrom,
    toDate: salesTo,
    locationId: boxId,
  });
  summary.pages_fetched += salesReport.pagesFetched;
  if (!salesReport.ok) {
    summary.fetch_error = salesReport.error;
    summary.errors += 1;
    return summary;
  }
  const salesRows = salesReport.rows as ArboxSalesReportRow[];
  summary.fetched_sales = salesRows.length;

  const attendances = collectTrialAttendances({
    pastRows,
    todayYmd,
    trialTypeIds,
    trialTypeNamesNormalized,
    trialMatchMode,
  });
  summary.trial_attended = attendances.length;

  const enabledOutcomes: PostTrialOutcome[] = [];
  if (registeredRule) enabledOutcomes.push("registered");
  if (notRegisteredRule) enabledOutcomes.push("not_registered");

  let softSeedOutcomes: PostTrialOutcome[] = [];
  if (needsSeed) {
    softSeedOutcomes = [...enabledOutcomes];
  } else {
    softSeedOutcomes = await findPostTrialOutcomesNeedingSoftSeed({
      admin: input.admin,
      businessId,
      outcomes: enabledOutcomes,
    });
  }

  const seedThisRun = softSeedOutcomes.length > 0;

  for (const att of attendances) {
    const outcome = outcomeForTrialAttendance({
      userId: att.userId,
      classDateYmd: att.classDateYmd,
      salesRows,
      trialMembershipTypeIds: trialTypeIds,
    });
    if (!enabledOutcomes.includes(outcome)) continue;

    const rule = outcome === "registered" ? registeredRule : notRegisteredRule;
    if (!rule) continue;
    const delayDays = Math.max(2, Math.trunc(Number(rule.delay_days) || 0));
    if (
      !isPostTrialDecisionDue({
        classDateYmd: att.classDateYmd,
        delayDays,
        todayYmd,
      })
    ) {
      continue;
    }
    summary.due += 1;

    if (seedThisRun && softSeedOutcomes.includes(outcome)) {
      const resolved = await resolveOrCreateContact({
        admin: input.admin,
        businessId,
        row: att.sampleRow,
        source: "arbox_post_trial_followup_seed",
      });
      const up = await upsertFollowupSyncLog({
        admin: input.admin,
        businessId,
        userId: att.userId,
        classDateYmd: att.classDateYmd,
        outcome,
        contactId: resolved.contact?.id ?? null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (up.ok) {
        if (needsSeed) summary.seeded += 1;
        else summary.soft_seeded += 1;
      } else summary.errors += 1;
      continue;
    }

    // Soft-seeded outcomes this run: no forward send.
    if (softSeedOutcomes.includes(outcome)) continue;

    try {
      const { data: existing } = await input.admin
        .from("arbox_post_trial_followup_sync_log")
        .select("status, attempts, outcome")
        .eq("business_id", businessId)
        .eq("user_id", att.userId)
        .eq("class_date", att.classDateYmd)
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
        row: att.sampleRow,
        source: `arbox_${triggerTypeForOutcome(outcome)}`,
      });
      if (!resolved.phone || !resolved.contact?.id) {
        summary.no_phone += 1;
        await upsertFollowupSyncLog({
          admin: input.admin,
          businessId,
          userId: att.userId,
          classDateYmd: att.classDateYmd,
          outcome,
          contactId: resolved.contact?.id ?? null,
          attempts: attemptsSoFar,
          status: "no_phone",
          nowIso,
        });
        continue;
      }

      const send = await dispatchFollowupTemplate({
        admin: input.admin,
        businessId,
        businessSlug,
        phone: resolved.phone,
        fullName: resolveReportFullName(att.sampleRow) ?? resolved.contact.full_name ?? null,
        className: att.className,
        userId: att.userId,
        classDateYmd: att.classDateYmd,
        outcome,
        rule,
        now,
      });

      const mapped =
        send.dispatch === "immediate"
          ? ("immediate" as const)
          : send.dispatch === "deferred"
            ? ("deferred" as const)
            : send.dispatch === "gated"
              ? ("gated" as const)
              : send.dispatch === "send_failed"
                ? ("send_failed" as const)
                : ("gated" as const);

      const next = nextCancellationSyncLogAfterDispatch({
        dispatch: mapped,
        attemptsSoFar,
      });
      await upsertFollowupSyncLog({
        admin: input.admin,
        businessId,
        userId: att.userId,
        classDateYmd: att.classDateYmd,
        outcome,
        contactId: resolved.contact.id,
        attempts: next.attempts,
        status: next.status,
        nowIso,
      });

      summary.processed += 1;
      if (send.dispatch === "immediate") summary.notified += 1;
      else if (send.dispatch === "deferred") summary.deferred += 1;
      else if (send.dispatch === "gated") summary.gated += 1;
      else if (send.dispatch === "send_failed") {
        if (next.hitCap) summary.abandoned += 1;
        else summary.errors += 1;
      }

      console.info("[leads/arbox-post-trial-followup] dispatch", {
        businessId,
        outcome,
        user_id: att.userId,
        class_date: att.classDateYmd,
        contact: maskPhoneForLog(resolved.phone),
        dispatch: send.dispatch,
        status: next.status,
      });
    } catch (e) {
      summary.errors += 1;
      console.error("[leads/arbox-post-trial-followup] row threw", {
        businessId,
        user_id: att.userId,
        class_date: att.classDateYmd,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Soft-seed empty cohort: sentinel rows (fixed class_date per outcome; PK has no outcome).
  if (!needsSeed) {
    for (const outcome of softSeedOutcomes) {
      const { count } = await input.admin
        .from("arbox_post_trial_followup_sync_log")
        .select("user_id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("outcome", outcome);
      if ((count ?? 0) > 0) continue;
      const sentinel = await upsertFollowupSyncLog({
        admin: input.admin,
        businessId,
        userId: 0,
        classDateYmd: outcome === "registered" ? "1970-01-01" : "1970-01-02",
        outcome,
        contactId: null,
        attempts: 0,
        status: "seeded",
        nowIso,
      });
      if (sentinel.ok) summary.soft_seeded += 1;
      else summary.errors += 1;
    }
  }

  if (needsSeed) {
    const { error: seedFlagErr } = await input.admin
      .from("businesses")
      .update({ arbox_post_trial_followup_seeded: true })
      .eq("id", businessId);
    if (seedFlagErr) {
      console.error("[leads/arbox-post-trial-followup] seed flag update failed:", seedFlagErr.message);
      summary.errors += 1;
    }
    console.info("[leads/arbox-post-trial-followup] seeded decision-due attendances", {
      businessId,
      businessSlug,
      seeded: summary.seeded,
    });
    return summary;
  }

  warnAbandonedCancellationSyncLog({
    businessId,
    abandoned: summary.abandoned,
    reason: "post_trial_followup_send_failed_cap",
  });

  return summary;
}
