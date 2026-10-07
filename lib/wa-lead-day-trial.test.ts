import assert from "node:assert/strict";
import { matchesBookedClassMoveIntent } from "@/lib/wa-registration-intent";
import {
  buildLeadDayTrialOfferReply,
  classifyLeadDayTrialFollowup,
  LEAD_DAY_TRIAL_DECLINED_MODEL,
  LEAD_DAY_TRIAL_JOIN_QUESTION,
  LEAD_DAY_TRIAL_OFFER_MODEL,
  pendingLeadDayFromRecentMessages,
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

console.log("wa-lead-day-trial.test.ts: ok");
