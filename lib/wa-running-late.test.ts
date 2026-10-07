import assert from "node:assert/strict";
import {
  ARRIVING_IN_MINUTES_ACK,
  buildRunningLateAck,
  extractRunningLateEtaMinutes,
  matchesArrivingInAFewMinutes,
  matchesRunningLateStatusUpdate,
  RUNNING_LATE_ACK_MESSAGE,
} from "@/lib/wa-running-late";

const ahova = `הי, אהובה,
לצערי נאלצת לאחר אבל אני בדרך, אצטרף כאשר אצליח להגיע, ככל הנראה בעוד בערך 10 דק'.
לא מוותרת
סליחה ותודה`;

assert.equal(matchesRunningLateStatusUpdate(ahova), true);
assert.equal(extractRunningLateEtaMinutes(ahova), 10);
assert.equal(
  buildRunningLateAck(ahova),
  "אין בעיה בכלל! 🙂 אנחנו כאן, נראה אותך בעוד 10 דקות."
);

assert.equal(matchesRunningLateStatusUpdate("איחרתי, אני בדרך"), true);
assert.equal(matchesRunningLateStatusUpdate("אני בדרך אצטרף בעוד 10 דק"), true);

assert.equal(matchesRunningLateStatusUpdate("אני בדרך, מה הכתובת?"), false);
assert.equal(matchesRunningLateStatusUpdate("איך מגיעים"), false);
assert.equal(matchesRunningLateStatusUpdate("אנסה להגיע בסופ״ש"), false);
assert.equal(matchesRunningLateStatusUpdate("לא מוותרת"), false);
assert.equal(matchesRunningLateStatusUpdate(""), false);

assert.equal(ARRIVING_IN_MINUTES_ACK, "מחכים לך כמו תמיד");
assert.equal(matchesArrivingInAFewMinutes("כמה דק מגיע"), true);
assert.equal(matchesArrivingInAFewMinutes("כמה דק מגיע?"), true);
assert.equal(matchesArrivingInAFewMinutes("כמה דקות מגיעה"), true);
assert.equal(matchesArrivingInAFewMinutes("כמה דק' מגיע"), true);
assert.equal(matchesArrivingInAFewMinutes("עוד כמה דק מגיע"), true);
assert.equal(matchesArrivingInAFewMinutes("מגיע עוד כמה דקות"), true);
assert.equal(matchesArrivingInAFewMinutes("אני מגיע בעוד כמה דק"), true);
assert.equal(matchesArrivingInAFewMinutes("היום\nכמה דק מגיע"), true);
assert.equal(matchesArrivingInAFewMinutes("כמה דקות לוקח להגיע"), false);
assert.equal(matchesArrivingInAFewMinutes("איך מגיעים"), false);
assert.equal(matchesArrivingInAFewMinutes("כמה דק מגיע מה הכתובת"), false);
assert.equal(matchesArrivingInAFewMinutes("איחרתי, אני בדרך"), false);
assert.equal(matchesRunningLateStatusUpdate("כמה דק מגיע"), false);

assert.equal(RUNNING_LATE_ACK_MESSAGE, "אין בעיה בכלל! 🙂 אנחנו כאן.");
assert.equal(buildRunningLateAck("איחרתי, אני בדרך"), RUNNING_LATE_ACK_MESSAGE);
assert.equal(extractRunningLateEtaMinutes("איחרתי, אני בדרך"), null);
assert.equal(extractRunningLateEtaMinutes("אצטרף בעוד כ-5 דקות"), 5);

console.log("wa-running-late.test.ts: ok");
