import assert from "node:assert/strict";
import {
  isAutobookCandidateRow,
  loadArboxClassAutobookSettings,
  prepareArboxClassAutobookBatch,
  runArboxClassAutobookAfterSale,
  runArboxClassAutobookBeforeSale,
} from "@/lib/leads/arbox-class-autobook-run";

type Resp = { data: unknown; error: { code?: string; message: string } | null };

/** Chainable stand-in for the Supabase client. Every call is recorded; writes are counted. */
function fakeAdmin(byTable: Record<string, Resp>) {
  const calls: { table: string; op: string }[] = [];
  const admin = {
    from(table: string) {
      const resp = byTable[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      const chain = (op: string) => () => {
        calls.push({ table, op });
        return builder;
      };
      for (const op of ["select", "eq", "in", "is", "gte", "order", "limit", "insert", "update", "upsert", "delete"]) {
        builder[op] = chain(op);
      }
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (resolve: (v: Resp) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(resp).then(resolve, reject);
      return builder;
    },
  };
  return { admin: admin as never, calls };
}

const fetchCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown) => {
  fetchCalls.push(String(url));
  throw new Error("network disabled in test");
}) as typeof fetch;

const business = {
  id: 1,
  slug: "biz",
  apiKey: "k",
  crm_box_id: "9",
  arbox_trial_membership_type_ids: [100],
};
const paidTrial = {
  sale_id: 555,
  user_id: 42,
  membership_type_id: 100,
  membership_user_id: 777,
  debt: 0,
  phone: "0500000000",
  start_date: "2026-10-11",
};
const now = new Date("2026-10-12T08:00:00Z");

async function main() {
  // Candidate rows: paid, configured trial, with membership_user_id.
  assert.equal(isAutobookCandidateRow(paidTrial, [100]), true);
  assert.equal(isAutobookCandidateRow({ ...paidTrial, debt: 50 }, [100]), false);
  assert.equal(isAutobookCandidateRow({ ...paidTrial, membership_type_id: 101 }, [100]), false);
  assert.equal(isAutobookCandidateRow({ ...paidTrial, membership_user_id: null }, [100]), false);
  assert.equal(isAutobookCandidateRow({ ...paidTrial, sale_id: "" }, [100]), false);

  // No candidate in the batch: zero reads.
  {
    const { admin, calls } = fakeAdmin({});
    const batch = await prepareArboxClassAutobookBatch({
      admin,
      business,
      rows: [{ ...paidTrial, membership_type_id: 101 }],
      now,
      dryRun: false,
    });
    assert.equal(batch, null);
    assert.equal(calls.length, 0);
  }

  // Migration not run: missing column reads as off, nothing else touched.
  {
    const { admin, calls } = fakeAdmin({
      businesses: { data: null, error: { code: "42703", message: 'column "arbox_class_autobook_enabled" does not exist' } },
    });
    assert.deepEqual(await loadArboxClassAutobookSettings(admin, 1), { enabled: false, bookedText: "" });
    const batch = await prepareArboxClassAutobookBatch({ admin, business, rows: [paidTrial], now, dryRun: false });
    assert.equal(batch, null);
    assert.ok(calls.every((c) => c.table === "businesses" && c.op !== "update"));
  }

  // Flag off.
  {
    const { admin, calls } = fakeAdmin({
      businesses: { data: { arbox_class_autobook_enabled: false, social_links: {} }, error: null },
    });
    const batch = await prepareArboxClassAutobookBatch({ admin, business, rows: [paidTrial], now, dryRun: false });
    assert.equal(batch, null);
    assert.ok(calls.every((c) => c.table === "businesses"));
  }

  // Flag on, attempts table missing: fail closed, no booking.
  {
    const { admin } = fakeAdmin({
      businesses: { data: { arbox_class_autobook_enabled: true, social_links: {} }, error: null },
      arbox_class_autobook_attempts: { data: null, error: { code: "42P01", message: "relation does not exist" } },
    });
    const batch = await prepareArboxClassAutobookBatch({ admin, business, rows: [paidTrial], now, dryRun: false });
    assert.equal(batch, null);
  }

  // Flag on, sale already claimed: no reads, no Arbox call, no handoff when not pending.
  {
    const { admin, calls } = fakeAdmin({
      businesses: {
        data: { arbox_class_autobook_enabled: true, social_links: { arbox_autobook_booked_text: "שריינתי {יום}" } },
        error: null,
      },
      arbox_class_autobook_attempts: {
        data: [{ sale_id: 555, status: "booked", contact_id: "c1", handoff_pending: false }],
        error: null,
      },
    });
    const batch = await prepareArboxClassAutobookBatch({ admin, business, rows: [paidTrial], now, dryRun: false });
    assert.ok(batch);
    assert.equal(batch.bookedText, "שריינתי {יום}");
    const before = calls.length;
    assert.equal(await runArboxClassAutobookBeforeSale(batch, paidTrial), false);
    await runArboxClassAutobookAfterSale(batch, paidTrial, true);
    assert.equal(calls.length, before);
  }

  // Sale the handler already took before the flag was on: never booked late.
  {
    const { admin, calls } = fakeAdmin({
      businesses: { data: { arbox_class_autobook_enabled: true, social_links: {} }, error: null },
      arbox_class_autobook_attempts: { data: [], error: null },
      arbox_trial_sync_log: { data: [{ sale_id: 555 }], error: null },
    });
    const batch = await prepareArboxClassAutobookBatch({ admin, business, rows: [paidTrial], now, dryRun: false });
    assert.ok(batch);
    const before = calls.length;
    assert.equal(await runArboxClassAutobookBeforeSale(batch, paidTrial), false);
    await runArboxClassAutobookAfterSale(batch, paidTrial, true);
    assert.equal(calls.length, before);
  }

  // Out of time budget: postponed before any read.
  {
    const { admin, calls } = fakeAdmin({
      businesses: { data: { arbox_class_autobook_enabled: true, social_links: {} }, error: null },
      arbox_class_autobook_attempts: { data: [], error: null },
    });
    const batch = await prepareArboxClassAutobookBatch({
      admin,
      business,
      rows: [paidTrial],
      now,
      dryRun: false,
      deadlineMs: Date.now() + 1_000,
    });
    assert.ok(batch);
    const before = calls.length;
    assert.equal(await runArboxClassAutobookBeforeSale(batch, paidTrial), false);
    assert.equal(calls.length, before);
    assert.equal(batch.summary.budget_skipped, 1);
  }

  // Pending handoff is skipped in dry run and when the handler failed.
  {
    const { admin, calls } = fakeAdmin({
      businesses: { data: { arbox_class_autobook_enabled: true, social_links: {} }, error: null },
      arbox_class_autobook_attempts: {
        data: [{ sale_id: 555, status: "rejected", contact_id: "c1", handoff_pending: true }],
        error: null,
      },
    });
    const dry = await prepareArboxClassAutobookBatch({ admin, business, rows: [paidTrial], now, dryRun: true });
    assert.ok(dry);
    const before = calls.length;
    await runArboxClassAutobookAfterSale(dry, paidTrial, true);
    const live = { ...dry, dryRun: false };
    await runArboxClassAutobookAfterSale(live, paidTrial, false);
    assert.equal(calls.length, before);
  }

  assert.equal(fetchCalls.filter((u) => u.includes("arbox")).length, 0, "no Arbox HTTP");
  globalThis.fetch = realFetch;
  console.log("arbox-class-autobook-run tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
