import assert from "node:assert/strict";
import { matchesBookedClassMoveIntent } from "@/lib/wa-registration-intent";
import {
  buildLeadDayTrialOfferReply,
  classifyLeadDayTrialFollowup,
  explicitChoiceReply,
  explicitClassChoiceApplies,
  LEAD_DAY_TRIAL_DECLINED_MODEL,
  LEAD_DAY_TRIAL_JOIN_QUESTION,
  LEAD_DAY_TRIAL_OFFER_MODEL,
  pendingLeadDayFromRecentMessages,
  resolveExplicitClassChoice,
  resolveLeadDayTrialAsk,
  upcomingSlotsOnDay,
} from "@/lib/wa-lead-day-trial";

const now = new Date("2026-10-07T10:00:00+03:00");
const shira =
  "היי, לא, אשמח להגיע בשישי לשיעור נסיון,ולא עלה באפשרויות";

assert.equal(matchesBookedClassMoveIntent(shira), false);
assert.equal(resolveLeadDayTrialAsk({ text: shira, arboxIsMember: false, trialRegistered: false, now }), "ו");
assert.equal(resolveLeadDayTrialAsk({ text: shira, arboxIsMember: null, now }), "ו");
assert.equal(resolveLeadDayTrialAsk({ text: shira, arboxIsMember: true, now }), null);
assert.equal(resolveLeadDayTrialAsk({ text: shira, arboxIsMember: false, trialRegistered: true, now }), null);
assert.equal(
  resolveLeadDayTrialAsk({ text: "אפשר להזיז את האימון לשישי", arboxIsMember: false, now }),
  null
);
assert.equal(
  resolveLeadDayTrialAsk({ text: "כמה עולה שיעור ניסיון בשישי?", arboxIsMember: false, now }),
  null
);
assert.equal(
  resolveLeadDayTrialAsk({ text: "אשמח לשיעור ניסיון", arboxIsMember: false, now }),
  null
);

const services = [
  {
    name: "functional flow",
    scheduleSlots: [
      { day: "א", time: "18:00" },
      { day: "א", time: "07:15" },
    ],
  },
  {
    name: "Friday power",
    scheduleSlots: [{ day: "ו", time: "19:00" }],
  },
  {
    name: "Legs on fire",
    scheduleSlots: [
      { day: "ו", time: "08:00" },
      { day: "ב", time: "19:00" },
    ],
  },
];

const offer = buildLeadDayTrialOfferReply({ day: "ו", services, now });
assert.equal(
  offer,
  `יש לנו ביום שישי:\n08:00, Legs on fire\n19:00, Friday power\n\n${LEAD_DAY_TRIAL_JOIN_QUESTION}`
);

const miss = buildLeadDayTrialOfferReply({
  day: "ו",
  services,
  now,
  missingServiceName: "functional flow",
});
assert.ok(miss?.startsWith("לfunctional flow אין אימון ביום שישי."));
assert.ok(miss?.includes("08:00, Legs on fire"));

assert.equal(
  buildLeadDayTrialOfferReply({ day: "ו", services: [services[0]!], now }),
  null
);
assert.equal(upcomingSlotsOnDay(services[1]!.scheduleSlots, "ו", now).length, 1);

assert.equal(classifyLeadDayTrialFollowup("כן"), "yes");
assert.equal(classifyLeadDayTrialFollowup("לא תודה"), "no");
assert.equal(classifyLeadDayTrialFollowup(shira), null);

const pending = pendingLeadDayFromRecentMessages([
  { role: "assistant", model_used: "sales_flow_schedule_slot_menu", content: "מתי נוח" },
  { role: "assistant", model_used: LEAD_DAY_TRIAL_OFFER_MODEL, content: offer },
  { role: "assistant", model_used: "greeting", content: "ברוכים הבאים" },
]);
assert.equal(pending, "ו");
assert.equal(
  pendingLeadDayFromRecentMessages([
    { role: "assistant", model_used: "greeting", content: "ברוכים הבאים" },
    { role: "assistant", model_used: LEAD_DAY_TRIAL_OFFER_MODEL, content: offer },
  ]),
  null
);
assert.equal(
  pendingLeadDayFromRecentMessages([
    { role: "assistant", model_used: LEAD_DAY_TRIAL_DECLINED_MODEL, content: "סבבה" },
    { role: "assistant", model_used: LEAD_DAY_TRIAL_OFFER_MODEL, content: offer },
  ]),
  null
);

const sunday = [
  {
    name: "functional flow",
    scheduleSlots: [{ day: "א", time: "07:15" }],
  },
  {
    name: "mom&baby",
    scheduleSlots: [{ day: "א", time: "10:15" }],
  },
  {
    name: "power",
    scheduleSlots: [{ day: "א", time: "10:15" }],
  },
];

const tali =
  "היי, אז אני אשמח להגיע בבקשה לאימון ניסיון ביום ראשון ב-10:15";
const unique = resolveExplicitClassChoice({
  text: tali,
  services: sunday.filter((service) => service.name !== "power"),
  now,
});
assert.equal(unique.kind, "unique");
if (unique.kind === "unique") {
  assert.equal(unique.slot.serviceName, "mom&baby");
  assert.equal(unique.slot.time, "10:15");
}
const confirmed = explicitChoiceReply({ choice: unique, hasTrialSignup: true });
assert.equal(confirmed.action, "confirm");
const noSignup = explicitChoiceReply({ choice: unique, hasTrialSignup: false });
assert.equal(noSignup.action, "text");
if (noSignup.action === "text") {
  assert.match(noSignup.text, /mom&baby/);
  assert.match(noSignup.text, /10:15/);
  assert.match(noSignup.text, /עוברת לצוות/);
  assert.equal(/אימייל|מייל|שם מלא|טלפון/.test(noSignup.text), false);
}

const missing = resolveExplicitClassChoice({
  text: "אשמח לאימון ניסיון ביום ראשון ב-11:00",
  services: sunday,
  now,
});
assert.equal(missing.kind, "missing");
const missingReply = explicitChoiceReply({ choice: missing, hasTrialSignup: true });
assert.equal(missingReply.action, "text");
if (missingReply.action === "text") assert.match(missingReply.text, /אין אימון/);

const ambiguous = resolveExplicitClassChoice({
  text: "אשמח לאימון ניסיון ביום ראשון ב-10:15",
  services: sunday,
  now,
});
assert.equal(ambiguous.kind, "ambiguous");
const ambiguousReply = explicitChoiceReply({ choice: ambiguous, addressingMode: "neutral", hasTrialSignup: true });
assert.equal(ambiguousReply.action, "text");
if (ambiguousReply.action === "text") {
  assert.match(ambiguousReply.text, /mom&baby/);
  assert.match(ambiguousReply.text, /power/);
  assert.match(ambiguousReply.text, /מה מתאים\?/);
  assert.equal(ambiguousReply.text.includes("10:15 mom&baby"), false);
}

const duplicated = resolveExplicitClassChoice({
  text: "Mom&baby",
  services: [
    sunday[1]!,
    { name: "mom&baby", scheduleSlots: [{ day: "א", time: "10:15" }] },
  ],
  now,
  priorText: tali,
});
assert.equal(duplicated.kind, "unique");

const named = resolveExplicitClassChoice({
  text: "Mom&baby",
  services: sunday.filter((service) => service.name !== "power"),
  now,
  priorText: tali,
});
assert.equal(named.kind, "unique");
if (named.kind === "unique") assert.equal(named.slot.time, "10:15");

assert.equal(
  explicitClassChoiceApplies({ route: "answer", choice: unique, trialAsk: false, text: "נתראה ב-10:15" }),
  false
);
assert.equal(
  explicitClassChoiceApplies({ route: "answer", choice: unique, trialAsk: true, text: tali }),
  true
);
assert.equal(
  explicitClassChoiceApplies({ route: "booking_change", choice: unique, trialAsk: false, text: "תבטלי את השיעור ב-10:15" }),
  false
);
assert.equal(
  explicitClassChoiceApplies({ route: "schedule", choice: unique, trialAsk: false, text: "Mom&baby" }),
  true
);
assert.equal(
  explicitClassChoiceApplies({ route: "class_move", choice: unique, trialAsk: true, text: tali }),
  false
);
assert.equal(
  explicitClassChoiceApplies({ route: "personal", choice: { kind: "none" }, trialAsk: false }),
  false
);

console.log("wa-lead-day-trial.test.ts: ok");
