import assert from "node:assert/strict";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import {
  UNKNOWN_CLASS_SLOT_HANDOFF_REPLY,
  assistantReplyIsUnknownClassSlotHandoff,
  matchCatalogServiceByDayAndTime,
  matchCatalogServiceFromFreeText,
  shouldHandoffUnknownClassSlot,
} from "@/lib/wa-unknown-class-slot";

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

const limitlessLike: SfServiceRow[] = [
  svc("POWER & HIIT", [
    { day: "ב", time: "09:00" },
    { day: "ב", time: "18:30" },
    { day: "ג", time: "11:00" },
    { day: "ה", time: "18:00" },
  ]),
  svc("Mobility power", [
    { day: "א", time: "09:00" },
    { day: "ש", time: "18:30" },
  ]),
  svc("Power  & HIIT לנשים", [{ day: "ש", time: "19:30" }]),
];

assert.equal(
  matchCatalogServiceFromFreeText("רוצה להצטרף בשבת לפוואר אנד הייט", limitlessLike),
  "POWER & HIIT"
);

const sangaLike: SfServiceRow[] = [
  svc("שיעור יוגה מתחילים", [{ day: "ה", time: "18:00" }]),
  svc("שיעור יוגה ממשיכים", [{ day: "ב", time: "18:00" }]),
  svc("שיעור יוגה מתקדמים", [{ day: "ג", time: "19:00" }]),
  svc("יוגה לכל הרמות", [{ day: "א", time: "09:00" }]),
  svc("שיעור יוגה נשים", [{ day: "ד", time: "10:00" }]),
  svc("קורס מתחילים (8 מפגשים)", [{ day: "א", time: "19:00" }]),
];
assert.equal(
  matchCatalogServiceFromFreeText("יוגה מתחילות", sangaLike),
  "שיעור יוגה מתחילים"
);
assert.equal(
  matchCatalogServiceFromFreeText("שיעורי יוגה למתחילות", sangaLike),
  "שיעור יוגה מתחילים"
);
assert.equal(
  matchCatalogServiceFromFreeText("אני מתעניינת בשיעורי יוגה למתחילות", sangaLike),
  "שיעור יוגה מתחילים"
);

const strengthLike: SfServiceRow[] = [
  svc("אימוני כוח - Strength", [
    { day: "ו", time: "09:00" },
    { day: "ו", time: "10:00" },
  ]),
  svc("Power&HIIT", [{ day: "ב", time: "09:00" }]),
  svc("כוח לנשים בלבד", [{ day: "ג", time: "19:00" }]),
  svc("Mobility Power", [{ day: "א", time: "09:00" }]),
];
assert.equal(
  matchCatalogServiceFromFreeText("לאימון strength עם אלין ב-9", strengthLike),
  "אימוני כוח - Strength",
  "free-text strength+instructor+hour → Strength"
);
assert.equal(
  matchCatalogServiceFromFreeText("strength", strengthLike),
  "אימוני כוח - Strength"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "לאימון strength עם אלין ב-9",
    services: strengthLike,
  }),
  false,
  "bare hour ב-9 + Strength Friday 09:00 exists — not unknown slot"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "רוצה להצטרף בשבת לפוואר אנד הייט",
    services: limitlessLike,
  }),
  true,
  "Saturday Power & HIIT is not in catalog slots"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "רוצה להצטרף ביום שני לפוואר אנד הייט",
    services: limitlessLike,
  }),
  false,
  "Monday Power & HIIT exists"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "יש שיעורים בשבת?",
    services: limitlessLike,
  }),
  false,
  "generic Saturday question — other classes have Saturday"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "מתי POWER & HIIT?",
    services: limitlessLike,
  }),
  false,
  "when-is without a missing day — slots exist"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "אפשר בשבת?",
    services: limitlessLike,
    committedServiceName: "POWER & HIIT",
  }),
  true,
  "committed Power & HIIT has no Saturday"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "רוצה להצטרף בשבת לפוואר אנד הייט",
    services: limitlessLike,
    sessionPhase: "schedule_date",
  }),
  false,
  "do not intercept schedule picker"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "יש פילאטיס ב-18:30?",
    services: [svc("פילאטיס מכשירים", [{ day: "ג", time: "18:30" }])],
  }),
  false
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "יש פילאטיס ב-11:30?",
    services: [svc("פילאטיס מכשירים", [{ day: "ג", time: "18:30" }])],
  }),
  true
);

assert.equal(
  matchCatalogServiceFromFreeText("כיסא", [
    svc("פילאטיס מכשירים (כסא)", [{ day: "ג", time: "18:30" }]),
    svc("פילאטיס מזרן", [{ day: "ב", time: "19:00" }]),
  ]),
  "פילאטיס מכשירים (כסא)"
);

const joeLike: SfServiceRow[] = [
  svc("אקרו יוגה - ליחיד", []),
  svc("אקרו יוגה - לזוג", []),
  svc("עמידות ידיים / גמישות", []),
  svc("שיעור אקרו אישי (1 - 1)", []),
  svc("קורס אקרויוגה אונליין", []),
  svc("סדנאות ואירועים מיוחדים", []),
];
assert.equal(
  matchCatalogServiceFromFreeText("כמה עולה שיעור ניסיון?", joeLike),
  null,
  "generic class/trial price must not pick private lesson"
);

assert.equal(assistantReplyIsUnknownClassSlotHandoff(UNKNOWN_CLASS_SLOT_HANDOFF_REPLY), true);
assert.equal(assistantReplyIsUnknownClassSlotHandoff("אין לי את הפרטים"), false);

{
  const tue = new Date("2026-09-01T07:32:00.000Z");
  const catalog = [
    svc("Power&HIIT", [
      { day: "ב", time: "08:00" },
      { day: "ד", time: "08:00" },
    ]),
    svc("אימוני כוח - Strength", [{ day: "א", time: "08:00" }]),
  ];
  assert.equal(matchCatalogServiceByDayAndTime("tomorrow at 8am", catalog, tue), "Power&HIIT");
}

console.log("wa-unknown-class-slot.test.ts: ok");
