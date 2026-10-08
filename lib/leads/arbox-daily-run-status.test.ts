import assert from "node:assert/strict";
import { dispatchArboxDailyWorkers } from "./arbox-daily-triggers-dispatch";
import {
  loadIncompleteBusinessIds,
  recordArboxDailyRunStatus,
  stepsWithFetchError,
  workerRunIncomplete,
} from "./arbox-daily-run-status";
import { unsentDetailParam } from "../admin-daily-unsent-summary";

type Row = Record<string, unknown>;

function fakeAdmin(stored: Row[] = []) {
  const upserts: Row[][] = [];
  const admin = {
    from() {
      const eqs: Array<[string, unknown]> = [];
      const query = {
        upsert(rows: Row[]) {
          upserts.push(rows);
          return Promise.resolve({ error: null });
        },
        select: () => query,
        eq(column: string, value: unknown) {
          eqs.push([column, value]);
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: stored.filter((r) => eqs.every(([k, v]) => r[k] === v)), error: null }).then(
            resolve
          );
        },
      };
      return query;
    },
  };
  return { admin: admin as never, upserts };
}

const evening = new Date("2026-10-08T17:30:00Z");

async function main() {
  assert.deepEqual(stepsWithFetchError({ slug: "x", trial_reminder: { fetch_error: "arbox_report_fetch_failed" }, nth_workout: { errors: 0 } }), [
    "trial_reminder",
  ]);
  assert.equal(workerRunIncomplete({ business_id: 1, ok: true, outcome: "ok", body: { summary: { a: { errors: 0 } } } }), null);
  assert.equal(
    workerRunIncomplete({ business_id: 1, ok: false, outcome: "timeout_unknown_outcome", body: null }),
    "timeout_unknown_outcome"
  );

  const calls = new Map<number, number>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const id = Number(new URL(url).searchParams.get("business_id"));
    assert.equal(new URL(url).searchParams.get("slot"), "evening");
    const n = (calls.get(id) ?? 0) + 1;
    calls.set(id, n);
    const json = (status: number, body: unknown) =>
      ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
    if (id === 1) return json(200, { ok: true, summary: { trial_reminder: { errors: 0 } } });
    if (id === 2) return n === 1 ? json(500, { ok: false }) : json(200, { ok: true, summary: {} });
    if (id === 3) return json(500, { ok: false, error: "business_run_failed" });
    if (id === 4) {
      return n === 1
        ? json(200, { ok: true, summary: { trial_reminder: { fetch_error: "arbox_report_fetch_failed" } } })
        : json(200, { ok: true, summary: { trial_reminder: { errors: 0 } } });
    }
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    throw timeout;
  }) as typeof fetch;

  try {
    const dispatched = await dispatchArboxDailyWorkers({
      origin: "https://heyzoe.io",
      businessIds: [1, 2, 3, 4, 5],
      dryRun: false,
      authorization: "Bearer x",
      slot: "evening",
      retryIncomplete: true,
    });
    assert.deepEqual(Object.fromEntries(calls), { 1: 1, 2: 2, 3: 2, 4: 2, 5: 1 }, "one retry, not for ok or timeout");

    const { admin, upserts } = fakeAdmin();
    const recorded = await recordArboxDailyRunStatus({
      admin,
      slot: "evening",
      now: evening,
      pass: "main",
      results: dispatched.businesses,
    });
    assert.deepEqual(recorded.incomplete, [3, 5]);
    const byId = new Map(upserts[0].map((row) => [row.business_id, row]));
    assert.equal(byId.get(2)?.status, "ok");
    assert.equal(byId.get(2)?.attempts, 2);
    assert.equal(byId.get(3)?.status, "incomplete");
    assert.equal(byId.get(3)?.attempts, 2);
    assert.equal(byId.get(5)?.reason, "timeout_unknown_outcome");
    assert.equal(byId.get(1)?.run_day, "2026-10-08");

    calls.clear();
    await dispatchArboxDailyWorkers({
      origin: "https://heyzoe.io",
      businessIds: [3],
      dryRun: true,
      authorization: "Bearer x",
      slot: "evening",
      retryIncomplete: true,
    });
    assert.equal(calls.get(3), 1, "dry run does not retry (no extra Arbox calls)");
  } finally {
    globalThis.fetch = realFetch;
  }

  {
    const { admin } = fakeAdmin([
      { business_id: 3, run_day: "2026-10-08", slot: "evening", status: "incomplete" },
      { business_id: 5, run_day: "2026-10-08", slot: "evening", status: "incomplete" },
      { business_id: 2, run_day: "2026-10-08", slot: "evening", status: "ok" },
      { business_id: 7, run_day: "2026-10-07", slot: "evening", status: "incomplete" },
      { business_id: 8, run_day: "2026-10-08", slot: "morning", status: "incomplete" },
    ]);
    const loaded = await loadIncompleteBusinessIds({ admin, slot: "evening", now: evening });
    assert.deepEqual(loaded, { ok: true, ids: [3, 5] }, "second pass: only today's incomplete evening businesses");
  }

  const detail = unsentDetailParam([
    {
      businessId: 3,
      business: "Apex",
      trigger: "ריצת ערב",
      contact: "",
      reason: "ריצה לא הושלמה",
      at: "08.10 20:35",
      metaError: "failed",
    },
  ]);
  assert.match(detail, /Apex · ריצת ערב · ריצה לא הושלמה/);

  console.log("arbox-daily-run-status.test: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
