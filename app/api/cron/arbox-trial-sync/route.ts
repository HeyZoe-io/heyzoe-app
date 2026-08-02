import { NextRequest, NextResponse } from "next/server";
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  handleArboxTrialSaleRegistered,
  type ArboxSalesReportRow,
} from "@/lib/leads/arbox-trial-sale-registered";
import { contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadEnabledPurchaseTemplateTriggers,
  purchaseSaleMembershipScopeIsEmpty,
  resolvePurchaseSaleMembershipScope,
  saleMembershipTypeInScope,
  type PurchaseSaleMembershipScope,
} from "@/lib/template-triggers-match";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REPORT_PAGES = 20;
const MS_24H = 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Arbox salesReport: date range must not exceed 31 days (API returns 400). */
const MAX_SALES_REPORT_SPAN_DAYS = 30;
const ISRAEL_TZ = "Asia/Jerusalem";

type ArboxReportResponse = {
  statusCode?: number;
  data?: Record<string, unknown>[];
  extra?: {
    pagination?: {
      results_count?: number;
      results_per_page?: number;
      current_page?: number;
      next_page_url?: string | null;
      prev_page_url?: string | null;
    };
  };
};

type BusinessRow = {
  id: number;
  slug: string;
  crm_api_key: string;
  crm_box_id: string;
  arbox_last_sync_at: string | null;
  arbox_trial_membership_type_ids: number[];
  arbox_sales_sync_seeded: boolean;
};

type BusinessSummary = {
  business_id: number;
  slug: string;
  skipped?: boolean;
  fetched: number;
  processed: number;
  already: number;
  seeded: number;
  seed_without_contact: number;
  errors: number;
  pages_fetched: number;
  cursor_advanced: boolean;
  fetch_error?: string;
};

function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron/arbox-trial-sync] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

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

function buildSalesReportPath(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    location_id: input.locationId,
  });
  return `/v3/reports/salesReport?${qs.toString()}`;
}

async function fetchAllSalesReportRows(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
}): Promise<
  | { ok: true; rows: Record<string, unknown>[]; pagesFetched: number }
  | { ok: false; error: string; status?: number; pagesFetched: number }
> {
  let pathOrUrl = buildSalesReportPath({
    fromDate: input.fromDate,
    toDate: input.toDate,
    locationId: input.locationId,
  });

  const rows: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let hitPageCap = false;

  while (pagesFetched < MAX_REPORT_PAGES) {
    const res = await arboxPublicFetch(pathOrUrl, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;

    if (!res.ok) {
      console.error("[cron/arbox-trial-sync] Arbox salesReport fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
      });
      return {
        ok: false,
        error: "arbox_report_fetch_failed",
        status: res.status,
        pagesFetched,
      };
    }

    const payload = res.json as ArboxReportResponse | null;
    const pageRows = Array.isArray(payload?.data) ? payload!.data! : [];
    rows.push(...pageRows);

    const nextPageUrl = String(payload?.extra?.pagination?.next_page_url ?? "").trim();
    if (!nextPageUrl) break;

    if (pagesFetched >= MAX_REPORT_PAGES) {
      hitPageCap = true;
      break;
    }
    pathOrUrl = nextPageUrl;
  }

  if (hitPageCap) {
    console.warn("[cron/arbox-trial-sync] salesReport pagination capped", {
      max_pages: MAX_REPORT_PAGES,
      location_id: input.locationId,
    });
  }

  return { ok: true, rows, pagesFetched };
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

  const phoneNorm = normalizePhone(input.phoneRaw);
  if (!phoneNorm) return null;

  const phoneVariants = contactPhoneLookupVariants(phoneNorm);
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

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: businessRows, error: bizErr } = await admin
    .from("businesses")
    .select(
      "id, slug, crm_api_key, crm_box_id, arbox_last_sync_at, arbox_trial_membership_type_ids, arbox_sales_sync_seeded"
    )
    .eq("crm_type", "arbox")
    .not("crm_api_key", "is", null)
    .not("crm_box_id", "is", null);

  if (bizErr) {
    console.error("[cron/arbox-trial-sync] businesses query failed:", bizErr.message);
    return NextResponse.json({ ok: false, error: "businesses_query_failed" }, { status: 500 });
  }

  const businesses: BusinessRow[] = [];
  for (const row of businessRows ?? []) {
    const id = Number((row as { id?: unknown }).id);
    const slug = String((row as { slug?: unknown }).slug ?? "").trim().toLowerCase();
    const apiKey = String((row as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
    const boxId = String((row as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
    const arboxLastSyncAt = (row as { arbox_last_sync_at?: string | null }).arbox_last_sync_at ?? null;
    const trialIds = parseTrialMembershipTypeIds(
      (row as { arbox_trial_membership_type_ids?: unknown }).arbox_trial_membership_type_ids
    );
    const salesSyncSeeded = (row as { arbox_sales_sync_seeded?: unknown }).arbox_sales_sync_seeded === true;
    if (!Number.isFinite(id) || id <= 0 || !slug || !apiKey || !boxId) continue;
    businesses.push({
      id,
      slug,
      crm_api_key: apiKey,
      crm_box_id: boxId,
      arbox_last_sync_at: arboxLastSyncAt,
      arbox_trial_membership_type_ids: trialIds,
      arbox_sales_sync_seeded: salesSyncSeeded,
    });
  }

  const summaries: BusinessSummary[] = [];

  for (const business of businesses) {
    const summary: BusinessSummary = {
      business_id: business.id,
      slug: business.slug,
      fetched: 0,
      processed: 0,
      already: 0,
      seeded: 0,
      seed_without_contact: 0,
      errors: 0,
      pages_fetched: 0,
      cursor_advanced: false,
    };

    const purchaseRules = await loadEnabledPurchaseTemplateTriggers(admin, business.id);
    const membershipScope = resolvePurchaseSaleMembershipScope({
      trialMembershipTypeIds: business.arbox_trial_membership_type_ids,
      purchaseRules,
    });

    if (purchaseSaleMembershipScopeIsEmpty(membershipScope)) {
      summary.skipped = true;
      console.info(
        "[cron/arbox-trial-sync] skipped — no trial membership_type_ids and no enabled purchase product filters",
        {
          slug: business.slug,
        }
      );
      summaries.push(summary);
      continue;
    }

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
        summaries.push(summary);
        continue;
      }

      const relevantRows = filterSalesRowsForMembershipScope(report.rows, membershipScope);
      summary.fetched = relevantRows.length;

      if (!business.arbox_sales_sync_seeded) {
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
    } catch (e) {
      summary.fetch_error = e instanceof Error ? e.message : String(e);
      console.error("[cron/arbox-trial-sync] business loop failed", {
        slug: business.slug,
        error: summary.fetch_error,
      });
    }

    summaries.push(summary);
  }

  return NextResponse.json({
    ok: true,
    ran_at: nowIso,
    businesses: summaries,
  });
}
