import assert from "node:assert/strict";
import { hasWeeklySlotPassedToday, resolveNextOccurrence } from "@/lib/israel-time";

// 2026-09-01T07:02:00.000Z = Tuesday 10:02 Israel (see wa-relative-day-class-slots.test.ts).
const tueMorning = new Date("2026-09-01T07:02:00.000Z");
// 2026-09-01T16:45:00.000Z = Tuesday 19:45 Israel.
const tueEvening = new Date("2026-09-01T16:45:00.000Z");

// Today, time still ahead → daysAhead 0, same calendar date.
{
  const r = resolveNextOccurrence("ג", "18:30", tueMorning);
  assert.equal(r.daysAhead, 0);
  assert.equal(r.ymd, "2026-09-01");
}

// Today, time already passed (well past the grace window) → rolls to next week.
{
  const r = resolveNextOccurrence("ג", "18:30", tueEvening);
  assert.equal(r.daysAhead, 7);
  assert.equal(r.ymd, "2026-09-08");
}

// Today, time passed by less than the default grace (15 min) → still counts as upcoming.
{
  const r = resolveNextOccurrence("ג", "10:00", new Date("2026-09-01T07:10:00.000Z")); // 10:10 Israel
  assert.equal(r.daysAhead, 0, "within grace window — not yet considered passed");
}

// Today, time passed by more than the grace window → rolled.
{
  const r = resolveNextOccurrence("ג", "10:00", new Date("2026-09-01T07:20:00.000Z")); // 10:20 Israel
  assert.equal(r.daysAhead, 7);
}

// A different weekday (Thursday, "ה") from Tuesday "now" → 2 days ahead, unaffected by time-of-day.
{
  const r = resolveNextOccurrence("ה", "07:00", tueEvening);
  assert.equal(r.daysAhead, 2);
  assert.equal(r.ymd, "2026-09-03");
}

// hasWeeklySlotPassedToday: false when the requested day isn't today at all.
assert.equal(hasWeeklySlotPassedToday("ה", "07:00", tueEvening), false);

// hasWeeklySlotPassedToday: true only for today + already-passed time.
assert.equal(hasWeeklySlotPassedToday("ג", "18:30", tueMorning), false, "still ahead this morning");
assert.equal(hasWeeklySlotPassedToday("ג", "18:30", tueEvening), true, "18:30 is behind us by 19:45");

console.log("israel-time.test.ts: ok");
