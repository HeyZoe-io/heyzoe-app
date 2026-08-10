import assert from "node:assert/strict";
import {
  CALL_SCHEDULE_DAY_OPTIONS,
  CALL_SCHEDULE_SATURDAY_DOW,
  CALL_SCHEDULE_TIME_BLOCKS,
  callScheduleDayButtonLabel,
  dayOfWeekFromHebrewLetter,
  diffCallScheduleSlots,
  hebrewDayLetterFromDow,
  isValidCallScheduleDayOfWeek,
  normalizeCallScheduleSlots,
} from "./call-schedule-slots";
import { HEBREW_DAY_OPTIONS } from "./product-schedule-slots";

assert.equal(CALL_SCHEDULE_SATURDAY_DOW, 6);
assert.equal(CALL_SCHEDULE_DAY_OPTIONS.length, 6);
assert.ok(CALL_SCHEDULE_DAY_OPTIONS.every((d) => d.day_of_week !== CALL_SCHEDULE_SATURDAY_DOW));
assert.equal(isValidCallScheduleDayOfWeek(5), true);
assert.equal(isValidCallScheduleDayOfWeek(6), false);

// day_of_week 0..5 aligns with HEBREW_DAY_OPTIONS (Sunday–Friday); Saturday excluded
for (const day of CALL_SCHEDULE_DAY_OPTIONS) {
  const i = day.day_of_week;
  assert.equal(hebrewDayLetterFromDow(i), HEBREW_DAY_OPTIONS[i]!.value);
  assert.equal(dayOfWeekFromHebrewLetter(HEBREW_DAY_OPTIONS[i]!.value), i);
  assert.ok(callScheduleDayButtonLabel(i).includes(HEBREW_DAY_OPTIONS[i]!.label));
}
assert.equal(dayOfWeekFromHebrewLetter("ש"), null);
assert.equal(callScheduleDayButtonLabel(6), "");

assert.equal(CALL_SCHEDULE_TIME_BLOCKS.length, 7);
assert.deepEqual(
  normalizeCallScheduleSlots([
    { day_of_week: 0, time_block: "08:00-10:00" },
    { day_of_week: 0, time_block: "08:00-10:00" },
    { day_of_week: 6, time_block: "08:00-10:00" },
    { day_of_week: 7, time_block: "08:00-10:00" },
    { day_of_week: 1, time_block: "bogus" },
  ]),
  [{ day_of_week: 0, time_block: "08:00-10:00" }]
);

const { toInsert, toDelete } = diffCallScheduleSlots(
  [
    { day_of_week: 0, time_block: "08:00-10:00" },
    { day_of_week: 1, time_block: "10:00-12:00" },
  ],
  [
    { day_of_week: 0, time_block: "08:00-10:00" },
    { day_of_week: 2, time_block: "12:00-14:00" },
  ]
);
assert.deepEqual(toInsert, [{ day_of_week: 2, time_block: "12:00-14:00" }]);
assert.deepEqual(toDelete, [{ day_of_week: 1, time_block: "10:00-12:00" }]);

console.log("call-schedule-slots.test.ts OK");
