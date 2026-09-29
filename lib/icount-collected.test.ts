import assert from "node:assert/strict";
import { parseIcountInvrecRows, sumCollectedByClient } from "@/lib/icount-v3";

const rows = parseIcountInvrecRows([
  { client_id: "1", total: "5.90", is_cancelled: false, is_cancellation: 0 },
  { client_id: "1", total: "352.82", is_cancelled: 0 },
  { client_id: "2", total: "259", is_cancelled: true },
  { client_id: "3", total: "100", is_cancellation: "1" },
  { client_id: "", total: "50" },
]);

assert.equal(rows.length, 4);
const sums = sumCollectedByClient(rows);
assert.equal(sums.get("1"), 358.72);
assert.equal(sums.has("2"), false);
assert.equal(sums.has("3"), false);

console.log("icount-collected.test.ts ok");
