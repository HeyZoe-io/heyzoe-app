import assert from "node:assert/strict";
import {
  memberFlagReportIsComplete,
  syncArboxMemberFlags,
} from "@/lib/leads/arbox-member-flag";

type Contact = {
  id: string;
  business_id: number;
  phone: string;
  arbox_is_member: boolean;
};

function mockAdmin(contacts: Contact[]) {
  const writes: { id: string; to: boolean }[] = [];
  let queries = 0;
  const admin = {
    from() {
      queries += 1;
      let patch: { arbox_is_member: boolean } | null = null;
      const filters: { col: string; op: "eq" | "in"; value: unknown }[] = [];
      const matches = () =>
        contacts.filter((row) =>
          filters.every((filter) => {
            const value = (row as Record<string, unknown>)[filter.col];
            if (filter.op === "eq") return value === filter.value;
            return Array.isArray(filter.value) && filter.value.includes(value);
          })
        );
      const builder = {
        update(next: { arbox_is_member: boolean }) {
          patch = next;
          return builder;
        },
        select() {
          return builder;
        },
        eq(col: string, value: unknown) {
          filters.push({ col, op: "eq", value });
          return builder;
        },
        in(col: string, value: unknown) {
          filters.push({ col, op: "in", value });
          return builder;
        },
        range() {
          return builder;
        },
        then(resolve: (value: { data: { id: string; phone?: string }[]; error: null }) => void) {
          const rows = matches();
          if (patch) {
            const changed = rows.filter((row) => row.arbox_is_member !== patch!.arbox_is_member);
            for (const row of changed) {
              writes.push({ id: row.id, to: patch.arbox_is_member });
              row.arbox_is_member = patch.arbox_is_member;
            }
            resolve({ data: changed.map((row) => ({ id: row.id })), error: null });
            return;
          }
          resolve({
            data: rows.map((row) => ({ id: row.id, phone: row.phone })),
            error: null,
          });
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, writes, contacts, queryCount: () => queries };
}

const BUSINESS = 7;

function contacts(): Contact[] {
  return [
    { id: "new", business_id: BUSINESS, phone: "972501111111", arbox_is_member: false },
    { id: "stable", business_id: BUSINESS, phone: "972503333333", arbox_is_member: true },
    { id: "expired", business_id: BUSINESS, phone: "972502222222", arbox_is_member: true },
    { id: "lead", business_id: BUSINESS, phone: "972504444444", arbox_is_member: false },
    { id: "other-biz", business_id: 9, phone: "972502222222", arbox_is_member: true },
  ];
}

const completeRows = [
  { status: "active", phone: "0501111111" },
  { status: "active", phone: "0503333333" },
  { status: "expired", phone: "0502222222" },
];

assert.equal(memberFlagReportIsComplete({ ok: true, hitPageCap: false }), true);
assert.equal(memberFlagReportIsComplete({ ok: true, hitPageCap: true }), false);
assert.equal(memberFlagReportIsComplete({ ok: false, hitPageCap: false }), false);
assert.equal(memberFlagReportIsComplete(null), false);

async function main(): Promise<void> {
const complete = mockAdmin(contacts());
const synced = await syncArboxMemberFlags({
  admin: complete.admin,
  businessId: BUSINESS,
  membershipRows: completeRows,
  reportComplete: true,
});
assert.equal(synced.marked_true, 1);
assert.equal(synced.marked_false, 1);
assert.equal(complete.contacts.find((row) => row.id === "new")?.arbox_is_member, true);
assert.equal(complete.contacts.find((row) => row.id === "expired")?.arbox_is_member, false);
assert.equal(complete.contacts.find((row) => row.id === "stable")?.arbox_is_member, true);
assert.equal(complete.contacts.find((row) => row.id === "lead")?.arbox_is_member, false);
assert.equal(complete.contacts.find((row) => row.id === "other-biz")?.arbox_is_member, true);
assert.deepEqual(
  complete.writes.map((row) => row.id).sort(),
  ["expired", "new"]
);

const partial = mockAdmin(contacts());
const skippedPartial = await syncArboxMemberFlags({
  admin: partial.admin,
  businessId: BUSINESS,
  membershipRows: completeRows.slice(0, 1),
  reportComplete: false,
});
assert.equal(skippedPartial.skipped, "report_incomplete");
assert.equal(partial.queryCount(), 0);
assert.equal(partial.writes.length, 0);
assert.equal(partial.contacts.find((row) => row.id === "expired")?.arbox_is_member, true);
assert.equal(partial.contacts.find((row) => row.id === "new")?.arbox_is_member, false);

const failed = mockAdmin(contacts());
const skippedFailed = await syncArboxMemberFlags({
  admin: failed.admin,
  businessId: BUSINESS,
  membershipRows: [],
  reportComplete: false,
});
assert.equal(skippedFailed.skipped, "report_incomplete");
assert.equal(failed.queryCount(), 0);
assert.equal(failed.writes.length, 0);
console.log("arbox-member-flag.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
