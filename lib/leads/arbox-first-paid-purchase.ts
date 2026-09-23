/**
 * first_paid_purchase — welcome once, when a lead first buys a membership or
 * punch card that is not a trial.
 *
 * The purchase trigger is different: it fires on the first sale we process for
 * the contact (trial included, if the rule allows it) and then stops.
 *
 * IO (10 businesses, trigger on):
 * - Ongoing: 0 extra Arbox GETs. Sales rows come from the trial-sync fetch
 *   that already runs. One indexed log lookup per qualifying sale in that window.
 * - First enable: +1 activeMembershipsReport +1 sessionsReport (paged), once,
 *   to record current customers without sending.
 * No Claude. No Meta calls except one template send per new customer.
 */
import { logMessage } from "@/lib/analytics";
import {
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import {
  buildSessionsReportPath,
  customerReportsDateRange,
  fetchArboxActiveMembershipsReport,
  isArboxActiveCustomerMembershipStatus,
  isArboxActiveCustomerSessionStatus,
} from "@/lib/leads/arbox-customer-set";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";
import { parseLeadIdFromUserId } from "@/lib/leads/arbox-all-leads-report";
import { isPostTrialConversionSale } from "@/lib/leads/arbox-post-trial-followup";
import { arboxSaleHasOutstandingDebt } from "@/lib/leads/arbox-trial-sale-registered";
import {
  formatDateYmdIsrael,
  membershipTypeNameLooksLikeTrial,
} from "@/lib/leads/arbox-trial-attended";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, canonicalContactPhone } from "@/lib/phone-normalize";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { PurchaseTemplateTriggerRule } from "@/lib/template-triggers-match";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

const LOG = "[leads/arbox-first-paid-purchase]";
const UPSERT_CHUNK = 400;
/** user_id 0 marks "existing customers were recorded" for this business. */
const SEED_SENTINEL_USER_ID = 0;

export type FirstPaidPurchaseSummary = {
  skipped?: boolean;
  skip_reason?: "no_rule" | "seed_failed";
  seeded_customers: number;
  qualifying: number;
  already: number;
  sent: number;
  gated: number;
  no_phone: number;
  errors: number;
};

export function isFirstPaidPurchaseSale(
  row: {
    item_type?: unknown;
    membership_type_id?: unknown;
    item_name?: unknown;
  },
  trialMembershipTypeIds: readonly number[]
): boolean {
  return isPostTrialConversionSale(row, trialMembershipTypeIds);
}

/**
 * Existing customer to record without a welcome.
 * Same-day start is excluded so a first purchase today can still send.
 */
export function existingCustomerUserIdToSeed(
  row: Record<string, unknown>,
  trialMembershipTypeIds: readonly number[],
  todayYmd: string,
  kind: "membership" | "session"
): number | null {
  const active =
    kind === "membership"
      ? isArboxActiveCustomerMembershipStatus(row.status)
      : isArboxActiveCustomerSessionStatus(row.status);
  if (!active) return null;

  const userId = parseLeadIdFromUserId(row.user_id);
  if (userId == null) return null;

  const mid = Number(row.membership_type_id);
  if (Number.isFinite(mid) && mid > 0 && trialMembershipTypeIds.includes(Math.trunc(mid))) {
    return null;
  }

  const name = String(row.membership_type_name ?? row.item_name ?? "").trim();
  if (name && membershipTypeNameLooksLikeTrial(name)) return null;

  const started = String(row.member_since ?? row.start_date ?? "").trim().slice(0, 10);
  if (started && started === todayYmd) return null;

  return userId;
}

export function collectExistingCustomerUserIdsToSeed(input: {
  membershipRows: Record<string, unknown>[];
  sessionRows: Record<string, unknown>[];
  trialMembershipTypeIds: readonly number[];
  todayYmd: string;
}): number[] {
  const ids = new Set<number>();
  for (const row of input.membershipRows) {
    const id = existingCustomerUserIdToSeed(
      row,
      input.trialMembershipTypeIds,
      input.todayYmd,
      "membership"
    );
    if (id != null) ids.add(id);
  }
  for (const row of input.sessionRows) {
    const id = existingCustomerUserIdToSeed(
      row,
      input.trialMembershipTypeIds,
      input.todayYmd,
      "session"
    );
    if (id != null) ids.add(id);
  }
  return [...ids];
}

function saleUserId(row: Record<string, unknown>): number | null {
  return parseLeadIdFromUserId(row.user_id);
}

function saleIdOf(row: Record<string, unknown>): number | null {
  const n = Number(row.sale_id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

async function loadEnabledRule(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<PurchaseTemplateTriggerRule | null> {
  const { data, error } = await admin
    .from("template_triggers")
    .select(
      "id, business_id, trigger_type, product_filter, item_type_filter, delay_days, delay_direction, lookback_days, template_name, enabled, created_at, updated_at"
    )
    .eq("business_id", businessId)
    .eq("trigger_type", "first_paid_purchase")
    .eq("enabled", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error(`${LOG} load rule failed:`, error.message);
    return null;
  }
  const row = (data ?? [])[0] as PurchaseTemplateTriggerRule | undefined;
  return row?.template_name?.trim() ? row : null;
}

async function upsertUserIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  userIds: number[],
  seeded: boolean
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < userIds.length; i += UPSERT_CHUNK) {
    const chunk = userIds.slice(i, i + UPSERT_CHUNK).map((user_id) => ({
      business_id: businessId,
      user_id,
      sale_id: null,
      seeded,
    }));
    const { error } = await admin.from("arbox_first_paid_purchase_log").upsert(chunk, {
      onConflict: "business_id,user_id",
      ignoreDuplicates: true,
    });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function seedExistingCustomers(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  apiKey: string;
  boxId: string;
  trialMembershipTypeIds: readonly number[];
  now: Date;
}): Promise<{ ok: boolean; seeded: number; error?: string }> {
  const memberships = await fetchArboxActiveMembershipsReport({
    apiKey: input.apiKey,
    boxId: input.boxId,
    now: input.now,
  });
  if (!memberships.ok) {
    console.error(`${LOG} memberships seed fetch failed:`, memberships.error);
    return { ok: false, seeded: 0, error: memberships.error };
  }

  const range = customerReportsDateRange(input.now);
  const sessionReport = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.boxId,
    logLabel: "leads/arbox-first-paid-purchase/sessionsReport",
    buildPath: (page) =>
      buildSessionsReportPath({
        fromDate: range.fromDate,
        toDate: range.toDate,
        locationId: input.boxId,
        page,
      }),
  });
  if (!sessionReport.ok) {
    console.error(`${LOG} sessions rows fetch failed`);
    return { ok: false, seeded: 0, error: "arbox_sessions_report_fetch_failed" };
  }

  const userIds = collectExistingCustomerUserIdsToSeed({
    membershipRows: memberships.rows,
    sessionRows: sessionReport.rows,
    trialMembershipTypeIds: input.trialMembershipTypeIds,
    todayYmd: formatDateYmdIsrael(input.now),
  });
  const saved = await upsertUserIds(input.admin, input.businessId, userIds, true);
  if (!saved.ok) {
    console.error(`${LOG} seed upsert failed:`, saved.error);
    return { ok: false, seeded: 0, error: saved.error };
  }

  const { error: flagErr } = await input.admin.from("arbox_first_paid_purchase_log").upsert(
    {
      business_id: input.businessId,
      user_id: SEED_SENTINEL_USER_ID,
      sale_id: null,
      seeded: true,
    },
    { onConflict: "business_id,user_id", ignoreDuplicates: true }
  );
  if (flagErr) {
    console.error(`${LOG} seed marker failed:`, flagErr.message);
    return { ok: false, seeded: userIds.length, error: flagErr.message };
  }
  return { ok: true, seeded: userIds.length };
}

async function isCustomerSeedDone(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<boolean> {
  const { data, error } = await admin
    .from("arbox_first_paid_purchase_log")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("user_id", SEED_SENTINEL_USER_ID)
    .maybeSingle();
  if (error) {
    console.error(`${LOG} seed marker lookup failed:`, error.message);
    throw new Error(error.message);
  }
  return Boolean(data);
}

export async function hasEnabledFirstPaidPurchaseTrigger(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<boolean> {
  const { data, error } = await admin
    .from("template_triggers")
    .select("id")
    .eq("business_id", businessId)
    .eq("trigger_type", "first_paid_purchase")
    .eq("enabled", true)
    .limit(1);
  if (error) {
    console.error(`${LOG} enabled lookup failed:`, error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

async function knownUserIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  userIds: number[]
): Promise<Set<number>> {
  const known = new Set<number>();
  for (let i = 0; i < userIds.length; i += UPSERT_CHUNK) {
    const chunk = userIds.slice(i, i + UPSERT_CHUNK);
    const { data, error } = await admin
      .from("arbox_first_paid_purchase_log")
      .select("user_id")
      .eq("business_id", businessId)
      .in("user_id", chunk);
    if (error) {
      console.error(`${LOG} known users lookup failed:`, error.message);
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      const id = Number((row as { user_id?: unknown }).user_id);
      if (Number.isFinite(id)) known.add(id);
    }
  }
  return known;
}

function reportFullName(row: Record<string, unknown>): string | null {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

async function sendWelcome(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  phone: string;
  fullName: string | null;
  templateName: string;
}): Promise<"sent" | "gated" | "send_failed"> {
  const channel = await resolveSendChannelForContact(input.admin, input.businessId, input.phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return "gated";

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    input.admin.from("businesses").select("waba_id, name").eq("id", input.businessId).maybeSingle(),
    input.admin
      .from("whatsapp_templates")
      .select("id, status, language, components")
      .eq("business_id", input.businessId)
      .eq("name", input.templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
  ]);
  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!wabaId || !approvedTpl?.id) return "gated";

  const firstName = firstNameFromFullName(String(input.fullName ?? ""));
  const languageCode = String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "first_paid_purchase",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });

  const sendResult = await sendBusinessTemplate({
    to: input.phone,
    phoneNumberId,
    templateName: input.templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });
  if (!sendResult.ok) {
    console.error(`${LOG} template send failed:`, sendResult.error, {
      businessId: input.businessId,
    });
    return "send_failed";
  }

  const sessionId = buildWaSessionId(phoneNumberId, input.phone);
  await logMessage({
    business_slug: input.businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(input.templateName, {
      firstName,
      components: storedComponents,
      bodyParams,
    }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: sessionId,
  });
  return "sent";
}

export async function syncFirstPaidPurchasesForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  apiKey: string;
  boxId: string;
  trialMembershipTypeIds: readonly number[];
  salesRows: Record<string, unknown>[];
  salesSyncSeeded: boolean;
  now: Date;
}): Promise<FirstPaidPurchaseSummary> {
  const summary: FirstPaidPurchaseSummary = {
    seeded_customers: 0,
    qualifying: 0,
    already: 0,
    sent: 0,
    gated: 0,
    no_phone: 0,
    errors: 0,
  };

  const rule = await loadEnabledRule(input.admin, input.businessId);
  if (!rule) {
    summary.skipped = true;
    summary.skip_reason = "no_rule";
    return summary;
  }

  let alreadySeeded = false;
  try {
    alreadySeeded = await isCustomerSeedDone(input.admin, input.businessId);
  } catch {
    summary.skipped = true;
    summary.skip_reason = "seed_failed";
    summary.errors += 1;
    return summary;
  }

  if (!alreadySeeded) {
    const seed = await seedExistingCustomers({
      admin: input.admin,
      businessId: input.businessId,
      apiKey: input.apiKey,
      boxId: input.boxId,
      trialMembershipTypeIds: input.trialMembershipTypeIds,
      now: input.now,
    });
    summary.seeded_customers = seed.seeded;
    if (!seed.ok) {
      summary.skipped = true;
      summary.skip_reason = "seed_failed";
      summary.errors += 1;
      return summary;
    }
  }

  const qualifying = input.salesRows.filter((row) => {
    if (arboxSaleHasOutstandingDebt(row)) return false;
    return isFirstPaidPurchaseSale(row, input.trialMembershipTypeIds);
  });
  summary.qualifying = qualifying.length;
  if (!qualifying.length) return summary;

  const userIds = [
    ...new Set(qualifying.map(saleUserId).filter((id): id is number => id != null)),
  ];

  let known: Set<number>;
  try {
    known = await knownUserIds(input.admin, input.businessId, userIds);
  } catch {
    summary.errors += 1;
    return summary;
  }

  const toRemember: number[] = [];
  for (const row of qualifying) {
    const userId = saleUserId(row);
    const saleId = saleIdOf(row);
    if (userId == null || saleId == null) {
      summary.errors += 1;
      continue;
    }
    if (known.has(userId)) {
      summary.already += 1;
      continue;
    }
    known.add(userId);

    if (!input.salesSyncSeeded) {
      toRemember.push(userId);
      continue;
    }

    const phone = canonicalContactPhone(row.phone);
    if (!phone) {
      summary.no_phone += 1;
      console.info(`${LOG} no_phone`, { businessId: input.businessId, user_id: userId, sale_id: saleId });
      toRemember.push(userId);
      continue;
    }

    const outcome = await sendWelcome({
      admin: input.admin,
      businessId: input.businessId,
      businessSlug: input.businessSlug,
      phone,
      fullName: reportFullName(row),
      templateName: String(rule.template_name ?? "").trim(),
    });
    if (outcome !== "sent") {
      if (outcome === "gated") summary.gated += 1;
      else summary.errors += 1;
      known.delete(userId);
      continue;
    }

    const { error: claimErr } = await input.admin.from("arbox_first_paid_purchase_log").insert({
      business_id: input.businessId,
      user_id: userId,
      sale_id: saleId,
      seeded: false,
    });
    if (claimErr) {
      const duplicate = String(claimErr.code ?? "") === "23505" || /duplicate/i.test(claimErr.message);
      if (!duplicate) {
        console.error(`${LOG} log insert failed after send:`, claimErr.message, {
          user_id: userId,
          sale_id: saleId,
        });
        summary.errors += 1;
      }
    }
    summary.sent += 1;
  }

  if (toRemember.length) {
    const saved = await upsertUserIds(input.admin, input.businessId, toRemember, true);
    if (!saved.ok) {
      summary.errors += 1;
      console.error(`${LOG} remember users failed:`, saved.error);
    }
  }

  return summary;
}
