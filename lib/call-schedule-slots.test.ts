import assert from "node:assert/strict";
import {
  CALL_SCHEDULE_TIME_BLOCKS,
  callScheduleDayButtonLabel,
  dayOfWeekFromHebrewLetter,
  diffCallScheduleSlots,
  hebrewDayLetterFromDow,
  normalizeCallScheduleSlots,
} from "./call-schedule-slots";
import { HEBREW_DAY_OPTIONS } from "./product-schedule-slots";

// day_of_week 0..6 aligns with HEBREW_DAY_OPTIONS index (Sunday=0)
for (let i = 0; i < HEBREW_DAY_OPTIONS.length; i++) {
  assert.equal(hebrewDayLetterFromDow(i), HEBREW_DAY_OPTIONS[i]!.value);
  assert.equal(dayOfWeekFromHebrewLetter(HEBREW_DAY_OPTIONS[i]!.value), i);
  assert.ok(callScheduleDayButtonLabel(i).includes(HEBREW_DAY_OPTIONS[i]!.label));
}

assert.equal(CALL_SCHEDULE_TIME_BLOCKS.length, 7);
assert.deepEqual(
  normalizeCallScheduleSlots([
    { day_of_week: 0, time_block: "08:00-10:00" },
    { day_of_week: 0, time_block: "08:00-10:00" },
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
