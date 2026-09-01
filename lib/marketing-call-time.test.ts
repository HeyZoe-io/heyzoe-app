import assert from "node:assert/strict";
import {
  computeCallDayDueAt,
  israelWallTimeToUtc,
  parseMarketingCallDay,
  parseMarketingCallSlot,
} from "@/lib/marketing-call-time";

const noonUtc = new Date("2026-08-30T12:00:00.000Z");

{
  const parsed = parseMarketingCallSlot("מחר 18:00", noonUtc);
  assert.ok(parsed);
  assert.equal(parsed.timeHm, "18:00");
  assert.equal(parsed.dateYmd, "2026-08-31");
  assert.equal(parsed.hasDate, true);
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
  assert.ok(due);
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
  assert.ok(due);
  assert.equal(due.getTime(), now.getTime());
}

{
  const now = new Date("2026-08-30T10:00:00.000Z");
  const due = computeCallDayDueAt({
    dateYmd: "2026-08-20",
    delayDays: 0,
    delayDirection: "after",
    now,
  });
  assert.equal(due, null);
}

{
  const parsed = parseMarketingCallSlot("10:00", noonUtc);
  assert.ok(parsed);
  assert.equal(parsed.hasDate, false);
  assert.equal(parsed.dateYmd, null);
  assert.equal(parsed.timeHm, "10:00");
}

{
  assert.equal(parseMarketingCallDay("רביעי", noonUtc), "2026-09-02");
  assert.equal(parseMarketingCallDay("מחר", noonUtc), "2026-08-31");
}

console.log("marketing-call-time.test.ts ok");
