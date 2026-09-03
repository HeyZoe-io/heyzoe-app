import assert from "node:assert/strict";
import { classifyInboundSpeechAct } from "@/lib/wa-inbound-speech-act";

const thu = new Date("2026-09-03T07:00:00.000Z");

const shir = `היוש, וולקאם באק 🙂 תבטלי את השיעור עם שיר בבקשה. היא חולה.
היה לי רק שיעןר עם ליאת היום`;

assert.equal(classifyInboundSpeechAct(shir, thu), "booking_mutation");
assert.equal(classifyInboundSpeechAct("תבטלי את השיעור עם שיר בבקשה. היא חולה.", thu), "booking_mutation");
assert.equal(classifyInboundSpeechAct("לבטל את השיעור של היום", thu), "booking_mutation");

assert.equal(classifyInboundSpeechAct("חולה", thu), "illness_only");
assert.equal(classifyInboundSpeechAct("היא חולה", thu), "illness_only");
assert.equal(classifyInboundSpeechAct("לא מרגיש טוב", thu), "illness_only");

assert.equal(classifyInboundSpeechAct("מתי יש אימון היום?", thu), "schedule_ask");
assert.equal(classifyInboundSpeechAct("יש כיסא מחר?", thu), "schedule_ask");
assert.equal(classifyInboundSpeechAct("אפשר לבוא לעוד אימון הערב?", thu), "schedule_ask");

assert.equal(classifyInboundSpeechAct("היה לי רק שיעור עם ליאת היום", thu), "other");
assert.equal(classifyInboundSpeechAct("כיסא", thu), "other");
assert.equal(classifyInboundSpeechAct("אשמח לפרטים", thu), "other");

console.log("wa-inbound-speech-act.test.ts: ok");
