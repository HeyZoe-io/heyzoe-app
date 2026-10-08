import assert from "node:assert/strict";
import {
  ARBOX_REPORT_PAGE_SIZE,
  MAX_SALES_REPORT_PAGES,
} from "@/lib/leads/arbox-sales-report";
import {
  buildCanceledMembershipsReportPath,
  canceledReportPageEndsBefore,
  CANCELED_REPORT_MIN_PAGE_MS,
  fetchCanceledMembershipsReportRows,
} from "@/lib/leads/arbox-canceled-memberships-report";

function pagePath(page?: number): string {
  return buildCanceledMembershipsReportPath({
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
  assert.match(p1, /\/v3\/reports\/canceledMembershipsReport\?/);
  assert.doesNotMatch(p1, /cancelledMemberships/i);
  assert.match(p1, /fromDate=2026-08-01/);
  assert.match(p1, /toDate=2026-08-31/);
  assert.match(p1, /location_id=20547/);
  assert.doesNotMatch(p1, /[?&]page=/);

  const p2 = pagePath(2);
  assert.match(p2, /[?&]page=2(?:&|$)/);
  assert.match(p2, /fromDate=2026-08-01/);
}

async function main() {
{
  const requested: string[] = [];
  const report = await fetchCanceledMembershipsReportRows({
    apiKey: "k",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    fetchPage: async (path) => {
      requested.push(path);
      return fakeFetchResponse({
        data: nRows(50),
        nextPageUrl: "http://arboxserver.arboxapp.com/api/public/v3/reports/canceledMembershipsReport?page=2",
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
  const report = await fetchCanceledMembershipsReportRows({
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
        nextPageUrl: "http://arboxserver.arboxapp.com/api/public/v3/reports/canceledMembershipsReport?page=2",
      });
    },
  });
  assert.equal(report.ok, true);
  if (!report.ok) throw new Error("expected ok");
  assert.equal(report.rows.length, 250);
  assert.equal(report.pagesFetched, 2);
  assert.deepEqual(requested, [pagePath(), pagePath(2)]);
  assert.ok(requested.every((p) => p.includes("fromDate=2026-08-01")));
  assert.ok(requested.every((p) => !p.startsWith("http")));
}

{
  const capLogs: { max_pages: number; location_id: string }[] = [];
  const report = await fetchCanceledMembershipsReportRows({
    apiKey: "k",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    locationId: "20547",
    fetchPage: async () =>
      fakeFetchResponse({
        data: nRows(ARBOX_REPORT_PAGE_SIZE),
        nextPageUrl: "http://x?page=99",
      }),
    onPageCap: (info) => capLogs.push(info),
  });
  assert.equal(report.ok, true);
  if (!report.ok) throw new Error("expected ok");
  assert.equal(report.pagesFetched, MAX_SALES_REPORT_PAGES);
  assert.equal(report.hitPageCap, true);
  assert.deepEqual(capLogs, [{ max_pages: MAX_SALES_REPORT_PAGES, location_id: "20547" }]);
}

{
  const warns: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args);
  };
  try {
    const report = await fetchCanceledMembershipsReportRows({
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
    assert.equal(
      warns[0]![0],
      "[leads/arbox-membership-cancelled] canceledMembershipsReport pagination capped"
    );
  } finally {
    console.warn = originalWarn;
  }
}

/** Newest first: day 0 = 2026-10-08, one row per day going back. */
function datedRows(n: number, offsetDays = 0): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 8) - (offsetDays + i) * 86_400_000).toISOString().slice(0, 10);
    return { user_id: offsetDays + i + 1, cancelled_time: `${d} 10:00:00` };
  });
}

assert.equal(canceledReportPageEndsBefore(datedRows(5), "2026-10-07"), true);
assert.equal(canceledReportPageEndsBefore(datedRows(2), "2026-10-07"), false);
assert.equal(canceledReportPageEndsBefore([...datedRows(5)].reverse(), "2026-10-07"), false);
assert.equal(canceledReportPageEndsBefore([{ user_id: 1 }], "2026-10-07"), false);

// Range ignored by Arbox: stop after page 1 once it reaches before fromDate.
{
  const paths: string[] = [];
  const report = await fetchCanceledMembershipsReportRows({
    apiKey: "k",
    fromDate: "2026-10-07",
    toDate: "2026-10-08",
    locationId: "20547",
    fetchPage: async (path) => {
      paths.push(path);
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page") ?? "1");
      return fakeFetchResponse({
        data: datedRows(ARBOX_REPORT_PAGE_SIZE, (page - 1) * ARBOX_REPORT_PAGE_SIZE),
        nextPageUrl: page < 11 ? `http://x?page=${page + 1}` : null,
      });
    },
  });
  assert.equal(report.ok, true);
  if (!report.ok) throw new Error("expected ok");
  assert.equal(paths.length, 1);
  assert.equal(report.stoppedAtFromDate, true);
  // Legacy full paging for measurement
  paths.length = 0;
  const full = await fetchCanceledMembershipsReportRows({
    apiKey: "k",
    fromDate: "2026-10-07",
    toDate: "2026-10-08",
    locationId: "20547",
    stopAtFromDate: false,
    fetchPage: async (path) => {
      paths.push(path);
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page") ?? "1");
      return fakeFetchResponse({
        data: datedRows(ARBOX_REPORT_PAGE_SIZE, (page - 1) * ARBOX_REPORT_PAGE_SIZE),
        nextPageUrl: page < 11 ? `http://x?page=${page + 1}` : null,
      });
    },
  });
  assert.equal(full.ok, true);
  assert.equal(paths.length, 11);
}

// Unsorted page: keep paging (old behaviour).
{
  let calls = 0;
  const report = await fetchCanceledMembershipsReportRows({
    apiKey: "k",
    fromDate: "2026-10-07",
    toDate: "2026-10-08",
    locationId: "20547",
    fetchPage: async () => {
      calls += 1;
      return fakeFetchResponse({
        data: calls === 1 ? [...datedRows(ARBOX_REPORT_PAGE_SIZE)].reverse() : datedRows(3),
        nextPageUrl: calls === 1 ? "http://x?page=2" : null,
      });
    },
  });
  assert.equal(report.ok, true);
  assert.equal(calls, 2);
}

// Time budget: no page starts with < CANCELED_REPORT_MIN_PAGE_MS left; partial rows are kept.
{
  let clock = 0;
  const timeouts: Array<number | undefined> = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const report = await fetchCanceledMembershipsReportRows({
      apiKey: "k",
      fromDate: "2020-01-01",
      toDate: "2026-10-08",
      locationId: "20547",
      deadlineMs: 12_000,
      nowMs: () => clock,
      fetchPage: async (_path, init) => {
        timeouts.push((init as { timeoutMs?: number }).timeoutMs);
        clock += 5_000;
        return fakeFetchResponse({ data: datedRows(ARBOX_REPORT_PAGE_SIZE), nextPageUrl: "http://x?page=9" });
      },
    });
    assert.equal(report.ok, true);
    if (!report.ok) throw new Error("expected ok");
    assert.equal(report.stoppedForBudget, true);
    assert.equal(report.pagesFetched, 2);
    assert.equal(report.rows.length, 2 * ARBOX_REPORT_PAGE_SIZE);
    assert.deepEqual(timeouts, [12_000, 7_000]);

    clock = 0;
    const none = await fetchCanceledMembershipsReportRows({
      apiKey: "k",
      fromDate: "2020-01-01",
      toDate: "2026-10-08",
      locationId: "20547",
      deadlineMs: CANCELED_REPORT_MIN_PAGE_MS - 1,
      nowMs: () => clock,
      fetchPage: async () => {
        throw new Error("must not fetch");
      },
    });
    assert.equal(none.ok, false);
  } finally {
    console.warn = originalWarn;
  }
}

console.log("arbox-canceled-memberships-report.test.ts: ok");
}

void main();
