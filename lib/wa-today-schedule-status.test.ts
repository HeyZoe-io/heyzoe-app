import assert from "node:assert/strict";
import {
  buildTodayOpeningHoursFromScheduleTextReply,
  buildTodayScheduleFoundReply,
  extractScheduleTextForToday,
  looksLikeBusinessOpenOrClosedTodayQuestion,
  resolveTodayScheduleClasses,
  tryBuildTodayOpeningHoursFromScheduleText,
  TODAY_OPENING_HOURS_FROM_SCHEDULE_TEXT_MODEL,
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

{
  // Apex / erev Yom Kippur: Sunday 20.9 — schedule_text date must beat weekly Sunday classes.
  const erevYomKippur = new Date("2026-09-20T10:00:00.000Z"); // ראשון 20.9 ישראל
  const apexHours = [
    "ראשון: 06:00-22:00",
    "20.9 ערב כיפור - פתוחים עד 13:00",
    "21.9 יום כיפור - סגור",
  ].join("\n");

  const snippet = extractScheduleTextForToday(apexHours, erevYomKippur);
  assert.equal(snippet, "20.9 ערב כיפור - פתוחים עד 13:00");

  const reply = tryBuildTodayOpeningHoursFromScheduleText({
    text: "אתם פתוחים היום?",
    scheduleText: apexHours,
    now: erevYomKippur,
  });
  assert.ok(reply);
  assert.equal(reply!.modelUsed, TODAY_OPENING_HOURS_FROM_SCHEDULE_TEXT_MODEL);
  assert.match(reply!.text, /היום \(ראשון 20\.9\)/);
  assert.match(reply!.text, /ערב כיפור/);
  assert.match(reply!.text, /עד 13:00/);
  assert.doesNotMatch(reply!.text, /06:00-22:00/, "must not fall back to weekly Sunday hours");

  // Slash / zero-padded forms also match
  assert.equal(
    extractScheduleTextForToday("20/09 סגירה מוקדמת", erevYomKippur),
    "20/09 סגירה מוקדמת"
  );
  assert.equal(
    extractScheduleTextForToday("פתוחים ב-20.09.2026 עד הצהריים", erevYomKippur),
    "פתוחים ב-20.09.2026 עד הצהריים"
  );

  // No date in knowledge → null (Claude / Arbox weekday path)
  assert.equal(extractScheduleTextForToday("ראשון: 06:00-22:00", erevYomKippur), null);
  assert.equal(
    tryBuildTodayOpeningHoursFromScheduleText({
      text: "אתם פתוחים היום?",
      scheduleText: "ראשון: 06:00-22:00",
      now: erevYomKippur,
    }),
    null
  );

  // Not an open-today question → null even with date lines
  assert.equal(
    tryBuildTodayOpeningHoursFromScheduleText({
      text: "מתי יש פילאטיס?",
      scheduleText: apexHours,
      now: erevYomKippur,
    }),
    null
  );

  assert.equal(
    buildTodayOpeningHoursFromScheduleTextReply("20.9 ערב כיפור - פתוחים עד 13:00", erevYomKippur),
    "היום (ראשון 20.9):\n20.9 ערב כיפור - פתוחים עד 13:00"
  );

  // Do not match 120.9 as today 20.9
  assert.equal(extractScheduleTextForToday("מבצע עד 120.9 ש״ח", erevYomKippur), null);
}

console.log("wa-today-schedule-status.test.ts OK");
