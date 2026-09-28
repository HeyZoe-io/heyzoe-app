import assert from "node:assert/strict";
import { isScheduleIntent, looksLikeScheduleBoardAsk } from "@/lib/wa-schedule-intent";

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

assert.equal(looksLikeScheduleBoardAsk("צפייה במערכת השעות"), true);
assert.equal(looksLikeScheduleBoardAsk("אשמח לקבל מערכת שעות"), true);
assert.equal(looksLikeScheduleBoardAsk("לוח שיעורים בבקשה"), true);
assert.equal(looksLikeScheduleBoardAsk("מתי יש אימון כוח?"), false);
assert.equal(looksLikeScheduleBoardAsk("מתי מתקיים Strength?"), false);
assert.equal(looksLikeScheduleBoardAsk("באילו ימים יש פילאטיס?"), false);
assert.equal(looksLikeScheduleBoardAsk("מערכת שעות של אימון כוח"), true);

console.log("wa-schedule-intent.test.ts: ok");
