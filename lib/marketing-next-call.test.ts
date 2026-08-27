import assert from "node:assert/strict";
import {
  formatNextCallLabel,
  isHumanCallOverdue,
  nextCallSortMs,
  toPipelineDateOnly,
  toPipelineTime,
} from "@/lib/marketing-next-call";

assert.equal(toPipelineDateOnly("2026-08-27"), "2026-08-27");
assert.equal(toPipelineDateOnly(""), null);
assert.equal(toPipelineTime("14:30"), "14:30");
assert.equal(toPipelineTime("14:30:00"), "14:30");
assert.equal(toPipelineTime("9:05"), null);
assert.equal(toPipelineTime("24:00"), null);
assert.equal(toPipelineTime(""), null);

assert.equal(isHumanCallOverdue("2026-08-26", null, "2026-08-27", "10:00"), true);
assert.equal(isHumanCallOverdue("2026-08-27", null, "2026-08-27", "10:00"), false);
assert.equal(isHumanCallOverdue("2026-08-27", "09:00", "2026-08-27", "10:00"), true);
assert.equal(isHumanCallOverdue("2026-08-27", "11:00", "2026-08-27", "10:00"), false);
assert.equal(isHumanCallOverdue("2026-08-28", "08:00", "2026-08-27", "10:00"), false);
assert.equal(isHumanCallOverdue(null, "09:00", "2026-08-27", "10:00"), false);

assert.ok(nextCallSortMs("2026-08-27", "09:00") < nextCallSortMs("2026-08-27", "10:00"));
assert.ok(nextCallSortMs("2026-08-27", null) < nextCallSortMs("2026-08-27", "10:00"));
assert.equal(nextCallSortMs(null, "10:00"), Number.POSITIVE_INFINITY);

assert.equal(formatNextCallLabel("2026-08-27", null), "27.08.2026");
assert.equal(formatNextCallLabel("2026-08-27", "14:30:00"), "27.08.2026 · 14:30");

console.log("marketing-next-call.test.ts: ok");
