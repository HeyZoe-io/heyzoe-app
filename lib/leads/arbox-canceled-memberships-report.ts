import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  ARBOX_REPORT_PAGE_SIZE,
  MAX_SALES_REPORT_PAGES,
  shouldFetchNextArboxReportPage,
} from "@/lib/leads/arbox-sales-report";

/**
 * Paginated GET /v3/reports/canceledMembershipsReport (American spelling, one L).
 * Same ?page=N loop as daily Arbox reports — never GET next_page_url as a URL.
 */

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
    const path = buildCanceledMembershipsReportPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await fetchPage(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;

    if (!res.ok) {
      console.error("[leads/arbox-membership-cancelled] canceledMembershipsReport fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
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

  return { ok: true, rows, pagesFetched, hitPageCap };
}
