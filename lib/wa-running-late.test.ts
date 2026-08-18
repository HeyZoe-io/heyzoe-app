import assert from "node:assert/strict";
import {
  matchesRunningLateStatusUpdate,
  RUNNING_LATE_ACK_MESSAGE,
} from "@/lib/wa-running-late";

assert.equal(
  matchesRunningLateStatusUpdate(
    "הי, אהובה,\nלצערי נאלצת לאחר אבל אני בדרך, אצטרף כאשר אצליח להגיע, ככל הנראה בעוד בערך 10 דק'.\nלא מוותרת\nסליחה ותודה"
  ),
  true
);
assert.equal(matchesRunningLateStatusUpdate("איחרתי, אני בדרך"), true);
assert.equal(matchesRunningLateStatusUpdate("אני בדרך אצטרף בעוד 10 דק"), true);

assert.equal(matchesRunningLateStatusUpdate("אני בדרך, מה הכתובת?"), false);
assert.equal(matchesRunningLateStatusUpdate("איך מגיעים"), false);
assert.equal(matchesRunningLateStatusUpdate("אנסה להגיע בסופ״ש"), false);
assert.equal(matchesRunningLateStatusUpdate("לא מוותרת"), false);
assert.equal(matchesRunningLateStatusUpdate(""), false);

assert.equal(RUNNING_LATE_ACK_MESSAGE, "בסדר גמור אנחנו כאן.");

console.log("wa-running-late.test.ts: ok");
