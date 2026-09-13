import assert from "node:assert/strict";
import {
  buildTodayScheduleFoundReply,
  looksLikeBusinessOpenOrClosedTodayQuestion,
  resolveTodayScheduleClasses,
  TODAY_SCHEDULE_NOT_FOUND_REPLY,
} from "@/lib/wa-today-schedule-status";
import type { SfServiceRow } from "@/lib/sf-service-rows";

assert.equal(
  looksLikeBusinessOpenOrClosedTodayQuestion("אדוני, האם חדר הכושר פתוח או סגור היום"),
  true
);
assert.equal(looksLikeBusinessOpenOrClosedTodayQuestion("אתם פתוחים היום?"), true);
assert.equal(looksLikeBusinessOpenOrClosedTodayQuestion("אתם פתוחים או סגורים?"), true);
assert.equal(looksLikeBusinessOpenOrClosedTodayQuestion("is the gym open today?"), true);
// לא זה: אין זמן/הקשר עסקי — לא לתפוס בטעות שאלות אחרות עם "פתוח"
assert.equal(looksLikeBusinessOpenOrClosedTodayQuestion("המנוי שלי פתוח?"), false);
assert.equal(looksLikeBusinessOpenOrClosedTodayQuestion("אתם פתוחים מחר?"), false);
assert.equal(looksLikeBusinessOpenOrClosedTodayQuestion(""), false);
assert.equal(looksLikeBusinessOpenOrClosedTodayQuestion("מתי יש שיעור פילאטיס?"), false);

function service(name: string, slots: { day: string; time: string }[]): SfServiceRow {
  return { name, scheduleSlots: slots } as SfServiceRow;
}

// יום ראשון = "א"
const sunday = new Date("2026-09-13T09:00:00Z"); // ראשון בישראל
const services: SfServiceRow[] = [
  service("פילאטיס מכשירים", [
    { day: "א", time: "18:30" },
    { day: "ב", time: "09:00" },
  ]),
  service("יוגה", [{ day: "א", time: "07:00" }]),
  service("כוח", [{ day: "ג", time: "20:00" }]),
];

const todayClasses = resolveTodayScheduleClasses(services, sunday);
assert.deepEqual(todayClasses, [
  { time: "07:00", className: "יוגה" },
  { time: "18:30", className: "פילאטיס מכשירים" },
]);

assert.equal(resolveTodayScheduleClasses([], sunday).length, 0);
assert.equal(
  resolveTodayScheduleClasses([service("כוח", [{ day: "ג", time: "20:00" }])], sunday).length,
  0
);

const foundReply = buildTodayScheduleFoundReply(todayClasses);
assert.equal(
  foundReply,
  "אני רואה שיש שיעורים במערכת!\nשעה | שם השיעור\n07:00 | יוגה\n18:30 | פילאטיס מכשירים"
);

assert.match(TODAY_SCHEDULE_NOT_FOUND_REPLY, /לא רואה שיעורים במערכת/);
assert.match(TODAY_SCHEDULE_NOT_FOUND_REPLY, /מעבירה לצוות/);

console.log("wa-today-schedule-status.test.ts OK");
