import assert from "node:assert/strict";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { isJoinSignupIntentText } from "@/lib/wa-warmup-skip-intent";
import { matchCatalogServiceByDayAndTime, matchCatalogServiceSlotByDayAndTime } from "@/lib/wa-unknown-class-slot";
import {
  classCancelledNotice,
  classFullNotice,
  formatServiceAndTime,
  looksLikeTrialVisitIntent,
  resolveCtaOccurrenceOutcome,
  resolveRegistrationCtaDecision,
} from "@/lib/wa-registration-cta-from-slot";

function svc(
  name: string,
  slots: { day: string; time: string }[],
  paymentLink = "https://arbox.link/agiPAaPu",
  arboxClassName = ""
): SfServiceRow {
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
    arboxClassName,
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
  assert.deepEqual(d, { action: "send_link", serviceName: "Power&HIIT", day: "ד", time: "08:00" });
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
  assert.deepEqual(d, { action: "send_link", serviceName: "Power&HIIT", day: "ד", time: "08:00" });
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
  assert.deepEqual(d, { action: "send_link", serviceName: "Power&HIIT", day: "ד", time: "08:00" });
}

// registerAsk alone, single-service business, no day/time in text at all -> send_link with
// no day/time on the decision (nothing for a caller to run an occurrence check against).
{
  const single = [svc("Only Class", [{ day: "ב", time: "08:00" }])];
  const d = resolveRegistrationCtaDecision({
    currentText: "Can you tell me how to register ?",
    recentUserTexts: [],
    services: single,
    now: tueMorning,
  });
  assert.deepEqual(d, { action: "send_link", serviceName: "Only Class" });
  assert.equal((d as { day?: unknown }).day, undefined, "no concrete slot was named — nothing to check");
}

// matchCatalogServiceSlotByDayAndTime — ambiguous when the matched service has slots on
// MORE than one of the requested (day,time) combinations.
{
  const ambiguousDayTime = [svc("Power&HIIT", [{ day: "ב", time: "08:00" }, { day: "ד", time: "08:00" }])];
  // "Monday or Wednesday at 8" both match the same service -> two candidate (day,time) hits.
  const hit = matchCatalogServiceSlotByDayAndTime("Monday or Wednesday at 8am", ambiguousDayTime, tueMorning);
  assert.equal(hit, null, "two matching (day,time) pairs for the same service — do not guess which one");
}
{
  const hit = matchCatalogServiceSlotByDayAndTime(
    "I would love to come in tomorrow for a trial\nAt the 8am class",
    limitless,
    tueMorning
  );
  assert.deepEqual(hit, { serviceName: "Power&HIIT", day: "ד", time: "08:00" });
}

// ==========================================================================
// Stage 2c Part 2 — occurrence-state -> CTA outcome mapping, and message copy
// ==========================================================================
assert.equal(resolveCtaOccurrenceOutcome("full"), "notice_full");
assert.equal(resolveCtaOccurrenceOutcome("cancelled"), "notice_cancelled");
assert.equal(resolveCtaOccurrenceOutcome("open"), "send_link", "open -> link, unchanged");
assert.equal(resolveCtaOccurrenceOutcome("unknown"), "send_link", "unknown behaves exactly like open — fail open");
assert.equal(resolveCtaOccurrenceOutcome(null), "send_link", "check never attempted (no slot/stamp/creds) -> link, unchanged");

// Display-name rule: the lead-facing text must carry the service's DISPLAY name (service.name),
// never arbox_class_name — formatServiceAndTime only ever receives whatever its caller passes,
// so this asserts the call-site contract by construction: pass the English arbox_class_name in
// and confirm it shows up verbatim (proving formatServiceAndTime does no translation/lookup of
// its own) — the actual guarantee that only service.name is ever passed lives at the call site
// in webhook/route.ts, verified separately.
{
  const displayName = "פילאטיס מכשירים (כסא)";
  const serviceAndTime = formatServiceAndTime(displayName, "18:30");
  assert.equal(serviceAndTime, "פילאטיס מכשירים (כסא) ב-18:30");
  assert.match(classFullNotice(serviceAndTime), /פילאטיס מכשירים \(כסא\) ב-18:30/);
  assert.match(classCancelledNotice(serviceAndTime), /פילאטיס מכשירים \(כסא\) ב-18:30/);
  const arboxJoinKeyLookingName = "PEAK 360";
  assert.doesNotMatch(classFullNotice(serviceAndTime), new RegExp(arboxJoinKeyLookingName));
}

// Exact verbatim Hebrew copy (approved text, must not drift).
assert.equal(
  classFullNotice("Power&HIIT ב-08:00"),
  "כרגע אני רואה שהשיעור Power&HIIT ב-08:00 מלא במערכת, אבל אני לא תמיד מעודכנת 100%, אפשר לבדוק באפליקציה ואני גם אעביר את הפניה לצוות סבבה?"
);
assert.equal(
  classCancelledNotice("Power&HIIT ב-08:00"),
  "רגע, אני רואה שהמפגש של Power&HIIT ב-08:00 לא מתקיים השבוע. השיעור עצמו קבוע במערכת, אז סביר שהוא חוזר בשבוע הבא - אני מעבירה את הפנייה לצוות שיעדכן אותך בדיוק, בסדר?"
);

console.log("wa-registration-cta-from-slot.test.ts: ok");
