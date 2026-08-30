import assert from "node:assert/strict";
import {
  computeCallDayDueAt,
  israelWallTimeToUtc,
  parseMarketingCallSlot,
} from "@/lib/marketing-call-time";

const noonUtc = new Date("2026-08-30T12:00:00.000Z");

{
  const parsed = parseMarketingCallSlot("מחר 18:00", noonUtc);
  assert.ok(parsed);
  assert.equal(parsed.timeHm, "18:00");
  assert.equal(parsed.dateYmd, "2026-08-31");
}

{
  const parsed = parseMarketingCallSlot("היום 14:00", noonUtc);
  assert.ok(parsed);
  assert.equal(parsed.dateYmd, "2026-08-30");
  assert.equal(parsed.timeHm, "14:00");
}

{
  const parsed = parseMarketingCallSlot("30.08 10:00", noonUtc);
  assert.ok(parsed);
  assert.equal(parsed.dateYmd, "2026-08-30");
  assert.equal(parsed.timeHm, "10:00");
}

{
  const parsed = parseMarketingCallSlot("רק טקסט בלי שעה", noonUtc);
  assert.equal(parsed, null);
}

{
  const due = israelWallTimeToUtc("2026-08-30", "08:00");
  assert.equal(due.toISOString(), "2026-08-30T05:00:00.000Z");
}

{
  const now = new Date("2026-08-29T10:00:00.000Z");
  const due = computeCallDayDueAt({
    dateYmd: "2026-08-30",
    delayDays: 0,
    delayDirection: "after",
    now,
  });
  assert.equal(due.toISOString(), "2026-08-30T05:00:00.000Z");
}

{
  const now = new Date("2026-08-30T10:00:00.000Z");
  const due = computeCallDayDueAt({
    dateYmd: "2026-08-30",
    delayDays: 0,
    delayDirection: "after",
    now,
  });
  assert.equal(due.getTime(), now.getTime());
}

console.log("marketing-call-time.test.ts ok");
