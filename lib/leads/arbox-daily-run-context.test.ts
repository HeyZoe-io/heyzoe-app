import assert from "node:assert/strict";
import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  fetchArboxBookingsReport,
  rememberSharedFutureBookings,
} from "@/lib/leads/arbox-trial-attended";
import { runArboxDailyContext } from "@/lib/leads/arbox-daily-run-context";
import { arboxDailyContext, isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";

type FetchCall = { signal: AbortSignal | undefined; businessId: number | undefined };

function context(businessId: number, dryRun: boolean) {
  return {
    businessId,
    dryRun,
    timeoutMs: 15_000,
    arboxCalls: 0,
    arboxReports: [] as string[],
    membershipTypesByKey: new Map<string, Promise<unknown>>(),
  };
}

function bookings(userId: string) {
  return {
    ok: true as const,
    rows: [{ user_id: userId, date: "2026-09-29" }],
    pagesFetched: 1,
    fromDate: "2026-09-28",
    toDate: "2026-10-12",
  };
}

async function main() {
  const bridge = (globalThis as { __hzArboxDaily?: { context?: unknown; isDryRun?: unknown } })
    .__hzArboxDaily;
  assert.equal(typeof bridge?.context, "function");
  assert.equal(typeof bridge?.isDryRun, "function");

  const ctxA = context(3445, true);
  const ctxB = context(3251, false);
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push({
      signal: init?.signal ?? undefined,
      businessId: arboxDailyContext()?.businessId,
    });
    return new Response(JSON.stringify({ data: [{ user_id: "network", date: "2026-08-01" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  let release: () => void = () => {};
  const bothInside = new Promise<void>((resolve) => {
    release = resolve;
  });
  let inside = 0;
  function markInside() {
    inside += 1;
    if (inside === 2) release();
  }

  const outside = (async () => {
    await bothInside;
    assert.equal(isArboxDailyDryRun(), false);
    assert.equal(arboxDailyContext(), undefined);
    const report = await fetchArboxBookingsReport({
      apiKey: "outside",
      fromDate: "2026-09-29",
      toDate: "2026-10-01",
      locationId: "1",
    });
    assert.equal(report.ok, true);
    if (report.ok) assert.equal(report.rows[0]?.user_id, "network");
    const direct = await arboxPublicFetch("/v3/reports/bookingsReport", {
      apiKey: "outside",
      method: "GET",
    });
    assert.equal(direct.ok, true);
  })();

  const runA = runArboxDailyContext(ctxA, async () => {
    rememberSharedFutureBookings(bookings("biz-a"));
    markInside();
    await bothInside;
    assert.equal(arboxDailyContext()?.businessId, 3445);
    assert.equal(isArboxDailyDryRun(), true);
    const shared = await fetchArboxBookingsReport({
      apiKey: "a",
      fromDate: "2026-09-29",
      toDate: "2026-10-01",
      locationId: "1",
    });
    assert.equal(shared.ok, true);
    if (shared.ok) {
      assert.equal(shared.rows.length, 1);
      assert.equal(shared.rows[0]?.user_id, "biz-a");
    }
    await arboxPublicFetch("/v3/reports/bookingsReport", { apiKey: "a", method: "GET" });
    assert.equal(ctxA.arboxCalls, 1);
    assert.equal(ctxB.arboxCalls, 0);
  });

  const runB = runArboxDailyContext(ctxB, async () => {
    rememberSharedFutureBookings(bookings("biz-b"));
    markInside();
    await bothInside;
    assert.equal(arboxDailyContext()?.businessId, 3251);
    assert.equal(isArboxDailyDryRun(), false);
    const shared = await fetchArboxBookingsReport({
      apiKey: "b",
      fromDate: "2026-09-29",
      toDate: "2026-10-01",
      locationId: "1",
    });
    assert.equal(shared.ok, true);
    if (shared.ok) {
      assert.equal(shared.rows.length, 1);
      assert.equal(shared.rows[0]?.user_id, "biz-b");
    }
  });

  try {
    await Promise.all([runA, runB, outside]);

  assert.equal(ctxA.arboxCalls, 1);
  assert.equal(ctxB.arboxCalls, 0);
  const outsideCalls = calls.filter((call) => call.businessId === undefined);
  assert.ok(outsideCalls.length >= 1);
  for (const call of outsideCalls) assert.equal(call.signal, undefined);
  const insideA = calls.filter((call) => call.businessId === 3445);
  assert.equal(insideA.length, 1);
  assert.ok(insideA[0]?.signal instanceof AbortSignal);
  assert.equal(calls.some((call) => call.businessId === 3251), false);

  const later = context(1, true);
  await runArboxDailyContext(later, async () => {
    const report = await fetchArboxBookingsReport({
      apiKey: "later",
      fromDate: "2026-09-29",
      toDate: "2026-10-01",
      locationId: "1",
    });
    assert.equal(report.ok, true);
    if (report.ok) assert.equal(report.rows[0]?.user_id, "network");
    assert.equal(later.businessId, 1);
    assert.notEqual(arboxDailyContext(), ctxA);
    assert.notEqual(arboxDailyContext(), ctxB);
  });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main()
  .then(() => console.log("arbox-daily-run-context.test ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
