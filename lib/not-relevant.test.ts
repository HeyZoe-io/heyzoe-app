import assert from "node:assert/strict";
import {
  assistantReplyIndicatesLeadNotRelevant,
  matchesNotRelevantKeyword,
  shouldSendNotRelevantGatingReply,
} from "@/lib/not-relevant";

assert.equal(matchesNotRelevantKeyword("לא רלוונטי"), true);
assert.equal(
  matchesNotRelevantKeyword(
    "היי אלין! מה שלומך? מצטערת שלא זמינה 🙏🏻 קראו לי למילואים אז כרגע זה לא רלוונטי לצערי :) ברגע שאסיים אותם אצור שוב קשר!"
  ),
  true
);
assert.equal(matchesNotRelevantKeyword("אני לא מעוניינת יותר"), true);
assert.equal(matchesNotRelevantKeyword("האם זה רלוונטי למתחילים?"), false);
assert.equal(matchesNotRelevantKeyword("היי, מתי יש שיעור?"), false);

assert.equal(
  assistantReplyIndicatesLeadNotRelevant("אין בעיה בכלל! אם משהו ישתנה בעתיד, אנחנו כאן 😊"),
  true
);

const markedAt = "2026-08-16T11:14:45.314Z";
assert.equal(
  shouldSendNotRelevantGatingReply(markedAt, new Date("2026-08-16T11:15:33.024Z")),
  false
);
assert.equal(
  shouldSendNotRelevantGatingReply(markedAt, new Date("2026-08-16T11:45:45.314Z")),
  true
);
assert.equal(shouldSendNotRelevantGatingReply(null), true);

console.log("not-relevant.test.ts: ok");
