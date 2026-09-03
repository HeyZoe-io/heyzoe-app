import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";

/** Live Arbox reports: results_per_page is 200; results_count is this page, not a total. */
export const ARBOX_REPORT_PAGE_SIZE = 200;
export const MAX_SALES_REPORT_PAGES = 20;

type ArboxReportResponse = {
  data?: Record<string, unknown>[];
  extra?: {
    pagination?: {
      next_page_url?: string | null;
    };
  };
};

export function buildSalesReportPath(input: {
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
  return `/v3/reports/salesReport?${qs.toString()}`;
}

/**
 * Continue only when this page looks full AND Arbox advertised another page.
 * Never GET next_page_url (http + stripped query → 400). Use it as a boolean only.
 */
export function shouldFetchNextArboxReportPage(input: {
  pageRowsLength: number;
  nextPageUrl: string;
  pageSize?: number;
}): boolean {
  const size = input.pageSize ?? ARBOX_REPORT_PAGE_SIZE;
  if (!String(input.nextPageUrl ?? "").trim()) return false;
  return input.pageRowsLength >= size;
}

/** Paginated GET /v3/reports/salesReport — same ?page=N loop as daily Arbox reports. */
export async function fetchAllSalesReportRows(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
  fetchPage?: typeof arboxPublicFetch;
  maxPages?: number;
  pageSize?: number;
  onPageCap?: (info: { max_pages: number; location_id: string }) => void;
}): Promise<
  | { ok: true; rows: Record<string, unknown>[]; pagesFetched: number; hitPageCap: boolean }
  | { ok: false; error: string; status?: number; pagesFetched: number; hitPageCap: boolean }
> {
  const fetchPage = input.fetchPage ?? arboxPublicFetch;
  const maxPages = input.maxPages ?? MAX_SALES_REPORT_PAGES;
  const pageSize = input.pageSize ?? ARBOX_REPORT_PAGE_SIZE;
  const rows: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let page = 1;
  let hitPageCap = false;

  while (pagesFetched < maxPages) {
    const path = buildSalesReportPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await fetchPage(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;

    if (!res.ok) {
      console.error("[cron/arbox-trial-sync] Arbox salesReport fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
        page,
      });
      return {
        ok: false,
        error: "arbox_report_fetch_failed",
        status: res.status,
        pagesFetched,
        hitPageCap: false,
      };
    }

    const payload = res.json as ArboxReportResponse | null;
    const pageRows = Array.isArray(payload?.data) ? payload!.data! : [];
    rows.push(...pageRows);

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
      console.warn("[cron/arbox-trial-sync] salesReport pagination capped", info);
    }
  }

  return { ok: true, rows, pagesFetched, hitPageCap };
}
