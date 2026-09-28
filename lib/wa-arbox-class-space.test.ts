import assert from "node:assert/strict";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { looksLikeClassSpaceQuestion, shouldHandoffUnknownClassSlot } from "@/lib/wa-unknown-class-slot";
import { tryBuildArboxClassSpaceReply } from "@/lib/wa-arbox-class-space";

const NOW = new Date("2026-09-28T08:49:01.000Z");

function svc(
  name: string,
  slots: { day: string; time: string }[],
  arboxClassName = ""
): SfServiceRow {
  return {
    name,
    benefit: "",
    priceText: "",
    durationText: "",
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
    arboxClassName,
  };
}

assert.equal(looksLikeClassSpaceQuestion("יש מקום לאימון היום ב18:00?"), true);
assert.equal(looksLikeClassSpaceQuestion("יש מקום בחניה?"), false);
assert.equal(looksLikeClassSpaceQuestion("היי! מה נשמע?"), false);

const services = [
  svc("Power&HIIT", [{ day: "ב", time: "18:00" }], "Power&HIIT"),
  svc("פילאטיס מזרן", [{ day: "א", time: "10:00" }], "Pilates Mat"),
];

assert.equal(
  shouldHandoffUnknownClassSlot({
    text: "יש מקום לאימון היום ב18:00?",
    services,
    committedServiceName: "פילאטיס מזרן",
    now: NOW,
  }),
  false
);

const openRaw = {
  scheduleRows: [
    {
      date: "2026-09-28",
      start_time: "18:00",
      session_name: "Power&HIIT",
      max_participants: 12,
    },
  ],
  summaryRows: [
    {
      date: "2026-09-28",
      start_time: "18:00",
      class_name: "Power&HIIT",
      status: "active",
      registration_count: 4,
    },
  ],
};

async function main() {
  const openReply = await tryBuildArboxClassSpaceReply({
    text: "יש מקום לאימון היום ב18:00?",
    services,
    now: NOW,
    businessId: 3251,
    arboxApiKey: "k",
    arboxBoxId: "1",
    rawDataFetcherImpl: async () => openRaw,
  });
  assert.match(openReply ?? "", /Power&HIIT/);
  assert.match(openReply ?? "", /יש מקום/);
  assert.match(openReply ?? "", /אפשר לוודא על ידי בדיקה באפליקציה/);
  assert.doesNotMatch(openReply ?? "", /מעבירה את הבקשה לצוות/);

  const fullRaw = {
    scheduleRows: openRaw.scheduleRows,
    summaryRows: [{ ...openRaw.summaryRows[0], registration_count: 12 }],
  };
  const fullReply = await tryBuildArboxClassSpaceReply({
    text: "יש מקום לאימון היום ב18:00?",
    services,
    now: NOW,
    businessId: 3251,
    arboxApiKey: "k",
    arboxBoxId: "1",
    rawDataFetcherImpl: async () => fullRaw,
  });
  assert.match(fullReply ?? "", /מלא/);
  assert.doesNotMatch(fullReply ?? "", /יש מקום/);
  assert.match(fullReply ?? "", /אפליקציה/);

  const noneReply = await tryBuildArboxClassSpaceReply({
    text: "יש מקום לאימון היום ב07:15?",
    services,
    now: NOW,
    businessId: 3251,
    arboxApiKey: "k",
    arboxBoxId: "1",
    rawDataFetcherImpl: async () => openRaw,
  });
  assert.match(noneReply ?? "", /לא רואה שיעור/);
  assert.match(noneReply ?? "", /07:15/);

  console.log("wa-arbox-class-space.test.ts: ok");
}

main();
