import assert from "node:assert/strict";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { matchCatalogServiceFromFreeText, shouldHandoffUnknownClassSlot } from "@/lib/wa-unknown-class-slot";
import {
  buildIsraelNowSchedulePromptBlock,
  previousUserTextFromHistory,
  RELATIVE_DAY_CLASS_SLOTS_MODEL,
  tryBuildRelativeDayClassSlotsReply,
} from "@/lib/wa-relative-day-class-slots";

function svc(name: string, slots: { day: string; time: string }[]): SfServiceRow {
  return {
    name,
    benefit: "",
    priceText: "80",
    durationText: "55",
    descriptionText: "",
    paymentLink: "",
    levelsEnabled: false,
    levels: [],
    trialPickMediaUrl: "",
    trialPickMediaType: "",
    offerKind: "trial",
    courseSessionsText: "",
    courseStartDate: "",
    courseEndDate: "",
    scheduleSlots: slots.map((s) => ({ day: s.day, time: s.time })),
    courseCycles: [],
    locationMode: "location",
    locationText: "",
    courseDatesEnabled: true,
  };
}

const tueMorning = new Date("2026-09-01T07:02:00.000Z"); // שלישי 10:02 ישראל

const chair = svc("פילאטיס מכשירים (כסא)", [
  { day: "א", time: "18:00" },
  { day: "א", time: "19:00" },
  { day: "ב", time: "18:00" },
  { day: "ג", time: "18:30" },
  { day: "ג", time: "19:30" },
  { day: "ה", time: "18:00" },
]);

const strength = svc("אימוני כוח - Strength", [
  { day: "ג", time: "19:30" },
  { day: "ד", time: "18:30" },
]);

const catalog = [chair, strength];

assert.equal(matchCatalogServiceFromFreeText("כיסא", catalog), "פילאטיס מכשירים (כסא)");

{
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: "כיסא",
    previousUserText: "אפשר לבוא לעוד אימון הערב?",
    services: catalog,
    now: tueMorning,
  });
  assert.ok(reply);
  assert.equal(reply!.modelUsed, RELATIVE_DAY_CLASS_SLOTS_MODEL);
  assert.match(reply!.text, /הערב/);
  assert.match(reply!.text, /18:30/);
  assert.match(reply!.text, /19:30/);
  assert.doesNotMatch(reply!.text, /18:00/);
  assert.doesNotMatch(reply!.text, /19:00/);
}

{
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: "יש כיסא מחר?",
    services: catalog,
    now: tueMorning,
  });
  assert.ok(reply);
  assert.match(reply!.text, /מחר/);
  assert.match(reply!.text, /אין/);
}

{
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: "ומחר?",
    previousUserText: "כיסא",
    services: catalog,
    now: tueMorning,
  });
  assert.ok(reply);
  assert.match(reply!.text, /מחר/);
  assert.match(reply!.text, /אין/);
}

assert.equal(
  tryBuildRelativeDayClassSlotsReply({
    text: "כיסא",
    services: catalog,
    now: tueMorning,
  }),
  null,
  "service name alone without a day is not a today/tomorrow listing"
);

assert.equal(
  tryBuildRelativeDayClassSlotsReply({
    text: "כיסא",
    previousUserText: "אפשר לבוא לעוד אימון הערב?",
    services: catalog,
    sessionPhase: "schedule_date",
    now: tueMorning,
  }),
  null,
  "do not intercept the schedule picker"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "יש כיסא הערב ב-19:00?",
    services: catalog,
    now: tueMorning,
  }),
  true,
  "tonight 19:00 is not on Tuesday chair — handoff"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "יש כיסא הערב ב-18:30?",
    services: catalog,
    now: tueMorning,
  }),
  false,
  "tonight 18:30 exists on Tuesday"
);

assert.equal(
  previousUserTextFromHistory({
    currentText: "כיסא",
    userMessagesOldestFirst: ["אפשר לבוא לעוד אימון הערב?", "כיסא"],
  }),
  "אפשר לבוא לעוד אימון הערב?"
);

{
  const block = buildIsraelNowSchedulePromptBlock(catalog, tueMorning);
  assert.match(block, /שלישי/);
  assert.match(block, /18:30/);
  assert.match(block, /רביעי/);
}

{
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: "יש כיסא הערב?",
    services: catalog,
    now: tueMorning,
  });
  assert.ok(reply);
  assert.match(reply!.text, /הערב יש/);
  assert.match(reply!.text, /18:30/);
  assert.match(reply!.text, /19:30/);
}

const joeWeekly = [
  svc("אקרו יוגה - ליחיד", [
    { day: "ב", time: "19:00" },
    { day: "ג", time: "19:00" },
  ]),
  svc("עמידות ידיים / גמישות", [
    { day: "א", time: "18:00" },
    { day: "ב", time: "18:00" },
  ]),
  svc("שיעור אקרו אישי (1 - 1)", []),
];

{
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: "אני יכול רק ביום ראשון. מתי יש אימון?",
    previousUserText: "כמה עולה שיעור ניסיון?",
    services: joeWeekly,
    now: tueMorning,
  });
  assert.ok(reply, "generic Sunday ask should list catalog classes");
  assert.equal(reply!.modelUsed, RELATIVE_DAY_CLASS_SLOTS_MODEL);
  assert.match(reply!.text, /ראשון/);
  assert.match(reply!.text, /עמידות ידיים/);
  assert.match(reply!.text, /18:00/);
  assert.doesNotMatch(reply!.text, /19:00/);
  assert.doesNotMatch(reply!.text, /אקרו יוגה/);
}

{
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: "אני יכול רק ביום ראשון. מתי יש אימון?",
    services: [svc("שיעור אקרו אישי (1 - 1)", [])],
    now: tueMorning,
  });
  assert.equal(reply, null, "no Sunday in catalog → leave to unknown-slot handoff");
}

{
  const talCouldntSee = `היי כן, 
אשמח לקבוע אימון שני ניסיון לשבוע הבא ביום שני 
לא הצלחתי לראות איזה אימונים יש לכן שאלתי אם יש במקרה אימון כוח ביום שני ב19:30?`;
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: talCouldntSee,
    services: catalog,
    now: tueMorning,
  });
  assert.ok(reply, "couldn't-see-classes + Monday → catalog Monday slots, not membership lookup");
  assert.equal(reply!.modelUsed, RELATIVE_DAY_CLASS_SLOTS_MODEL);
  assert.match(reply!.text, /שני/);
  assert.match(reply!.text, /18:00/);
}

{
  const shirCancel = `היוש, וולקאם באק 🙂 תבטלי את השיעור עם שיר בבקשה. היא חולה.
היה לי רק שיעןר עם ליאת היום`;
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: shirCancel,
    previousUserText: "כיסא",
    services: catalog,
    now: new Date("2026-09-03T07:00:00.000Z"), // חמישי
  });
  assert.equal(reply, null, "cancel-class must not dump today's pilates slot");
}

{
  const reply = tryBuildRelativeDayClassSlotsReply({
    text: "היה לי רק שיעור עם ליאת היום",
    previousUserText: "כיסא",
    services: catalog,
    now: new Date("2026-09-03T07:00:00.000Z"),
  });
  assert.equal(reply, null, "past class with a coach is not a schedule ask");
}

console.log("wa-relative-day-class-slots.test.ts: ok");
