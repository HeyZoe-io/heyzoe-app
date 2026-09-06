/**
 * Paginated GET /v3/reports/membersOnHoldReport — freeze cluster A8/C14/C15.
 */
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  ARBOX_REPORT_PAGE_SIZE,
  MAX_SALES_REPORT_PAGES,
  shouldFetchNextArboxReportPage,
} from "@/lib/leads/arbox-sales-report";

export type ArboxMembersOnHoldRow = {
  membership_hold_id?: unknown;
  user_id?: unknown;
  membership_user_id?: unknown;
  phone?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  start_suspend_time?: unknown;
  end_suspend_time?: unknown;
  suspend_reason?: unknown;
  total_days?: unknown;
  membership_type_name?: unknown;
};

export function buildMembersOnHoldReportPath(input: {
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
  return `/v3/reports/membersOnHoldReport?${qs.toString()}`;
}

export async function fetchArboxMembersOnHoldReport(input: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  locationId: string;
  fetchPage?: typeof arboxPublicFetch;
  maxPages?: number;
}): Promise<
  | { ok: true; rows: ArboxMembersOnHoldRow[]; pagesFetched: number; hitPageCap: boolean }
  | { ok: false; error: string; pagesFetched: number; hitPageCap: boolean }
> {
  const fetchPage = input.fetchPage ?? arboxPublicFetch;
  const maxPages = input.maxPages ?? MAX_SALES_REPORT_PAGES;
  const rows: ArboxMembersOnHoldRow[] = [];
  let pagesFetched = 0;
  let page = 1;
  let hitPageCap = false;

  while (pagesFetched < maxPages) {
    const path = buildMembersOnHoldReportPath({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      page,
    });
    const res = await fetchPage(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;

    if (!res.ok) {
      console.error("[leads/arbox-freeze] membersOnHoldReport fetch failed", {
        status: res.status,
        body: res.rawText.slice(0, 500),
      });
      return {
        ok: false,
        error: `membersOnHoldReport_${res.status}`,
        pagesFetched,
        hitPageCap,
      };
    }

    const data = (res.json as { data?: unknown } | null)?.data;
    const pageRows = Array.isArray(data) ? (data as ArboxMembersOnHoldRow[]) : [];
    rows.push(...pageRows);

    const nextPageUrl = String(
      (res.json as { extra?: { pagination?: { next_page_url?: unknown } } } | null)?.extra
        ?.pagination?.next_page_url ?? ""
    ).trim();

    if (
      !shouldFetchNextArboxReportPage({
        pageRowsLength: pageRows.length,
        nextPageUrl,
        pageSize: ARBOX_REPORT_PAGE_SIZE,
      })
    ) {
      break;
    }
    if (pagesFetched >= maxPages) {
      hitPageCap = true;
      console.warn("[leads/arbox-freeze] membersOnHoldReport pagination capped", {
        max_pages: maxPages,
        location_id: input.locationId,
      });
      break;
    }
    page += 1;
  }

  return { ok: true, rows, pagesFetched, hitPageCap };
}
