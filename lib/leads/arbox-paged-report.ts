import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  ARBOX_REPORT_PAGE_SIZE,
  MAX_SALES_REPORT_PAGES,
  shouldFetchNextArboxReportPage,
} from "@/lib/leads/arbox-sales-report";

/**
 * Paginated GET /v3/reports/{name} — same BUG-1 contract as salesReport:
 * never GET next_page_url as a URL; ?page=N on the original query; stop on
 * null next or <200 rows; cap 20 pages + warn.
 */
export async function fetchArboxPagedReportRows(input: {
  apiKey: string;
  buildPath: (page: number) => string;
  logLabel: string;
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
    const path = input.buildPath(page);
    const res = await fetchPage(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;

    if (!res.ok) {
      console.error(`[${input.logLabel}] fetch failed`, {
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

    const payload = res.json as {
      data?: Record<string, unknown>[];
      extra?: { pagination?: { next_page_url?: string | null } };
    } | null;
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
      console.warn(`[${input.logLabel}] pagination capped`, info);
    }
  }

  return { ok: true, rows, pagesFetched, hitPageCap };
}
