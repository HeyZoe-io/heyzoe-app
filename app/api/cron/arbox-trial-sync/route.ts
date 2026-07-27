import { NextRequest, NextResponse } from "next/server";
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  handleArboxTrialClassRegistered,
  type ArboxTrialClassReportRow,
} from "@/lib/leads/arbox-trial-registered";
import { resolveCronSecret } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** נקרא מ-cron-job.org (לא מ-Vercel crons — Hobby). GET + Authorization: Bearer CRON_SECRET */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REPORT_PAGES = 20;
const MS_24H = 24 * 60 * 60 * 1000;
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
};

type BusinessSummary = {
  business_id: number;
  slug: string;
  fetched: number;
  processed: number;
  already: number;
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

function resolveReportDateRange(input: {
  arboxLastSyncAt: string | null;
  now: Date;
}): { fromDate: string; toDate: string } {
  const toDate = formatDateYmdIsrael(input.now);
  if (input.arboxLastSyncAt) {
    const parsed = new Date(input.arboxLastSyncAt);
    if (!Number.isNaN(parsed.getTime())) {
      return { fromDate: formatDateYmdIsrael(parsed), toDate };
    }
  }
  const from = new Date(input.now.getTime() - MS_24H);
  return { fromDate: formatDateYmdIsrael(from), toDate };
}

function buildTrialClassesReportPath(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
}): string {
  const qs = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    location_id: input.locationId,
  });
  return `/v3/reports/trialClassesReport?${qs.toString()}`;
}

async function fetchAllTrialClassRows(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
}): Promise<
  | { ok: true; rows: Record<string, unknown>[]; pagesFetched: number }
  | { ok: false; error: string; status?: number; pagesFetched: number }
> {
  let pathOrUrl = buildTrialClassesReportPath({
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
      console.error("[cron/arbox-trial-sync] Arbox report fetch failed", {
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
    console.warn("[cron/arbox-trial-sync] report pagination capped", {
      max_pages: MAX_REPORT_PAGES,
      location_id: input.locationId,
    });
  }

  return { ok: true, rows, pagesFetched };
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: businessRows, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, crm_api_key, crm_box_id, arbox_last_sync_at")
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
    if (!Number.isFinite(id) || id <= 0 || !slug || !apiKey || !boxId) continue;
    businesses.push({
      id,
      slug,
      crm_api_key: apiKey,
      crm_box_id: boxId,
      arbox_last_sync_at: arboxLastSyncAt,
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
      errors: 0,
      pages_fetched: 0,
      cursor_advanced: false,
    };

    try {
      const { fromDate, toDate } = resolveReportDateRange({
        arboxLastSyncAt: business.arbox_last_sync_at,
        now,
      });

      const report = await fetchAllTrialClassRows({
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

      summary.fetched = report.rows.length;

      for (const rawRow of report.rows) {
        try {
          const result = await handleArboxTrialClassRegistered({
            admin,
            businessId: business.id,
            businessSlug: business.slug,
            row: rawRow as ArboxTrialClassReportRow,
          });

          if (!result.ok) {
            summary.errors += 1;
            console.error("[cron/arbox-trial-sync] handler failed", {
              slug: business.slug,
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
            user_id: String(rawRow.user_id ?? ""),
            error: e instanceof Error ? e.message : String(e),
          });
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
        summary.fetch_error = "cursor_update_failed";
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
