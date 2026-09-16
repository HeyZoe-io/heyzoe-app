import assert from "node:assert/strict";
import { metaReplyIdFromLabel } from "@/lib/whatsapp";
import {
  dayButtonLabelsForSlots,
  resolveCallScheduleDayChoice,
  resolveCallScheduleTimeChoice,
} from "@/lib/wa-call-schedule-flow";
import { callScheduleDayButtonLabel } from "@/lib/call-schedule-slots";

const days = [0, 1, 2, 3, 4, 5];
const wednesdayLabel = callScheduleDayButtonLabel(3);
assert.equal(wednesdayLabel, "יום רביעי");

// Production bug: 6 day options → Meta list; inbound prefers encoded id over title.
const metaId = metaReplyIdFromLabel(wednesdayLabel);
assert.match(metaId, /^z:/);
assert.equal(resolveCallScheduleDayChoice(wednesdayLabel, metaId, days), 3);
assert.equal(resolveCallScheduleDayChoice(wednesdayLabel, undefined, days), 3);
assert.equal(resolveCallScheduleDayChoice("רביעי", undefined, days), 3);
assert.equal(resolveCallScheduleDayChoice("4", undefined, days), 3);
assert.equal(resolveCallScheduleDayChoice("לא קיים", "z:not-a-day", days), null);

const blocks = ["12:00-14:00", "14:00-16:00"];
const timeId = metaReplyIdFromLabel(blocks[0]!);
assert.equal(resolveCallScheduleTimeChoice(blocks[0]!, timeId, blocks), "12:00-14:00");
assert.equal(resolveCallScheduleTimeChoice(blocks[1]!, undefined, blocks), "14:00-16:00");
assert.equal(resolveCallScheduleTimeChoice("2", undefined, blocks), "14:00-16:00");
assert.equal(resolveCallScheduleTimeChoice("99", timeId.replace("z:", "h:"), blocks), null);

assert.deepEqual(dayButtonLabelsForSlots(days.map((day_of_week) => ({ day_of_week, time_block: "12:00-14:00" }))), [
  "יום ראשון",
  "יום שני",
  "יום שלישי",
  "יום רביעי",
  "יום חמישי",
  "יום שישי",
]);

console.log("wa-call-schedule-flow.test.ts: ok");
