import assert from "node:assert/strict";
import {
  assistantReplyIndicatesLeadNotRelevant,
  buildNotRelevantContactPatch,
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
assert.equal(matchesNotRelevantKeyword("לא תודה"), true);
assert.equal(matchesNotRelevantKeyword("לא. תודה."), true);
assert.equal(matchesNotRelevantKeyword("לא, תודה"), true);
assert.equal(matchesNotRelevantKeyword("לא. תודה, מתי השיעור?"), false);
assert.equal(matchesNotRelevantKeyword("אל תכתבי לי יותר"), true);
assert.equal(matchesNotRelevantKeyword("תפסיקי לכתוב"), true);
assert.equal(matchesNotRelevantKeyword("not interested"), true);

assert.equal(matchesNotRelevantKeyword("האם זה רלוונטי למתחילים?"), false);
assert.equal(matchesNotRelevantKeyword("האם זה לא רלוונטי למתחילים?"), false);
assert.equal(matchesNotRelevantKeyword("היי, מתי יש שיעור?"), false);
assert.equal(matchesNotRelevantKeyword("ביי"), false);
assert.equal(matchesNotRelevantKeyword("בסדר"), false);
assert.equal(matchesNotRelevantKeyword("אני מגיע לבד, זה בסדר?"), false);
assert.equal(matchesNotRelevantKeyword("איך עובד השיעור מה עושים בו ?"), false);
assert.equal(matchesNotRelevantKeyword("אפשר לשלם במזומן ?"), false);
assert.equal(matchesNotRelevantKeyword("רחוק לי"), false);
assert.equal(matchesNotRelevantKeyword("או פריפיט"), false);

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

{
  const patch = buildNotRelevantContactPatch("רחוק", "2026-08-20T08:00:00.000Z");
  assert.equal(patch.human_requested_at, null);
}

console.log("not-relevant.test.ts: ok");
