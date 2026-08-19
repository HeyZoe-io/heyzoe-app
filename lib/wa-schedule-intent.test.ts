import assert from "node:assert/strict";
import { isScheduleIntent } from "@/lib/wa-schedule-intent";

assert.equal(isScheduleIntent("צפייה במערכת השעות"), true);
assert.equal(isScheduleIntent("צפייה במערכת שעות"), true);
assert.equal(isScheduleIntent("מתי ניתן להגיע לשיעור ניסיון?"), true);
assert.equal(isScheduleIntent("מתי אפשר להגיע לשיעור?"), true);
assert.equal(isScheduleIntent("מתי אפשר לבוא לאימון ניסיון"), true);
assert.equal(isScheduleIntent("מתי יש שיעור"), true);

assert.equal(isScheduleIntent("יש שיעור בשלישי?"), true);
assert.equal(isScheduleIntent("יש אימון ביום שני"), true);

assert.equal(isScheduleIntent("עם מי לתאם הגעה לשיעור ניסיון?"), false);
assert.equal(isScheduleIntent("אשמח לדעת עלויות"), false);
assert.equal(isScheduleIntent("לא. תודה."), false);
assert.equal(isScheduleIntent("שיעור ניסיון"), false);

console.log("wa-schedule-intent.test.ts: ok");
