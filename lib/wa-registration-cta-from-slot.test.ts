import assert from "node:assert/strict";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { isJoinSignupIntentText } from "@/lib/wa-warmup-skip-intent";
import { matchCatalogServiceByDayAndTime } from "@/lib/wa-unknown-class-slot";
import {
  looksLikeTrialVisitIntent,
  resolveRegistrationCtaDecision,
} from "@/lib/wa-registration-cta-from-slot";

function svc(name: string, slots: { day: string; time: string }[], paymentLink = "https://arbox.link/agiPAaPu"): SfServiceRow {
  return {
    name,
    benefit: "",
    priceText: "80",
    durationText: "55",
    descriptionText: "",
    paymentLink,
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

const limitless: SfServiceRow[] = [
  svc("Power&HIIT", [
    { day: "ב", time: "08:00" },
    { day: "ד", time: "08:00" },
    { day: "ב", time: "18:30" },
  ]),
  svc("אימוני כוח - Strength", [
    { day: "א", time: "08:00" },
    { day: "ד", time: "09:00" },
  ]),
  svc("Mobility Power", [{ day: "ג", time: "10:00" }]),
];

const tueMorning = new Date("2026-09-01T07:32:00.000Z"); // שלישי 10:32 ישראל → מחר = רביעי

assert.equal(
  matchCatalogServiceByDayAndTime(
    "I would love to come in tomorrow for a trial\nAt the 8am class",
    limitless,
    tueMorning
  ),
  "Power&HIIT",
  "tomorrow + 8am on Tuesday → Wednesday 08:00 Power&HIIT"
);

assert.equal(
  isJoinSignupIntentText("Can you tell me how to register ?"),
  true,
  "English how-to-register"
);

assert.equal(
  looksLikeTrialVisitIntent("A friend of mine told me about your studio and I would love to come in tomorrow for a trial"),
  true
);

{
  const d = resolveRegistrationCtaDecision({
    currentText: "Can you tell me how to register ?",
    recentUserTexts: [
      "Hello ☺️ How are you ?",
      "A friend of mine told me about your studio and I would love to come in tomorrow for a trial",
      "At the 8am class",
    ],
    services: limitless,
    now: tueMorning,
  });
  assert.deepEqual(d, { action: "send_link", serviceName: "Power&HIIT" });
}

{
  const d = resolveRegistrationCtaDecision({
    currentText: "At the 8am class",
    recentUserTexts: [
      "A friend of mine told me about your studio and I would love to come in tomorrow for a trial",
    ],
    services: limitless,
    now: tueMorning,
  });
  assert.deepEqual(d, { action: "send_link", serviceName: "Power&HIIT" });
}

{
  const d = resolveRegistrationCtaDecision({
    currentText: "Can you tell me how to register ?",
    recentUserTexts: ["Hello"],
    services: limitless,
    now: tueMorning,
  });
  assert.deepEqual(d, { action: "ask_class" }, "register without a unique class → ask which class");
}

{
  const d = resolveRegistrationCtaDecision({
    currentText: "כמה עולה שיעור ניסיון?",
    recentUserTexts: [],
    services: limitless,
    now: tueMorning,
  });
  assert.deepEqual(d, { action: "none" }, "trial price question is not a registration CTA");
}

{
  const d = resolveRegistrationCtaDecision({
    currentText: "A friend of mine told me about your studio and I would love to come in tomorrow for a trial",
    recentUserTexts: [],
    services: limitless,
    now: tueMorning,
  });
  assert.deepEqual(d, { action: "none" }, "trial intent without a time does not dump a link");
}

{
  const d = resolveRegistrationCtaDecision({
    currentText: "Can you tell me how to register ?",
    recentUserTexts: ["tomorrow 8am"],
    services: limitless,
    sessionPhase: "registered",
    now: tueMorning,
  });
  assert.deepEqual(d, { action: "none" });
}

{
  const d = resolveRegistrationCtaDecision({
    currentText: "איך נרשמים",
    recentUserTexts: ["רוצה את השיעור של מחר ב-8:00"],
    services: limitless,
    now: tueMorning,
  });
  assert.deepEqual(d, { action: "send_link", serviceName: "Power&HIIT" });
}

console.log("wa-registration-cta-from-slot.test.ts: ok");
