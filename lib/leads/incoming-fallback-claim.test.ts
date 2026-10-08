import assert from "node:assert/strict";
import { incomingFallbackWindow } from "./incoming-fallback-claim";

type Row = Record<string, unknown>;

function fakeAdmin(rows: Row[], error: { message: string } | null = null) {
  return {
    from() {
      const eqs: Array<[string, unknown]> = [];
      let since = "";
      const query = {
        select: () => query,
        eq(column: string, value: unknown) {
          eqs.push([column, value]);
          return query;
        },
        gte(_column: string, value: string) {
          since = value;
          return query;
        },
        order: () => query,
        limit: () =>
          Promise.resolve({
            data: error
              ? null
              : rows.filter(
                  (row) => eqs.every(([c, v]) => row[c] === v) && String(row.processed_at) >= since
                ),
            error,
          }),
      };
      return query;
    },
  } as never;
}

const PHONE = "972501112233";
const now = new Date("2026-10-08T21:30:00.000Z");
const row = (status: string, processedAt: string, sentDay: string, attempts = 0) => ({
  business_id: 1,
  phone: PHONE,
  status,
  attempts,
  sent_day: sentDay,
  processed_at: processedAt,
});

async function main() {
  assert.deepEqual(await incomingFallbackWindow(fakeAdmin([]), 1, PHONE, now), { state: "open", attempts: 0 });

  // 23:00 Israel yesterday → still inside 24h even though the Israel day changed.
  const lateYesterday = row("sent", "2026-10-08T20:00:00.000Z", "2026-10-08");
  assert.deepEqual(await incomingFallbackWindow(fakeAdmin([lateYesterday]), 1, PHONE, now), { state: "blocked" });

  const old = row("sent", "2026-10-07T21:00:00.000Z", "2026-10-08");
  assert.deepEqual(await incomingFallbackWindow(fakeAdmin([old]), 1, PHONE, now), { state: "open", attempts: 0 });

  for (const status of ["sending", "unknown"]) {
    const r = row(status, "2026-10-08T21:00:00.000Z", "2026-10-09");
    assert.deepEqual(await incomingFallbackWindow(fakeAdmin([r]), 1, PHONE, now), { state: "blocked" }, status);
  }

  const failedToday = row("failed", "2026-10-08T21:10:00.000Z", "2026-10-09", 2);
  assert.deepEqual(await incomingFallbackWindow(fakeAdmin([failedToday]), 1, PHONE, now), { state: "open", attempts: 2 });

  const otherBusiness = { ...lateYesterday, business_id: 2 };
  assert.deepEqual(await incomingFallbackWindow(fakeAdmin([otherBusiness]), 1, PHONE, now), { state: "open", attempts: 0 });

  const missing = fakeAdmin([], { message: 'relation "public.incoming_lead_fallback_send_log" does not exist' });
  assert.deepEqual(await incomingFallbackWindow(missing, 1, PHONE, now), { state: "missing_table" });

  const broken = fakeAdmin([], { message: "timeout" });
  assert.deepEqual(await incomingFallbackWindow(broken, 1, PHONE, now), { state: "error", error: "timeout" });

  console.log("incoming-fallback-claim.test.ts ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
