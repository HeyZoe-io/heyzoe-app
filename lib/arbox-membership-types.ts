import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { shouldFetchNextArboxReportPage } from "@/lib/leads/arbox-sales-report";

/** Arbox OpenAPI max for GET /v3/membershipTypes. Default page without ?limit= is 200. */
export const ARBOX_MEMBERSHIP_TYPES_PAGE_SIZE = 500;
export const MAX_ARBOX_MEMBERSHIP_TYPE_PAGES = 10;

export type ArboxMembershipTypeRow = {
  membership_type_id: number;
  membership_type_name: string;
};

type ArboxMembershipTypesResponse = {
  data?: Array<Record<string, unknown>>;
  extra?: { pagination?: { next_page_url?: string | null } };
};

/**
 * IO: 1 GET for studios with ≤500 active types (Apex is 280). Page 2 only if
 * next_page_url is set and the page is full. 10 businesses ≈ 10–20 GETs per
 * dashboard load / cron name-map — not a table scan.
 */
export function buildArboxMembershipTypesPath(page?: number): string {
  const qs = new URLSearchParams({
    limit: String(ARBOX_MEMBERSHIP_TYPES_PAGE_SIZE),
  });
  if (page != null && page > 1) qs.set("page", String(page));
  return `/v3/membershipTypes?${qs.toString()}`;
}

export function parseArboxMembershipTypeRows(json: unknown): ArboxMembershipTypeRow[] {
  const rows = (json as ArboxMembershipTypesResponse | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: ArboxMembershipTypeRow[] = [];
  for (const row of rows) {
    const id = Number(row.membership_type_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = String(row.membership_type_name ?? "").trim();
    out.push({ membership_type_id: Math.trunc(id), membership_type_name: name || String(id) });
  }
  return out;
}

export function membershipTypeNameById(types: ArboxMembershipTypeRow[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of types) {
    const name = row.membership_type_name.trim();
    if (!name || name === String(row.membership_type_id)) continue;
    map.set(row.membership_type_id, name);
  }
  return map;
}

function sortMembershipTypes(types: ArboxMembershipTypeRow[]): ArboxMembershipTypeRow[] {
  return [...types].sort((a, b) => {
    const na = a.membership_type_name.localeCompare(b.membership_type_name, "he");
    if (na !== 0) return na;
    return a.membership_type_id - b.membership_type_id;
  });
}

export async function fetchAllArboxMembershipTypes(input: {
  apiKey: string;
  fetchPage?: typeof arboxPublicFetch;
  logLabel: string;
  maxPages?: number;
  pageSize?: number;
}): Promise<
  | { ok: true; types: ArboxMembershipTypeRow[]; pagesFetched: number; hitPageCap: boolean }
  | { ok: false; status: number; rawText: string; pagesFetched: number }
> {
  const fetchPage = input.fetchPage ?? arboxPublicFetch;
  const maxPages = input.maxPages ?? MAX_ARBOX_MEMBERSHIP_TYPE_PAGES;
  const pageSize = input.pageSize ?? ARBOX_MEMBERSHIP_TYPES_PAGE_SIZE;
  const byId = new Map<number, ArboxMembershipTypeRow>();
  let pagesFetched = 0;
  let page = 1;
  let hitPageCap = false;

  while (pagesFetched < maxPages) {
    const path = buildArboxMembershipTypesPath(page);
    const res = await fetchPage(path, { apiKey: input.apiKey, method: "GET" });
    pagesFetched += 1;

    if (!res.ok) {
      console.error(`[${input.logLabel}] membershipTypes fetch failed`, {
        status: res.status,
        body: res.rawText.slice(0, 500),
        page,
      });
      return {
        ok: false,
        status: res.status,
        rawText: res.rawText,
        pagesFetched,
      };
    }

    const payload = res.json as ArboxMembershipTypesResponse | null;
    const parsed = parseArboxMembershipTypeRows(payload);
    for (const row of parsed) {
      if (!byId.has(row.membership_type_id)) byId.set(row.membership_type_id, row);
    }

    const pageRows = Array.isArray(payload?.data) ? payload.data : [];
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
    console.warn(`[${input.logLabel}] membershipTypes pagination capped`, {
      max_pages: maxPages,
      types: byId.size,
    });
  }

  return {
    ok: true,
    types: sortMembershipTypes([...byId.values()]),
    pagesFetched,
    hitPageCap,
  };
}

/** All query words must appear in the id or name (order-independent). Empty query → match all. */
export function arboxMembershipTypeMatchesWords(
  row: Pick<ArboxMembershipTypeRow, "membership_type_id" | "membership_type_name">,
  query: string
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${row.membership_type_id} ${row.membership_type_name}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Filter membership types by words. When filtering, keep already-selected rows visible
 * at the top even if they no longer match the query.
 */
export function filterArboxMembershipTypesByWords<
  T extends Pick<ArboxMembershipTypeRow, "membership_type_id" | "membership_type_name">,
>(types: readonly T[], query: string, selectedIds: readonly number[] = []): T[] {
  const matching = types.filter((row) => arboxMembershipTypeMatchesWords(row, query));
  if (!query.trim()) return matching;
  const selected = new Set(selectedIds);
  const selectedRows = types.filter((row) => selected.has(row.membership_type_id));
  const selectedIdSet = new Set(selectedRows.map((row) => row.membership_type_id));
  const rest = matching.filter((row) => !selectedIdSet.has(row.membership_type_id));
  return [...selectedRows, ...rest];
}
