import assert from "node:assert/strict";
import { claimPurchaseSameDay } from "./purchase-same-day-claim";

type Row = Record<string, unknown>;
const PK = ["business_id", "user_id", "sale_date", "trigger_id"];

function fakeAdmin(options: { insertError?: { code?: string; message: string } } = {}) {
  const rows: Row[] = [];
  const admin = {
    from() {
      const eqs: Array<[string, unknown]> = [];
      const query = {
        insert(row: Row) {
          if (options.insertError) return Promise.resolve({ error: options.insertError });
          if (rows.some((r) => PK.every((k) => r[k] === row[k]))) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
          }
          rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
        select: () => query,
        eq(column: string, value: unknown) {
          eqs.push([column, value]);
          return query;
        },
        maybeSingle() {
          const hit = rows.find((r) => eqs.every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: hit ?? null, error: null });
        },
      };
      return query;
    },
  };
  return { admin: admin as never, rows };
}

/** Tights (3543), Arbox user 4163942: one checkout split into sales 104660498 + 104660523 on Oct 7. */
const noya = {
  businessId: 3543,
  userId: "4163942",
  saleDateYmd: "2026-10-07",
  triggerId: "db457133-a28a-4578-8d94-f5ac60b02911",
};

async function main() {
  {
    const { admin, rows } = fakeAdmin();
    assert.equal(await claimPurchaseSameDay({ admin, ...noya, saleId: 104660498 }), "won");
    assert.equal(
      await claimPurchaseSameDay({ admin, ...noya, saleId: 104660523 }),
      "collapsed",
      "the second sale of the same checkout does not send, even in a later run"
    );
    assert.equal(
      await claimPurchaseSameDay({ admin, ...noya, saleId: 104660498 }),
      "won",
      "the claiming sale can retry after a failed send"
    );
    assert.equal(rows.length, 1);
    assert.equal(
      await claimPurchaseSameDay({ admin, ...noya, triggerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", saleId: 104660523 }),
      "won",
      "another rule is its own claim"
    );
    assert.equal(
      await claimPurchaseSameDay({ admin, ...noya, saleDateYmd: "2026-10-08", saleId: 104660523 }),
      "won",
      "another day is its own claim"
    );
  }

  {
    const { admin } = fakeAdmin();
    const results = await Promise.all([
      claimPurchaseSameDay({ admin, ...noya, saleId: 104660498 }),
      claimPurchaseSameDay({ admin, ...noya, saleId: 104660523 }),
    ]);
    assert.deepEqual(results.sort(), ["collapsed", "won"], "two parallel workers send once");
  }

  {
    const { admin } = fakeAdmin({ insertError: { code: "PGRST205", message: "Could not find the table in the schema cache" } });
    assert.equal(await claimPurchaseSameDay({ admin, ...noya, saleId: 104660498 }), "missing_table");
  }
  {
    const { admin } = fakeAdmin({ insertError: { code: "08006", message: "connection failure" } });
    assert.equal(await claimPurchaseSameDay({ admin, ...noya, saleId: 104660498 }), "error");
  }

  console.log("purchase-same-day-claim.test: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
