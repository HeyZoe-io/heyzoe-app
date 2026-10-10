import assert from "node:assert/strict";
import {
  dayLetterFromHebrewDayName,
  HEBREW_DAY_OPTIONS,
  isConfiguredProductScheduleSlot,
  normalizeProductScheduleSlotsFromMeta,
} from "@/lib/product-schedule-slots";

const newId = () => "id";
const dayOf = (raw: string) => normalizeProductScheduleSlotsFromMeta([{ day: raw, time: "18:00" }], newId)[0]?.day ?? "";

for (const { value } of HEBREW_DAY_OPTIONS) {
  assert.equal(dayOf(value), value, `single letter ${value} unchanged`);
  assert.equal(dayOf(`${value}׳`), value, `letter with geresh ${value}׳ unchanged`);
  assert.equal(isConfiguredProductScheduleSlot({ day: value, time: "18:00" }), true);
}

assert.equal(dayOf("שני"), "ב");
assert.equal(dayOf("שלישי"), "ג");
assert.equal(dayOf("שישי"), "ו");
assert.equal(dayOf("שבת"), "ש");
assert.equal(dayOf("יום שני"), "ב");
assert.equal(dayOf("רביעי"), "ד");
assert.equal(dayOf("x"), "");

assert.equal(dayLetterFromHebrewDayName("ראשון"), "א");
assert.equal(dayLetterFromHebrewDayName("שני"), "ב");
assert.equal(dayLetterFromHebrewDayName("שלישי"), "ג");
assert.equal(dayLetterFromHebrewDayName("רביעי"), "ד");
assert.equal(dayLetterFromHebrewDayName("חמישי"), "ה");
assert.equal(dayLetterFromHebrewDayName("שישי"), "ו");
assert.equal(dayLetterFromHebrewDayName("שבת"), "ש");
assert.equal(dayLetterFromHebrewDayName("יום שני"), "ב");
assert.equal(dayLetterFromHebrewDayName("  יום שלישי  "), "ג");
assert.equal(dayLetterFromHebrewDayName("שני׳"), "ב");
assert.equal(dayLetterFromHebrewDayName("שני'"), "ב");

for (const garbage of ["", "ב", "ש", "שנ", "שניים", "Monday", "14/10/2026", "יום", "יום ב׳", "שבתון"]) {
  assert.equal(dayLetterFromHebrewDayName(garbage), null, `garbage: ${garbage}`);
}

console.log("product-schedule-slots tests passed");
