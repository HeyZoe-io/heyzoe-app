import assert from "node:assert/strict";
import {
  ARBOX_REPORT_PAGE_SIZE,
  MAX_SALES_REPORT_PAGES,
  shouldFetchNextArboxReportPage,
} from "@/lib/leads/arbox-sales-report";
import {
  buildLostLeadsReportPath,
  fetchLostLeadsReportRows,
} from "@/lib/leads/arbox-lost-leads-report";

/**
 * BUG-1 (salesReport / trial-sync) also applies to lostLeadsReport: live
 * next_page_url is http + stripped query → 400. Never GET it as a URL; ?page=N
 * on the original query; stop on null next or <200 rows; cap 20 + warn.
 */

function pagePath(page?: number): string {
  return buildLostLeadsReportPath({
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
  return Array.from({ length: n }, (_, i) => ({ lead_id: offset + i + 1 }));
}

{
  const p1 = pagePath();
  assert.match(p1, /\/v3\/reports\/lostLeadsReport\?/);
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

{
  assert.equal(
    shouldFetchNextArboxReportPage({
      pageRowsLength: 200,
      nextPageUrl: "http://arboxserver.arboxapp.com/api/public/v3/reports/lostLeadsReport?page=2",
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
  assert.equal(ARBOX_REPORT_PAGE_SIZE, 200);
  assert.equal(MAX_SALES_REPORT_PAGES, 20);
}

async function main() {
{
  const requested: string[] = [];
  const report = await fetchLostLeadsReportRows({
    apiKey: "k",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    fetchPage: async (path) => {
      requested.push(path);
      return fakeFetchResponse({
        data: nRows(50),
        nextPageUrl: "http://arboxserver.arboxapp.com/api/public/v3/reports/lostLeadsReport?page=2",
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
  const report = await fetchLostLeadsReportRows({
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
        data: nRows(200),
        nextPageUrl: "http://arboxserver.arboxapp.com/api/public/v3/reports/lostLeadsReport?page=2",
      });
    },
  });
  assert.equal(report.ok, true);
  if (!report.ok) throw new Error("expected ok");
  assert.equal(report.rows.length, 250);
  assert.equal(report.pagesFetched, 2);
  assert.deepEqual(requested, [pagePath(), pagePath(2)]);
  assert.ok(requested.every((p) => !p.startsWith("http")));
}

{
  const requested: string[] = [];
  const report = await fetchLostLeadsReportRows({
    apiKey: "k",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    maxPages: 2,
    fetchPage: async (path) => {
      requested.push(path);
      return fakeFetchResponse({
        data: nRows(200, requested.length * 200),
        nextPageUrl: `http://arboxserver.arboxapp.com/api/public/v3/reports/lostLeadsReport?page=${requested.length + 1}`,
      });
    },
  });
  assert.equal(report.ok, true);
  if (!report.ok) throw new Error("expected ok");
  assert.equal(report.pagesFetched, 2);
  assert.equal(report.hitPageCap, true);
  assert.equal(requested.length, 2);
}

  console.log("arbox-lost-leads-report.test.ts: ok");
}

void main();
