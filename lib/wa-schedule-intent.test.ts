import assert from "node:assert/strict";
import { isExplicitTimetableRequest, isScheduleIntent, shouldSendScheduleBoardOnAsk } from "@/lib/wa-schedule-intent";

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

assert.equal(isExplicitTimetableRequest("שלחי לי את מערכת השעות"), true);
assert.equal(isExplicitTimetableRequest("מתי יש שיעור"), false);
assert.equal(isExplicitTimetableRequest("מתי ניתן להגיע לשיעור ניסיון?"), false);

assert.equal(
  shouldSendScheduleBoardOnAsk({
    text: "מערכת שעות",
    canSendImage: true,
    hasLink: false,
  }),
  true
);
assert.equal(
  shouldSendScheduleBoardOnAsk({
    text: "מערכת שעות",
    canSendImage: false,
    hasLink: true,
  }),
  true
);
assert.equal(
  shouldSendScheduleBoardOnAsk({
    text: "כמה עולה",
    canSendImage: true,
    hasLink: true,
  }),
  false
);
assert.equal(
  shouldSendScheduleBoardOnAsk({
    text: "מערכת שעות",
    canSendImage: false,
    hasLink: false,
  }),
  false
);

console.log("wa-schedule-intent.test.ts: ok");
