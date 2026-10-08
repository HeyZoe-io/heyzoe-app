import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  ARBOX_REPORT_PAGE_SIZE,
  MAX_SALES_REPORT_PAGES,
  shouldFetchNextArboxReportPage,
} from "@/lib/leads/arbox-sales-report";

/**
 * Paginated GET /v3/reports/canceledMembershipsReport (American spelling, one L).
 * Same ?page=N loop as daily Arbox reports — never GET next_page_url as a URL.
 *
 * Arbox validates fromDate / toDate but ignores the range (checked 8.10.2026: a 2020 range
 * returns the box's full history; from_date / startDate / start_date behave the same).
 * Rows come newest first by cancelled_time across pages, so paging stops once a page that
 * is itself in that order ends before fromDate. A page out of order keeps the old full loop.
 * Before: ~11 pages / ~48s per big box every 15 minutes. After: 1 page for a 2-day window.
 */

/** Below this much time left, do not start another page; the next 15-minute tick continues. */
export const CANCELED_REPORT_MIN_PAGE_MS = 4_000;
const CANCELED_REPORT_PAGE_TIMEOUT_MS = 20_000;

function cancelledYmd(row: Record<string, unknown>): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(row.cancelled_time ?? "").trim());
  return m?.[1] ?? null;
}

/** True when the page is newest-first by cancelled_time and its last row is before fromDate. */
export function canceledReportPageEndsBefore(rows: readonly Record<string, unknown>[], fromDate: string): boolean {
  if (!rows.length) return false;
  let prev: string | null = null;
  for (const row of rows) {
    const t = String(row.cancelled_time ?? "").trim();
    if (!cancelledYmd(row)) return false;
    if (prev != null && t > prev) return false;
    prev = t;
  }
  const oldest = cancelledYmd(rows[rows.length - 1]!);
  return oldest != null && oldest < fromDate;
}

export function buildCanceledMembershipsReportPath(input: {
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
  return `/v3/reports/canceledMembershipsReport?${qs.toString()}`;
}

export async function fetchCanceledMembershipsReportRows(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
  fetchPage?: typeof arboxPublicFetch;
  maxPages?: number;
  pageSize?: number;
  onPageCap?: (info: { max_pages: number; location_id: string }) => void;
  /** Default true. false = page through the whole report (measurement only). */
  stopAtFromDate?: boolean;
  /** Epoch ms. No page starts with less than CANCELED_REPORT_MIN_PAGE_MS left. */
  deadlineMs?: number;
  nowMs?: () => number;
}): Promise<
  | {
      ok: true;
      rows: Record<string, unknown>[];
      pagesFetched: number;
      hitPageCap: boolean;
      stoppedAtFromDate?: boolean;
      stoppedForBudget?: boolean;
    }
  | { ok: false; error: string; status?: number; pagesFetched: number; hitPageCap: boolean }
> {
  const fetchPage = input.fetchPage ?? arboxPublicFetch;
  const maxPages = input.maxPages ?? MAX_SALES_REPORT_PAGES;
  const pageSize = input.pageSize ?? ARBOX_REPORT_PAGE_SIZE;
  const rows: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let page = 1;
  let hitPageCap = false;
  let stoppedAtFromDate = false;
  let stoppedForBudget = false;
  const clock = input.nowMs ?? Date.now;

  while (pagesFetched < maxPages) {
    let timeoutMs: number | undefined;
    if (input.deadlineMs != null) {
      const left = input.deadlineMs - clock();
      if (left < CANCELED_REPORT_MIN_PAGE_MS) {
        stoppedForBudget = true;
        console.warn("[leads/arbox-membership-cancelled] canceledMembershipsReport stopped for time budget", {
          location_id: input.locationId,
          pages_fetched: pagesFetched,
          left_ms: left,
        });
        break;
      }
      timeoutMs = Math.min(CANCELED_REPORT_PAGE_TIMEOUT_MS, left);
    }
    const path = buildCanceledMembershipsReportPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await fetchPage(path, { apiKey: input.apiKey, method: "GET", ...(timeoutMs ? { timeoutMs } : {}) });
    pagesFetched += 1;

    if (!res.ok) {
      console.error("[leads/arbox-membership-cancelled] canceledMembershipsReport fetch failed", {
        status: res.status,
        page,
      });
      return {
        ok: false,
        error: "arbox_canceled_memberships_fetch_failed",
        status: res.status,
        pagesFetched,
        hitPageCap: false,
      };
    }

    const payload = res.json as {
      data?: Record<string, unknown>[];
      extra?: { pagination?: { next_page_url?: string | null } };
    } | null;
    const pageRows = Array.isArray(payload?.data) ? payload!.data! : [];
    rows.push(...pageRows);

    if (input.stopAtFromDate !== false && canceledReportPageEndsBefore(pageRows, input.fromDate)) {
      stoppedAtFromDate = true;
      break;
    }

    const nextPageUrl = String(payload?.extra?.pagination?.next_page_url ?? "").trim();
    if (!shouldFetchNextArboxReportPage({ pageRowsLength: pageRows.length, nextPageUrl, pageSize })) {
      break;
    }
    if (pagesFetched >= maxPages) {
      hitPageCap = true;
      break;
    }
    page += 1;
  }

  if (hitPageCap) {
    const info = { max_pages: maxPages, location_id: input.locationId };
    if (input.onPageCap) {
      input.onPageCap(info);
    } else {
      console.warn("[leads/arbox-membership-cancelled] canceledMembershipsReport pagination capped", info);
    }
  }

  if (stoppedForBudget && !rows.length) {
    return { ok: false, error: "arbox_canceled_memberships_time_budget", pagesFetched, hitPageCap: false };
  }
  return { ok: true, rows, pagesFetched, hitPageCap, stoppedAtFromDate, stoppedForBudget };
}
