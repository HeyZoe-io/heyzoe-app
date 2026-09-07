import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";

/**
 * Paginated GET /v3/reports/lostLeadsReport.
 * Same BUG-1 contract as salesReport / allLeadsReport: live next_page_url is
 * unusable (http + stripped query → 400). Never GET it as a URL; loop ?page=N
 * on the original fromDate/toDate/location_id query.
 */

export function buildLostLeadsReportPath(input: {
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
  return `/v3/reports/lostLeadsReport?${qs.toString()}`;
}

export async function fetchLostLeadsReportRows(input: {
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
  return fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.locationId,
    logLabel: "leads/arbox-lost-lead/lostLeadsReport",
    buildPath: (page) =>
      buildLostLeadsReportPath({
        fromDate: input.fromDate,
        toDate: input.toDate,
        locationId: input.locationId,
        page,
      }),
    fetchPage: input.fetchPage,
    maxPages: input.maxPages,
    pageSize: input.pageSize,
    onPageCap: input.onPageCap,
  });
}
