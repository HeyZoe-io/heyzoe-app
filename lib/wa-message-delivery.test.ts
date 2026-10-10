import assert from "node:assert/strict";
import {
  deliveryErrorHebrew,
  foldDeliveryStatuses,
  strongerDeliveryState,
} from "./wa-delivery-errors";
import {
  attachMessageDeliveries,
  markFailedDeliverySeen,
  markSessionsWithFailedDelivery,
  selectMessagesWithWamid,
} from "./wa-message-delivery";

type Call = { table: string; filters: Array<[string, string, unknown]>; update?: unknown };

function fakeAdmin(
  rowsFor: (call: Call) => unknown[],
  errorFor: (call: Call) => { message: string } | null = () => null
) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const q = {
        select: () => q,
        update: (v: unknown) => ((call.update = v), q),
        in: (col: string, v: unknown) => (call.filters.push(["in", col, v]), q),
        eq: (col: string, v: unknown) => (call.filters.push(["eq", col, v]), q),
        gte: (col: string, v: unknown) => (call.filters.push(["gte", col, v]), q),
        is: (col: string, v: unknown) => (call.filters.push(["is", col, v]), q),
        like: (col: string, v: unknown) => (call.filters.push(["like", col, v]), q),
        limit: () => q,
        then: (resolve: (r: unknown) => void) => {
          const error = errorFor(call);
          resolve(error ? { data: null, error } : { data: rowsFor(call), error: null });
        },
      };
      return q;
    },
  };
  return { admin: admin as never, calls };
}

// Hebrew error texts
assert.match(deliveryErrorHebrew(131042), /תשלום/);
assert.match(deliveryErrorHebrew(131049), /שיווק/);
assert.match(deliveryErrorHebrew(131026), /לא ניתן למסור|לא נמסרה|וואטסאפ/);
assert.match(deliveryErrorHebrew(131047), /24/);
assert.match(deliveryErrorHebrew(131050), /הסיר|הפסיק|ביקש/);
assert.match(deliveryErrorHebrew(132001), /תבנית/);
assert.match(deliveryErrorHebrew(132999), /תבנית/);
assert.match(deliveryErrorHebrew(999123), /999123/);

// Status folding
assert.equal(strongerDeliveryState("read", "delivered"), "read");
assert.equal(strongerDeliveryState("delivered", "failed"), "failed");
const folded = foldDeliveryStatuses([
  { wamid: "w1", status: "sent" },
  { wamid: "w1", status: "read" },
  { wamid: "w1", status: "delivered" },
  { wamid: "w2", status: "failed", error_code: 131042, error_title: "x" },
  { wamid: "w3", status: "bogus" },
]);
assert.equal(folded.get("w1")?.status, "read");
assert.equal(folded.get("w2")?.status, "failed");
assert.equal(folded.get("w2")?.error_code, 131042);
assert.match(String(folded.get("w2")?.error_text), /תשלום/);
assert.equal(folded.has("w3"), false);

async function main() {
  // Missing wamid column → second run without it
  const seen: string[] = [];
  const res = await selectMessagesWithWamid(async (cols) => {
    seen.push(cols);
    return cols.includes("wamid")
      ? { data: null, error: { message: "column messages.wamid does not exist" } }
      : { data: [{ role: "user" }], error: null };
  });
  assert.equal(seen.length, 2);
  assert.equal(res.error, null);

  // Other errors are not retried
  seen.length = 0;
  await selectMessagesWithWamid(async (cols) => {
    seen.push(cols);
    return { data: null, error: { message: "timeout" } };
  });
  assert.equal(seen.length, 1);

  // One batched status query for the whole conversation
  const { admin, calls } = fakeAdmin(() => [
    { wamid: "a", status: "delivered" },
    { wamid: "a", status: "read" },
    { wamid: "b", status: "failed", error_code: 131049 },
  ]);
  const out = await attachMessageDeliveries(admin, [
    { role: "user", content: "hi", wamid: "u1" },
    { role: "assistant", content: "x", wamid: "a" },
    { role: "assistant", content: "y", wamid: "b" },
    { role: "assistant", content: "z", wamid: null },
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.filters[0], ["in", "wamid", ["a", "b"]]);
  assert.equal(out[1]!.delivery?.status, "read");
  assert.equal(out[2]!.delivery?.status, "failed");
  assert.equal(out[0]!.delivery, undefined);
  assert.equal(out[3]!.delivery, undefined);
  assert.equal("wamid" in out[1]!, false);

  // No outbound wamids → no query
  const empty = fakeAdmin(() => []);
  await attachMessageDeliveries(empty.admin, [{ role: "assistant", content: "x" }]);
  assert.equal(empty.calls.length, 0);

  // 450 wamids → 3 chunked queries
  const big = fakeAdmin(() => []);
  await attachMessageDeliveries(
    big.admin,
    Array.from({ length: 450 }, (_, i) => ({ role: "assistant", wamid: `w${i}` }))
  );
  assert.equal(big.calls.length, 3);

  // Failed filter: per business
  const list = fakeAdmin(() => [
    { business_id: 7, recipient_phone: "972501234567" },
    { business_id: 8, recipient_phone: "972509999999" },
  ]);
  const marked = await markSessionsWithFailedDelivery(
    list.admin,
    [
      { session_id: "wa_1_972501234567", phone: "0501234567" },
      { session_id: "wa_1_972509999999", phone: "0509999999" },
    ],
    { businessId: 7 }
  );
  assert.equal(list.calls.length, 1);
  assert.deepEqual(list.calls[0]!.filters.find((f) => f[1] === "business_id"), ["eq", "business_id", 7]);
  assert.equal(marked[0]!.hasFailedDelivery, true);
  assert.equal(marked[1]!.hasFailedDelivery, undefined);

  // Zoe admin "all": slug → id
  const all = fakeAdmin(() => [{ business_id: 8, recipient_phone: "972509999999" }]);
  const markedAll = await markSessionsWithFailedDelivery(
    all.admin,
    [
      { session_id: "wa_1_972509999999", source_slug: "b8" },
      { session_id: "wa_2_972509999999", source_slug: "b7" },
    ],
    { businessIdBySlug: new Map([["b7", 7], ["b8", 8]]) }
  );
  assert.equal(markedAll[0]!.hasFailedDelivery, true);
  assert.equal(markedAll[1]!.hasFailedDelivery, undefined);
  assert.equal(all.calls[0]!.filters.some((f) => f[1] === "seen_at"), false);

  // Owner list: unseen only
  const unseen = fakeAdmin(() => [{ business_id: 7, recipient_phone: "972501234567" }]);
  await markSessionsWithFailedDelivery(
    unseen.admin,
    [{ session_id: "wa_1_972501234567" }],
    { businessId: 7 },
    { unseenOnly: true }
  );
  assert.equal(unseen.calls.length, 1);
  assert.deepEqual(unseen.calls[0]!.filters.find((f) => f[1] === "seen_at"), ["is", "seen_at", null]);

  // seen_at not migrated yet → every failure, as before
  const noColumn = fakeAdmin(
    () => [{ business_id: 7, recipient_phone: "972501234567" }],
    (call) =>
      call.filters.some((f) => f[1] === "seen_at")
        ? { message: "column wa_message_statuses.seen_at does not exist" }
        : null
  );
  const fallback = await markSessionsWithFailedDelivery(
    noColumn.admin,
    [{ session_id: "wa_1_972501234567" }],
    { businessId: 7 },
    { unseenOnly: true }
  );
  assert.equal(noColumn.calls.length, 2);
  assert.equal(fallback[0]!.hasFailedDelivery, true);

  // Opening the chat stamps seen_at on that phone's failures for the business only
  const seenUpdate = fakeAdmin(() => [{ wamid: "w1" }, { wamid: "w2" }]);
  const now = new Date("2026-10-10T09:00:00.000Z");
  const seenRes = await markFailedDeliverySeen(seenUpdate.admin, {
    businessId: 7,
    phone: "050-123-4567",
    sessionId: "wa_1_972501234567",
    now,
  });
  assert.deepEqual(seenRes, { ok: true, cleared: 2 });
  assert.deepEqual(seenUpdate.calls[0]!.update, { seen_at: now.toISOString() });
  const f = seenUpdate.calls[0]!.filters;
  assert.deepEqual(f.find((x) => x[1] === "business_id"), ["eq", "business_id", 7]);
  assert.deepEqual(f.find((x) => x[1] === "status"), ["eq", "status", "failed"]);
  assert.deepEqual(f.find((x) => x[1] === "recipient_phone"), ["like", "recipient_phone", "%501234567"]);
  assert.deepEqual(f.find((x) => x[1] === "seen_at"), ["is", "seen_at", null]);

  // No phone → no query
  const noPhone = fakeAdmin(() => []);
  const noPhoneRes = await markFailedDeliverySeen(noPhone.admin, { businessId: 7, sessionId: "abc" });
  assert.equal(noPhoneRes.ok, false);
  assert.equal(noPhone.calls.length, 0);

  // Missing column → reported, not thrown
  const seenMissing = fakeAdmin(
    () => [],
    () => ({ message: "column wa_message_statuses.seen_at does not exist" })
  );
  const missingRes = await markFailedDeliverySeen(seenMissing.admin, {
    businessId: 7,
    sessionId: "wa_1_972501234567",
  });
  assert.equal(missingRes.ok, false);

  console.log("wa-message-delivery tests passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
