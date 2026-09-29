import assert from "node:assert/strict";
import { isScheduleIntent, shouldSendScheduleBoardDuringWarmup } from "@/lib/wa-schedule-intent";

assert.equal(isScheduleIntent("צפייה במערכת השעות"), true);
assert.equal(isScheduleIntent("צפייה במערכת שעות"), true);
assert.equal(isScheduleIntent("מתי ניתן להגיע לשיעור ניסיון?"), true);
assert.equal(isScheduleIntent("מתי אפשר להגיע לשיעור?"), true);
assert.equal(isScheduleIntent("מתי אפשר לבוא לאימון ניסיון"), true);
assert.equal(isScheduleIntent("מתי יש שיעור"), true);

assert.equal(isScheduleIntent("עם מי לתאם הגעה לשיעור ניסיון?"), false);
assert.equal(isScheduleIntent("אשמח לדעת עלויות"), false);
assert.equal(isScheduleIntent("לא. תודה."), false);
assert.equal(isScheduleIntent("שיעור ניסיון"), false);

assert.equal(
  shouldSendScheduleBoardDuringWarmup({
    phase: "warmup",
    text: "מערכת שעות",
    canSendImage: true,
    scheduleCtaOn: true,
    hasLink: true,
  }),
  true
);
assert.equal(
  shouldSendScheduleBoardDuringWarmup({
    phase: "cta",
    text: "מערכת שעות",
    canSendImage: true,
    scheduleCtaOn: true,
    hasLink: true,
  }),
  false
);
assert.equal(
  shouldSendScheduleBoardDuringWarmup({
    phase: "warmup",
    text: "כמה עולה",
    canSendImage: true,
    scheduleCtaOn: true,
    hasLink: true,
  }),
  false
);
assert.equal(
  shouldSendScheduleBoardDuringWarmup({
    phase: "warmup",
    text: "מערכת שעות",
    canSendImage: false,
    scheduleCtaOn: false,
    hasLink: false,
  }),
  false
);

console.log("wa-schedule-intent.test.ts: ok");
