import { fetchAllArboxMembershipTypes } from "@/lib/arbox-membership-types";
import { fetchAllSalesReportRows } from "@/lib/leads/arbox-sales-report";
import {
  hasEnabledFirstPaidPurchaseTrigger,
  syncFirstPaidPurchasesForBusiness,
} from "@/lib/leads/arbox-first-paid-purchase";
import {
  arboxSaleHasOutstandingDebt,
  handleArboxTrialSaleRegistered,
  type ArboxSalesReportRow,
} from "@/lib/leads/arbox-trial-sale-registered";
import { syncArboxCreditRefusalsForBusiness } from "@/lib/leads/arbox-credit-refusal";
import { syncArboxNewLeadsForBusiness } from "@/lib/leads/arbox-new-lead";
import { syncArboxMembershipCancelledForBusiness } from "@/lib/leads/arbox-membership-cancelled";
import {
  syncTrialBookingConfirmForBusiness,
  trialBookingConfirmEnabled,
} from "@/lib/leads/arbox-trial-booking-confirm";
import {
  canonicalContactPhone,
  contactPhoneLookupVariants,
} from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledPurchaseTemplateTriggers,
  loadTrialBookedBusinessIds,
  purchaseSaleMembershipScopeIsEmpty,
  resolvePurchaseSaleMembershipScope,
  saleMembershipTypeInScope,
  type PurchaseMatchContext,
  type PurchaseSaleMembershipScope,
} from "@/lib/template-triggers-match";
import { isPurchaseItemType, type PurchaseItemType } from "@/lib/trigger-catalog";

/**
 * One Arbox business for /api/cron/arbox-trial-sync.
 * Scheduling stays on cron-job.org → the dispatcher URL. Not vercel.json.
 */

const MS_24H = 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Arbox salesReport: date range must not exceed 31 days (API returns 400). */
const MAX_SALES_REPORT_SPAN_DAYS = 30;
const ISRAEL_TZ = "Asia/Jerusalem";

export type BusinessRow = {
  id: number;
  slug: string;
  crm_api_key: string;
  crm_box_id: string;
  arbox_last_sync_at: string | null;
  arbox_trial_membership_type_ids: number[];
  arbox_sales_sync_seeded: boolean;
  arbox_credit_refusal_seeded: boolean;
  arbox_leads_seeded: boolean;
  arbox_cancellation_seeded: boolean;
};

export type BusinessSummary = {
  business_id: number;
  slug: string;
  skipped?: boolean;
  fetched: number;
  processed: number;
  already: number;
  unpaid: number;
  seeded: number;
  seed_without_contact: number;
  errors: number;
  pages_fetched: number;
  cursor_advanced: boolean;
  fetch_error?: string;
  credit_refusal?: Awaited<ReturnType<typeof syncArboxCreditRefusalsForBusiness>>;
  new_lead?: Awaited<ReturnType<typeof syncArboxNewLeadsForBusiness>>;
  first_paid_purchase?: Awaited<ReturnType<typeof syncFirstPaidPurchasesForBusiness>>;
  trial_booking_confirm?: Awaited<ReturnType<typeof syncTrialBookingConfirmForBusiness>>;
  membership_cancelled?: Awaited<ReturnType<typeof syncArboxMembershipCancelledForBusiness>>;
};

function formatDateYmdIsrael(d: Date): string {
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

/** Ensures fromDate→toDate span is within Arbox salesReport limit (≤31 calendar days). */
function clampSalesReportDateRange(input: { fromDate: string; toDate: string }): {
  fromDate: string;
  toDate: string;
} {
  const fromMs = parseYmdUtcMs(input.fromDate);
  const toMs = parseYmdUtcMs(input.toDate);
  if (fromMs == null || toMs == null) return input;
  const spanDays = Math.floor((toMs - fromMs) / MS_PER_DAY);
  if (spanDays <= MAX_SALES_REPORT_SPAN_DAYS) return input;
  const clampedFrom = new Date(toMs - MAX_SALES_REPORT_SPAN_DAYS * MS_PER_DAY);
  return { fromDate: formatDateYmdIsrael(clampedFrom), toDate: input.toDate };
}

function resolveReportDateRange(input: {
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
      fromDate = formatDateYmdIsrael(new Date(input.now.getTime() - MS_24H));
    }
  } else {
    fromDate = formatDateYmdIsrael(new Date(input.now.getTime() - MS_24H));
  }
  return clampSalesReportDateRange({ fromDate, toDate });
}

function parseTrialMembershipTypeIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const item of raw) {
    const n = Number(item);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
}

function saleMembershipTypeId(row: Record<string, unknown>): number | null {
  const n = Number(row.membership_type_id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Filter salesReport rows to the business purchase/trial membership scope (not fetch mechanics). */
function filterSalesRowsForMembershipScope(
  rows: Record<string, unknown>[],
  scope: PurchaseSaleMembershipScope
): Record<string, unknown>[] {
  return rows.filter((row) => saleMembershipTypeInScope(saleMembershipTypeId(row), scope));
}

async function findExistingContactIdForSale(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  arboxUserId: string;
  phoneRaw: unknown;
}): Promise<string | null> {
  const arboxUserId = String(input.arboxUserId ?? "").trim();
  if (arboxUserId) {
    const { data: byArboxRows, error: byArboxErr } = await input.admin
      .from("contacts")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("arbox_user_id", arboxUserId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (byArboxErr) {
      console.error("[cron/arbox-trial-sync] seed contact lookup by arbox_user_id failed:", byArboxErr.message);
      return null;
    }
    const id = String((byArboxRows?.[0] as { id?: string } | undefined)?.id ?? "").trim();
    if (id) return id;
  }

  const phoneNorm = canonicalContactPhone(input.phoneRaw);
  if (!phoneNorm) return null;

  const phoneVariants = [
    ...new Set([
      ...contactPhoneLookupVariants(input.phoneRaw),
      ...contactPhoneLookupVariants(phoneNorm),
    ]),
  ];
  const { data: byPhoneRows, error: byPhoneErr } = await input.admin
    .from("contacts")
    .select("id")
    .eq("business_id", input.businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [phoneNorm])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (byPhoneErr) {
    console.error("[cron/arbox-trial-sync] seed contact lookup by phone failed:", byPhoneErr.message);
    return null;
  }
  const id = String((byPhoneRows?.[0] as { id?: string } | undefined)?.id ?? "").trim();
  return id || null;
}

function parseSaleId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/**
 * First sales pass: mark every filtered trial sale_id as seen — no WhatsApp, no contacts created,
 * no trial_registered, no arbox_trial_last_notified_at. contact_id filled only when a match exists.
 */
async function seedTrialSalesForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  trialRows: Record<string, unknown>[];
  nowIso: string;
}): Promise<{ seeded: number; seed_without_contact: number; seed_errors: number }> {
  let seeded = 0;
  let seed_without_contact = 0;
  let seed_errors = 0;

  for (const rawRow of input.trialRows) {
    if (arboxSaleHasOutstandingDebt(rawRow)) continue;

    const saleId = parseSaleId(rawRow.sale_id);
    if (saleId == null) {
      seed_errors += 1;
      console.error("[cron/arbox-trial-sync] seed skipped — missing sale_id", {
        slug: input.businessSlug,
        user_id: String(rawRow.user_id ?? ""),
      });
      continue;
    }

    const arboxUserId = String(rawRow.user_id ?? "").trim();
    const contactId = await findExistingContactIdForSale({
      admin: input.admin,
      businessId: input.businessId,
      arboxUserId,
      phoneRaw: rawRow.phone,
    });

    if (!contactId) seed_without_contact += 1;

    const { error: upsertErr } = await input.admin.from("arbox_trial_sync_log").upsert(
      {
        business_id: input.businessId,
        sale_id: saleId,
        contact_id: contactId,
        processed_at: input.nowIso,
      },
      { onConflict: "business_id,sale_id" }
    );

    if (upsertErr) {
      seed_errors += 1;
      console.error("[cron/arbox-trial-sync] seed seen upsert failed", {
        slug: input.businessSlug,
        sale_id: saleId,
        contact_id: contactId,
        error: upsertErr.message,
      });
      continue;
    }
    seeded += 1;
  }

  return { seeded, seed_without_contact, seed_errors };
}

/** Steps whose enabled rule (with a template name) qualifies a business for a worker. */
export const ARBOX_TRIAL_SYNC_TRIGGER_TYPES = [
  "purchase",
  "first_paid_purchase",
  "credit_refusal",
  "arbox_new_lead",
  "trial_booked",
  "membership_cancelled",
] as const;

const BUSINESS_SELECT =
  "id, slug, crm_api_key, crm_box_id, arbox_last_sync_at, arbox_trial_membership_type_ids, arbox_sales_sync_seeded, arbox_credit_refusal_seeded, arbox_leads_seeded, arbox_cancellation_seeded";

function parseBusinessRow(row: Record<string, unknown>): BusinessRow | null {
  const id = Number(row.id);
  const slug = String(row.slug ?? "").trim().toLowerCase();
  const apiKey = String(row.crm_api_key ?? "").trim();
  const boxId = String(row.crm_box_id ?? "").trim();
  if (!Number.isFinite(id) || id <= 0 || !slug || !apiKey || !boxId) return null;
  if (String(row.crm_type ?? "arbox") !== "arbox") return null;
  return {
    id,
    slug,
    crm_api_key: apiKey,
    crm_box_id: boxId,
    arbox_last_sync_at: (row.arbox_last_sync_at as string | null) ?? null,
    arbox_trial_membership_type_ids: parseTrialMembershipTypeIds(row.arbox_trial_membership_type_ids),
    arbox_sales_sync_seeded: row.arbox_sales_sync_seeded === true,
    arbox_credit_refusal_seeded: row.arbox_credit_refusal_seeded === true,
    arbox_leads_seeded: row.arbox_leads_seeded === true,
    arbox_cancellation_seeded: row.arbox_cancellation_seeded === true,
  };
}

/** True when this cron would call Arbox for the business. */
export function trialSyncBusinessNeedsWorker(input: {
  trialMembershipTypeIds: readonly number[];
  enabledTriggerTypes: readonly string[];
}): boolean {
  if (input.trialMembershipTypeIds.length > 0) return true;
  return input.enabledTriggerTypes.some((type) =>
    (ARBOX_TRIAL_SYNC_TRIGGER_TYPES as readonly string[]).includes(type)
  );
}

/**
 * Arbox businesses that would make an Arbox call in this cron.
 * Enabled rule with a template name, or configured trial membership ids
 * (the sales report still runs for those without a purchase rule).
 * The trial-booking step itself runs only for an enabled trial_booked rule.
 */
export async function listArboxTrialSyncBusinessIds(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  const { data: businessRows, error: bizErr } = await admin
    .from("businesses")
    .select(`crm_type, ${BUSINESS_SELECT}`)
    .eq("crm_type", "arbox")
    .not("crm_api_key", "is", null)
    .not("crm_box_id", "is", null);
  if (bizErr) return { ok: false, error: bizErr.message };

  const businesses: BusinessRow[] = [];
  for (const row of businessRows ?? []) {
    const parsed = parseBusinessRow({ ...(row as Record<string, unknown>), crm_type: "arbox" });
    if (parsed) businesses.push(parsed);
  }
  if (!businesses.length) return { ok: true, ids: [] };

  const { data: rules, error: ruleErr } = await admin
    .from("template_triggers")
    .select("business_id, trigger_type, template_name")
    .in(
      "business_id",
      businesses.map((b) => b.id)
    )
    .eq("enabled", true)
    .in("trigger_type", [...ARBOX_TRIAL_SYNC_TRIGGER_TYPES]);
  if (ruleErr) return { ok: false, error: ruleErr.message };

  const typesByBusiness = new Map<number, string[]>();
  for (const row of rules ?? []) {
    if (!String((row as { template_name?: unknown }).template_name ?? "").trim()) continue;
    const id = Number((row as { business_id?: unknown }).business_id);
    const type = String((row as { trigger_type?: unknown }).trigger_type ?? "");
    if (!Number.isFinite(id) || !type) continue;
    const list = typesByBusiness.get(id) ?? [];
    list.push(type);
    typesByBusiness.set(id, list);
  }

  return {
    ok: true,
    ids: businesses
      .filter((b) =>
        trialSyncBusinessNeedsWorker({
          trialMembershipTypeIds: b.arbox_trial_membership_type_ids,
          enabledTriggerTypes: typesByBusiness.get(b.id) ?? [],
        })
      )
      .map((b) => b.id),
  };
}

export async function loadArboxTrialSyncBusiness(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<BusinessRow | null> {
  const { data, error } = await admin
    .from("businesses")
    .select(BUSINESS_SELECT)
    .eq("id", businessId)
    .eq("crm_type", "arbox")
    .maybeSingle();
  if (error || !data) return null;
  return parseBusinessRow({ ...(data as Record<string, unknown>), crm_type: "arbox" });
}

export async function runArboxTrialSyncForBusiness(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business: BusinessRow;
  now?: Date;
}): Promise<BusinessSummary> {
  const admin = input.admin;
  const business = input.business;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const trialBookedBusinessIds = await loadTrialBookedBusinessIds(admin);
    const summary: BusinessSummary = {
      business_id: business.id,
      slug: business.slug,
      fetched: 0,
      processed: 0,
      already: 0,
      unpaid: 0,
      seeded: 0,
      seed_without_contact: 0,
      errors: 0,
      pages_fetched: 0,
      cursor_advanced: false,
    };

    const purchaseRules = await loadEnabledPurchaseTemplateTriggers(admin, business.id);
    const classByProductId = new Map<number, PurchaseItemType>();
    const needsClassMap = purchaseRules.some(
      (rule) => (rule.product_filter?.length ?? 0) > 0 && (rule.item_type_filter?.length ?? 0) > 0
    );
    if (needsClassMap) {
      // One GET /v3/membershipTypes per business per run, only when a purchase rule
      // picked specific products inside a class. 10 studios ≈ 10 extra GETs / 15 min.
      const types = await fetchAllArboxMembershipTypes({
        apiKey: business.crm_api_key,
        logLabel: "cron/arbox-trial-sync",
      });
      if (types.ok) {
        for (const row of types.types) {
          const kind = String(row.type ?? "").trim().toLowerCase();
          if (isPurchaseItemType(kind)) classByProductId.set(row.membership_type_id, kind);
        }
      } else {
        console.error("[cron/arbox-trial-sync] purchase class map failed", {
          slug: business.slug,
          status: types.status,
        });
      }
    }
    const purchaseMatch: PurchaseMatchContext = {
      trialMembershipTypeIds: business.arbox_trial_membership_type_ids,
      classByProductId,
    };
    const membershipScope = resolvePurchaseSaleMembershipScope({
      trialMembershipTypeIds: business.arbox_trial_membership_type_ids,
      purchaseRules,
      classByProductId,
    });

    const firstPaidOn = await hasEnabledFirstPaidPurchaseTrigger(admin, business.id);
    const salesScopeEmpty = purchaseSaleMembershipScopeIsEmpty(membershipScope);
    if (salesScopeEmpty && !firstPaidOn) {
      summary.skipped = true;
      console.info(
        "[cron/arbox-trial-sync] skipped sales — no trial membership_type_ids and no enabled purchase product filters",
        {
          slug: business.slug,
        }
      );
    } else {
    try {
      const { fromDate, toDate } = resolveReportDateRange({
        arboxLastSyncAt: business.arbox_last_sync_at,
        now,
      });

      const report = await fetchAllSalesReportRows({
        apiKey: business.crm_api_key,
        fromDate,
        toDate,
        locationId: business.crm_box_id,
      });

      summary.pages_fetched = report.pagesFetched;

      if (!report.ok) {
        summary.fetch_error = report.error;
      } else {
      if (firstPaidOn) {
        try {
          summary.first_paid_purchase = await syncFirstPaidPurchasesForBusiness({
            admin,
            businessId: business.id,
            businessSlug: business.slug,
            apiKey: business.crm_api_key,
            boxId: business.crm_box_id,
            trialMembershipTypeIds: business.arbox_trial_membership_type_ids,
            salesRows: report.rows,
            salesSyncSeeded: business.arbox_sales_sync_seeded,
            now,
          });
          summary.errors += summary.first_paid_purchase.errors;
        } catch (e) {
          summary.errors += 1;
          console.error("[cron/arbox-trial-sync] first_paid_purchase step threw", {
            slug: business.slug,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const relevantRows = salesScopeEmpty
        ? []
        : filterSalesRowsForMembershipScope(report.rows, membershipScope);
      summary.fetched = relevantRows.length;

      if (!salesScopeEmpty && !business.arbox_sales_sync_seeded) {
        console.info("[cron/arbox-trial-sync] first sales pass — seeding dedup without notify", {
          slug: business.slug,
          relevant_rows: relevantRows.length,
          scope_mode: membershipScope.mode,
        });

        const seedResult = await seedTrialSalesForBusiness({
          admin,
          businessId: business.id,
          businessSlug: business.slug,
          trialRows: relevantRows,
          nowIso,
        });
        summary.seeded = seedResult.seeded;
        summary.seed_without_contact = seedResult.seed_without_contact;
        summary.errors += seedResult.seed_errors;

        const { error: seededFlagErr } = await admin
          .from("businesses")
          .update({ arbox_sales_sync_seeded: true })
          .eq("id", business.id);

        if (seededFlagErr) {
          console.error("[cron/arbox-trial-sync] arbox_sales_sync_seeded update failed", {
            slug: business.slug,
            error: seededFlagErr.message,
          });
          summary.fetch_error = "sales_sync_seeded_flag_failed";
        }
      } else {
        for (const rawRow of relevantRows) {
          try {
            const result = await handleArboxTrialSaleRegistered({
              admin,
              businessId: business.id,
              businessSlug: business.slug,
              row: rawRow as ArboxSalesReportRow,
              trialMembershipTypeIds: business.arbox_trial_membership_type_ids,
              purchaseMatch,
            });

            if (!result.ok) {
              summary.errors += 1;
              console.error("[cron/arbox-trial-sync] handler failed", {
                slug: business.slug,
                sale_id: String(rawRow.sale_id ?? ""),
                user_id: String(rawRow.user_id ?? ""),
                error: result.error,
              });
              continue;
            }

            if ("already" in result && result.already) {
              summary.already += 1;
            } else if ("unpaid" in result && result.unpaid) {
              summary.unpaid += 1;
            } else {
              summary.processed += 1;
            }
          } catch (e) {
            summary.errors += 1;
            console.error("[cron/arbox-trial-sync] handler threw", {
              slug: business.slug,
              sale_id: String(rawRow.sale_id ?? ""),
              user_id: String(rawRow.user_id ?? ""),
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      const { error: cursorErr } = await admin
        .from("businesses")
        .update({ arbox_last_sync_at: nowIso })
        .eq("id", business.id);

      if (cursorErr) {
        console.error("[cron/arbox-trial-sync] cursor update failed", {
          slug: business.slug,
          error: cursorErr.message,
        });
        summary.fetch_error = summary.fetch_error ?? "cursor_update_failed";
      } else {
        summary.cursor_advanced = true;
      }
      }
    } catch (e) {
      summary.fetch_error = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-trial-sync] business loop failed", {
        slug: business.slug,
        error: summary.fetch_error,
      });
    }
    }

    // Separate step: credit_refusal via transactionsReport?status=FAIL (does not touch sales/purchase).
    try {
      summary.credit_refusal = await syncArboxCreditRefusalsForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        arboxLastSyncAt: business.arbox_last_sync_at,
        creditRefusalSeeded: business.arbox_credit_refusal_seeded,
        now,
      });
    } catch (e) {
      console.error("[cron/arbox-trial-sync] credit_refusal step threw", {
        slug: business.slug,
        error: e instanceof Error ? e.message : String(e),
      });
      summary.credit_refusal = {
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
        errors: 1,
        fetch_error: e instanceof Error ? e.message : String(e),
      };
    }

    // Separate step: arbox_new_lead via allLeadsReport (no Arbox call unless an enabled rule exists).
    try {
      summary.new_lead = await syncArboxNewLeadsForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        arboxLastSyncAt: business.arbox_last_sync_at,
        leadsSeeded: business.arbox_leads_seeded,
        now,
      });
    } catch (e) {
      console.error("[cron/arbox-trial-sync] arbox_new_lead step threw", {
        slug: business.slug,
        error: e instanceof Error ? e.message : String(e),
      });
      summary.new_lead = {
        fetched: 0,
        pages_fetched: 0,
        customer_pages_fetched: 0,
        seeded: 0,
        processed: 0,
        already: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        no_phone: 0,
        errors: 1,
        fetch_error: e instanceof Error ? e.message : String(e),
      };
    }

    if (trialBookingConfirmEnabled(trialBookedBusinessIds.has(business.id))) {
      try {
        summary.trial_booking_confirm = await syncTrialBookingConfirmForBusiness({
          admin,
          businessId: business.id,
          businessSlug: business.slug,
          apiKey: business.crm_api_key,
          boxId: business.crm_box_id,
          trialMembershipTypeIds: business.arbox_trial_membership_type_ids,
          hasTrialBookedRule: trialBookedBusinessIds.has(business.id),
          now,
        });
      } catch (e) {
        console.error("[cron/arbox-trial-sync] trial booking confirm threw", {
          slug: business.slug,
          error: e instanceof Error ? e.message : String(e),
        });
        summary.trial_booking_confirm = {
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
          stale: 0,
          errors: 1,
          fetch_error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    try {
      summary.membership_cancelled = await syncArboxMembershipCancelledForBusiness({
        admin,
        businessId: business.id,
        businessSlug: business.slug,
        apiKey: business.crm_api_key,
        boxId: business.crm_box_id,
        cancellationSeeded: business.arbox_cancellation_seeded,
        now,
      });
    } catch (e) {
      console.error("[cron/arbox-trial-sync] membership_cancelled step threw", {
        slug: business.slug,
        error: e instanceof Error ? e.message : String(e),
      });
      summary.membership_cancelled = {
        fetched: 0,
        pages_fetched: 0,
        seeded: 0,
        processed: 0,
        already: 0,
        skipped_filter: 0,
        skipped_rejoined: 0,
        notified: 0,
        deferred: 0,
        gated: 0,
        no_phone: 0,
        abandoned: 0,
        errors: 1,
        fetch_error: e instanceof Error ? e.message : String(e),
      };
    }

  return summary;
}
