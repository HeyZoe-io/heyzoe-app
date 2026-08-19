import assert from "node:assert/strict";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import {
  UNKNOWN_CLASS_SLOT_HANDOFF_REPLY,
  assistantReplyIsUnknownClassSlotHandoff,
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
  shouldHandoffUnknownClassSlot({
    text: "יש שיעור בשלישי?",
    services: limitlessLike,
  }),
  false,
  "generic Tuesday question — Power & HIIT has Tuesday"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "יש שיעור בשלישי?",
    services: [svc("אקרו יוגה", []), svc("עמידות ידיים", [])],
    hasScheduleBoardFallback: true,
  }),
  false,
  "no product slots but schedule board fallback — do not hand off"
);

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "יש שיעור בשלישי?",
    services: [svc("אקרו יוגה", []), svc("עמידות ידיים", [])],
  }),
  true,
  "no product slots and no schedule board — hand off"
);

assert.equal(assistantReplyIsUnknownClassSlotHandoff(UNKNOWN_CLASS_SLOT_HANDOFF_REPLY), true);
assert.equal(assistantReplyIsUnknownClassSlotHandoff("אין לי את הפרטים"), false);

console.log("wa-unknown-class-slot.test.ts: ok");
