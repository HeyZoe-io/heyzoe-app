import assert from "node:assert/strict";
import { classifyInboundSpeechAct, shouldAnswerFromClassTimetable } from "@/lib/wa-inbound-speech-act";

const thu = new Date("2026-09-03T07:00:00.000Z");

const shir = `היוש, וולקאם באק 🙂 תבטלי את השיעור עם שיר בבקשה. היא חולה.
היה לי רק שיעןר עם ליאת היום`;

assert.equal(classifyInboundSpeechAct(shir, thu), "booking_mutation");
assert.equal(classifyInboundSpeechAct("תבטלי את השיעור עם שיר בבקשה. היא חולה.", thu), "booking_mutation");
assert.equal(classifyInboundSpeechAct("לבטל את השיעור של היום", thu), "booking_mutation");
assert.equal(classifyInboundSpeechAct("היי! אני צריכה לבטל היום לצערי: (", thu), "booking_mutation");

assert.equal(classifyInboundSpeechAct("חולה", thu), "illness_only");
assert.equal(classifyInboundSpeechAct("היא חולה", thu), "illness_only");
assert.equal(classifyInboundSpeechAct("לא מרגיש טוב", thu), "illness_only");
assert.equal(
  classifyInboundSpeechAct(
    "היי, אני רשומה לשיעור ניסיון היום ואני לא מרגישה טוב, אפשר לתאם ליום אחר השבוע?",
    thu
  ),
  "other"
);
assert.equal(
  shouldAnswerFromClassTimetable(
    "היי, אני רשומה לשיעור ניסיון היום ואני לא מרגישה טוב, אפשר לתאם ליום אחר השבוע?",
    thu
  ),
  false
);
const lateCancelThenTomorrow =
  "היי הייתי אמורה להגיע היום ב7:15 ולצערי לא הסתדר כי היה לילה מאתגר וביטלתי מאוחר, ואשמח להגיע מחר בשעה 7:30 אני רואה שיש הרבה מקום בשעה הזאת.";
assert.equal(shouldAnswerFromClassTimetable(lateCancelThenTomorrow, thu), false);
assert.equal(classifyInboundSpeechAct(lateCancelThenTomorrow, thu), "other");

assert.equal(classifyInboundSpeechAct("מתי יש אימון היום?", thu), "schedule_ask");
assert.equal(
  classifyInboundSpeechAct("הייי יגאל מה קורה יהיה אימון ביום שישי ערב חג ?", thu),
  "schedule_ask"
);
assert.equal(classifyInboundSpeechAct("יש כיסא מחר?", thu), "schedule_ask");
assert.equal(classifyInboundSpeechAct("אפשר לבוא לעוד אימון הערב?", thu), "schedule_ask");

assert.equal(classifyInboundSpeechAct("היה לי רק שיעור עם ליאת היום", thu), "other");
assert.equal(classifyInboundSpeechAct("כיסא", thu), "other");
assert.equal(classifyInboundSpeechAct("אשמח לפרטים", thu), "other");

assert.equal(shouldAnswerFromClassTimetable(shir, thu), false);
assert.equal(shouldAnswerFromClassTimetable("היה לי רק שיעור עם ליאת היום", thu), false);
assert.equal(shouldAnswerFromClassTimetable("חולה", thu), false);
const membershipExpiry =
  "היוש מה נשמע? נראה שנגמר לי המנוי להיידי יש מצב? והוא מתחדש לי במהלך השבוע ואני רוצה לעשות אימון בראשון ברביעי מתי הוא נגמר?";
assert.equal(classifyInboundSpeechAct(membershipExpiry, thu), "other");
assert.equal(shouldAnswerFromClassTimetable(membershipExpiry, thu), false);
assert.equal(shouldAnswerFromClassTimetable("מתי נגמר המנוי שלי?", thu), false);
assert.equal(shouldAnswerFromClassTimetable("מתי יש אימון היום?", thu), true);
assert.equal(shouldAnswerFromClassTimetable("כיסא", thu), true);
assert.equal(shouldAnswerFromClassTimetable("ומחר?", thu), true);

const tightsMoveOffApp =
  "היי תמחקו אותי בבקשה מהשיעור של יום ראשון הקרוב ותעבירו אותי ליום שני ב08.30 אי אפשר דרך האפליקציה תודנ";
assert.equal(classifyInboundSpeechAct(tightsMoveOffApp, thu), "other");
assert.equal(shouldAnswerFromClassTimetable(tightsMoveOffApp, thu), false);

console.log("wa-inbound-speech-act.test.ts: ok");
