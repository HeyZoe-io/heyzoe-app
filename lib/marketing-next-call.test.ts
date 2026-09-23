import assert from "node:assert/strict";
import { formatNextCallLabel, formatScheduledCallParts } from "@/lib/marketing-next-call";

assert.deepEqual(formatScheduledCallParts("2026-08-28", "14:30:00"), {
  date: "28.08.2026",
  time: "14:30",
});
assert.deepEqual(formatScheduledCallParts("2026-09-23", null), {
  date: "23.09.2026",
  time: "",
});
assert.equal(formatScheduledCallParts(null, "14:30"), null);
assert.equal(formatNextCallLabel("2026-08-28", "14:30"), "28.08.2026 · 14:30");

console.log("marketing-next-call.test.ts: ok");
