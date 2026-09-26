import assert from "node:assert/strict";
import {
  formatIsraelDayMonth,
  hasWeeklySlotPassedToday,
  isAllowedWhatsAppSendTimeIsrael,
  listUpcomingIsraelWeekdays,
  nextAllowedWhatsAppSendTimeIsrael,
  resolveNextOccurrence,
  shouldDropFollowupQueueIsrael,
  activeHolidaySendBlockIsrael,
} from "@/lib/israel-time";

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

assert.equal(formatIsraelDayMonth(9, 20), "20.9");

{
  // Wednesday 17:45 Israel — same instant as apex 972523685661 asking «ראשון הקרוב».
  const wedAfternoon = new Date("2026-09-16T14:45:59.000Z");
  const week = listUpcomingIsraelWeekdays(wedAfternoon, 7);
  assert.equal(week.length, 7);
  assert.equal(week[0]!.letter, "ד");
  assert.equal(week[0]!.ymd, "2026-09-16");
  assert.equal(week[4]!.letter, "א");
  assert.equal(week[4]!.ymd, "2026-09-20");
  assert.equal(formatIsraelDayMonth(week[4]!.month, week[4]!.day), "20.9");
  assert.equal(week[5]!.letter, "ב");
  assert.equal(week[5]!.ymd, "2026-09-21");
}

{
  const week = listUpcomingIsraelWeekdays(tueMorning, 7);
  assert.equal(week[0]!.letter, "ג");
  assert.equal(week[0]!.ymd, "2026-09-01");
  const sunday = week.find((d) => d.letter === "א");
  assert.equal(sunday?.ymd, "2026-09-06");
}

// Yom Kippur 5787 — block + drop queue (erev 16:00 → מוצאי 19:00).
{
  // Sunday 20.9.2026 19:30 Israel (inside block)
  const kippurEve = new Date("2026-09-20T16:30:00.000Z");
  assert.equal(activeHolidaySendBlockIsrael(kippurEve)?.id, "yom_kippur_5787");
  assert.equal(isAllowedWhatsAppSendTimeIsrael(kippurEve), false);
  assert.equal(shouldDropFollowupQueueIsrael(kippurEve), true);
  const next = nextAllowedWhatsAppSendTimeIsrael(kippurEve);
  // Monday 21.9.2026 19:00 Israel
  assert.equal(next.toISOString(), new Date("2026-09-21T16:00:00.000Z").toISOString());
  assert.equal(isAllowedWhatsAppSendTimeIsrael(next), true);
  assert.equal(shouldDropFollowupQueueIsrael(next), false);

  // Monday morning still blocked
  const kippurDay = new Date("2026-09-21T07:00:00.000Z"); // 10:00 Israel
  assert.equal(isAllowedWhatsAppSendTimeIsrael(kippurDay), false);
  assert.equal(shouldDropFollowupQueueIsrael(kippurDay), true);

  // Before block starts — Sunday 15:00 Israel still allowed (weekday afternoon)
  const before = new Date("2026-09-20T12:00:00.000Z");
  assert.equal(activeHolidaySendBlockIsrael(before), null);
  assert.equal(isAllowedWhatsAppSendTimeIsrael(before), true);
  assert.equal(shouldDropFollowupQueueIsrael(before), false);

  // Ordinary Tuesday afternoon — not a holiday; Shabbat delay still holds as before
  assert.equal(shouldDropFollowupQueueIsrael(tueEvening), false);
  assert.equal(isAllowedWhatsAppSendTimeIsrael(tueMorning), true);
}

console.log("israel-time.test.ts: ok");
