import assert from "node:assert/strict";
import {
  ARBOX_REPORT_PAGE_SIZE,
  MAX_SALES_REPORT_PAGES,
  shouldFetchNextArboxReportPage,
} from "@/lib/leads/arbox-sales-report";
import {
  buildAllLeadsReportPath,
  fetchAllLeadsReportRows,
} from "@/lib/leads/arbox-all-leads-report";

/**
 * BUG-1 (salesReport / trial-sync) also applies to allLeadsReport: live
 * next_page_url is http + stripped query → 400. Same contract as
 * arbox-sales-report.test.ts: never GET it as a URL; ?page=N on the original
 * query; stop on null next or <200 rows; cap 20 + warn.
 */

function pagePath(page?: number): string {
  return buildAllLeadsReportPath({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    page,
  });
}

function fakeFetchResponse(input: {
  data: Record<string, unknown>[];
  nextPageUrl?: string | null;
  ok?: boolean;
  status?: number;
}): { ok: boolean; status: number; json: unknown; rawText: string } {
  const json = {
    data: input.data,
    extra: { pagination: { next_page_url: input.nextPageUrl ?? null } },
  };
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    json,
    rawText: JSON.stringify(json),
  };
}

function nRows(n: number, offset = 0): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({ user_id: offset + i + 1 }));
}

{
  const p1 = pagePath();
  assert.match(p1, /\/v3\/reports\/allLeadsReport\?/);
  assert.match(p1, /fromDate=2026-08-01/);
  assert.match(p1, /toDate=2026-08-31/);
  assert.match(p1, /location_id=20547/);
  assert.doesNotMatch(p1, /[?&]page=/);

  const p2 = pagePath(2);
  assert.match(p2, /fromDate=2026-08-01/);
  assert.match(p2, /toDate=2026-08-31/);
  assert.match(p2, /location_id=20547/);
  assert.match(p2, /[?&]page=2(?:&|$)/);
}

/** Stop when next_page_url is empty or the page is short of 200 rows (BUG-1). */
{
  assert.equal(
    shouldFetchNextArboxReportPage({
      pageRowsLength: 200,
      nextPageUrl: "http://arboxserver.arboxapp.com/api/public/v3/reports/allLeadsReport?page=2",
    }),
    true
  );
  assert.equal(
    shouldFetchNextArboxReportPage({ pageRowsLength: 199, nextPageUrl: "http://x?page=2" }),
    false
  );
  assert.equal(
    shouldFetchNextArboxReportPage({ pageRowsLength: 200, nextPageUrl: "" }),
    false
  );
}

async function main() {
{
  const requested: string[] = [];
  const report = await fetchAllLeadsReportRows({
    apiKey: "k",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    fetchPage: async (path) => {
      requested.push(path);
      return fakeFetchResponse({
        data: nRows(50),
        nextPageUrl: "http://arboxserver.arboxapp.com/api/public/v3/reports/allLeadsReport?page=2",
      });
    },
  });
  assert.equal(report.ok, true);
  if (!report.ok) throw new Error("expected ok");
  assert.equal(report.rows.length, 50);
  assert.equal(report.pagesFetched, 1);
  assert.equal(report.hitPageCap, false);
  assert.deepEqual(requested, [pagePath()]);
  assert.ok(requested.every((p) => !p.startsWith("http")));
}

{
  const requested: string[] = [];
  const report = await fetchAllLeadsReportRows({
    apiKey: "k",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    fetchPage: async (path) => {
      requested.push(path);
      if (path.includes("page=2")) {
        return fakeFetchResponse({ data: nRows(50, 200), nextPageUrl: null });
      }
      return fakeFetchResponse({
        data: nRows(ARBOX_REPORT_PAGE_SIZE),
        nextPageUrl: "http://arboxserver.arboxapp.com/api/public/v3/reports/allLeadsReport?page=2",
      });
    },
  });
  assert.equal(report.ok, true);
  if (!report.ok) throw new Error("expected ok");
  assert.equal(report.rows.length, 250);
  assert.equal(report.pagesFetched, 2);
  assert.equal(report.hitPageCap, false);
  assert.deepEqual(requested, [pagePath(), pagePath(2)]);
  assert.ok(requested.every((p) => p.includes("fromDate=2026-08-01")));
  assert.ok(requested.every((p) => p.includes("location_id=20547")));
  assert.ok(requested.every((p) => !p.startsWith("http")));
}

{
  const capLogs: { max_pages: number; location_id: string }[] = [];
  const requested: string[] = [];
  const report = await fetchAllLeadsReportRows({
    apiKey: "k",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    fetchPage: async (path) => {
      requested.push(path);
      return fakeFetchResponse({
        data: nRows(ARBOX_REPORT_PAGE_SIZE),
        nextPageUrl: "http://x?page=99",
      });
    },
    onPageCap: (info) => capLogs.push(info),
  });
  assert.equal(report.ok, true);
  if (!report.ok) throw new Error("expected ok");
  assert.equal(report.pagesFetched, MAX_SALES_REPORT_PAGES);
  assert.equal(report.rows.length, MAX_SALES_REPORT_PAGES * ARBOX_REPORT_PAGE_SIZE);
  assert.equal(report.hitPageCap, true);
  assert.equal(requested.length, MAX_SALES_REPORT_PAGES);
  assert.equal(requested[0], pagePath());
  assert.equal(requested[MAX_SALES_REPORT_PAGES - 1], pagePath(MAX_SALES_REPORT_PAGES));
  assert.deepEqual(capLogs, [{ max_pages: MAX_SALES_REPORT_PAGES, location_id: "20547" }]);
}

{
  const warns: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args);
  };
  try {
    const report = await fetchAllLeadsReportRows({
      apiKey: "k",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      locationId: "20547",
      maxPages: 1,
      fetchPage: async () =>
        fakeFetchResponse({
          data: nRows(ARBOX_REPORT_PAGE_SIZE),
          nextPageUrl: "http://x?page=2",
        }),
    });
    assert.equal(report.ok, true);
    if (!report.ok) throw new Error("expected ok");
    assert.equal(report.hitPageCap, true);
    assert.equal(warns.length, 1);
    assert.equal(warns[0]![0], "[leads/arbox-new-lead/allLeadsReport] pagination capped");
  } finally {
    console.warn = originalWarn;
  }
}

console.log("arbox-all-leads-report.test.ts: ok");
}

void main();
