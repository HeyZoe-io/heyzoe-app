import assert from "node:assert/strict";
import {
  buildLeaveRequestIndex,
  createLeaveRequestGate,
  isLeaveRequestKind,
  stampLeaveRequest,
} from "./leave-request";
import { markRetentionSent, retentionMarkedThisProcess } from "./retention-daily-cap";

type Row = Record<string, unknown>;

/** contacts with leave_request_at; gte filters like PostgREST. */
function fakeAdmin(rows: Row[], options: { error?: string } = {}) {
  const updates: Row[] = [];
  let reads = 0;
  const admin = {
    from() {
      const eqs: Array<[string, unknown]> = [];
      let gte: [string, string] | null = null;
      const query = {
        select: () => query,
        eq(column: string, value: unknown) {
          eqs.push([column, value]);
          return query;
        },
        gte(column: string, value: string) {
          gte = [column, value];
          return query;
        },
        in: () => Promise.resolve({ error: null }),
        limit() {
          reads += 1;
          if (options.error) return Promise.resolve({ data: null, error: { message: options.error } });
          return Promise.resolve({
            data: rows.filter(
              (row) =>
                eqs.every(([c, v]) => row[c] === v) &&
                (!gte || (row[gte[0]] != null && String(row[gte[0]]) >= gte[1]))
            ),
            error: null,
          });
        },
        update(patch: Row) {
          updates.push(patch);
          return query;
        },
      };
      return query;
    },
  };
  return { admin: admin as never, updates, reads: () => reads };
}

// Meital Tuvia (Apex 3445, ...4023): cancellation handoff Oct 3 19:22 UTC.
const MEITAL = {
  id: "20fce6ab-d3ac-4237-b375-07bb0bb980a9",
  business_id: 3445,
  phone: "972544204023",
  arbox_user_id: "10973839",
  leave_request_at: "2026-10-03T19:22:45.000Z",
};
const OTHER = { id: "c-2", business_id: 3445, phone: "972500000001", arbox_user_id: "1", leave_request_at: null };

async function main() {
  for (const kind of ["cancellation", "freeze", "complaint"]) assert.equal(isLeaveRequestKind(kind), true, kind);
  for (const kind of ["class_cancel", "reschedule", "medical", "refund", "human_agent", "", null]) {
    assert.equal(isLeaveRequestKind(kind), false, String(kind));
  }

  const index = buildLeaveRequestIndex([MEITAL]);
  assert.equal(index.has({ id: MEITAL.id }), true);
  assert.equal(index.has({ phone: "+972-54-420-4023" }), true);
  assert.equal(index.has({ arbox_user_id: 10973839 }), true);
  assert.equal(index.has({ id: "x", phone: "972500000001", arbox_user_id: 2 }), false);

  // Oct 8 09:00 run: missed_class blocked, and the cap stays taken so attendance_gap cannot use the slot.
  const oct8 = new Date("2026-10-08T06:00:00.000Z");
  const db = fakeAdmin([MEITAL, OTHER]);
  const gate = createLeaveRequestGate(db.admin, 3445, oct8);
  assert.equal(await gate({ id: MEITAL.id, phone: MEITAL.phone, arbox_user_id: 10973839 }), "blocked");
  markRetentionSent(3445, MEITAL.phone, oct8);
  assert.equal(retentionMarkedThisProcess(3445, MEITAL.phone, oct8), true);
  assert.equal(await gate({ id: OTHER.id, phone: OTHER.phone }), "clear");
  assert.equal(db.reads(), 1, "one contacts read per run");

  // 14 days later the window has closed.
  const oct18 = new Date("2026-10-18T06:00:00.000Z");
  assert.equal(await createLeaveRequestGate(fakeAdmin([MEITAL]).admin, 3445, oct18)({ id: MEITAL.id }), "clear");

  // Other business: not blocked.
  assert.equal(await createLeaveRequestGate(fakeAdmin([MEITAL]).admin, 1, oct8)({ id: MEITAL.id }), "clear");

  // Before the SQL: nobody is stamped, retention keeps running.
  const missing = fakeAdmin([], { error: "column contacts.leave_request_at does not exist" });
  assert.equal(await createLeaveRequestGate(missing.admin, 3445, oct8)({ id: MEITAL.id }), "clear");

  // Any other read failure: the caller leaves the event for the next run.
  const broken = fakeAdmin([], { error: "canceling statement due to statement timeout" });
  assert.equal(await createLeaveRequestGate(broken.admin, 3445, oct8)({ id: MEITAL.id }), "error");

  // Stamp only for cancel / freeze / complaint handoffs.
  const stamp = fakeAdmin([]);
  await stampLeaveRequest({ admin: stamp.admin, businessId: 3445, phoneVariants: [MEITAL.phone], kind: "cancellation", nowIso: "2026-10-03T19:22:45.000Z" });
  await stampLeaveRequest({ admin: stamp.admin, businessId: 3445, phoneVariants: [MEITAL.phone], kind: "class_cancel", nowIso: "2026-10-03T19:22:45.000Z" });
  await stampLeaveRequest({ admin: stamp.admin, businessId: 3445, phoneVariants: [MEITAL.phone], kind: undefined, nowIso: "2026-10-03T19:22:45.000Z" });
  assert.deepEqual(stamp.updates, [{ leave_request_at: "2026-10-03T19:22:45.000Z", leave_request_kind: "cancellation" }]);

  console.log("leave-request.test.ts ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
