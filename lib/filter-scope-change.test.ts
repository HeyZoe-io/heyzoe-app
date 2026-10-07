import assert from "node:assert/strict";
import { trialReminderNormalSendAt } from "@/lib/filter-scope-change";

const shay = trialReminderNormalSendAt({
  classDateYmd: "2026-10-07",
  classTime: "09:30",
  delayDays: 0,
});
assert.equal(shay?.toISOString(), "2026-10-06T17:30:00.000Z");

const reut = trialReminderNormalSendAt({
  classDateYmd: "2026-10-08",
  classTime: "20:00",
  delayDays: 0,
});
assert.equal(reut?.toISOString(), "2026-10-08T06:00:00.000Z");

console.log("filter-scope-change.test.ts: ok");
