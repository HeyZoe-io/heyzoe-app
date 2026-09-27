import assert from "node:assert/strict";
import {
  annotateExpiredIsraelDates,
  stripExpiredDatedStatusFromReply,
} from "@/lib/wa-expired-knowledge-dates";

/** Sunday 27.9.2026 13:35 Israel — the Eileen booking ask. */
const sep27 = new Date("2026-09-27T10:35:05.000Z");

const eileen = `אלין בחופש השבוע 30.8-3.9
שאר הצוות זמין לכל שאלה
במידה ואת רוצה לבדוק זמינות לפגישה עם אלין ניתן להכנס ללינק ולשריין: https://arbox.link/NLev6Y2z`;

const annotated = annotateExpiredIsraelDates(eileen, sep27);
assert.doesNotMatch(annotated, /בחופש|30\.8|3\.9/);
assert.match(annotated, /שאר הצוות זמין/);
assert.match(annotated, /https:\/\/arbox\.link\/NLev6Y2z/);

const reply =
  "אלין בחופש השבוע עד 3.9, אבל אפשר לבדוק את זמינותה לפגישות דרך הלינק הזה: https://arbox.link/NLev6Y2z שם תוכלי לשריין ישירות את המועד שמתאים לך! 💜";
const stripped = stripExpiredDatedStatusFromReply(reply, sep27);
assert.doesNotMatch(stripped, /חופש|3\.9/);
assert.match(stripped, /https:\/\/arbox\.link\/NLev6Y2z/);
assert.match(stripped, /אפשר לבדוק/);
assert.doesNotMatch(stripped, /^אבל/);

assert.match(annotateExpiredIsraelDates("אלין בחופש 1.10-5.10", sep27), /בחופש/);
assert.match(annotateExpiredIsraelDates("אלין בחופש עד 27.9", sep27), /בחופש/);
assert.doesNotMatch(annotateExpiredIsraelDates("אלין בחופש עד 26.9", sep27), /בחופש/);
assert.equal(annotateExpiredIsraelDates("יום ראשון 08:00-20:00", sep27), "יום ראשון 08:00-20:00");

const sep16 = new Date("2026-09-16T12:00:00.000Z");
assert.match(annotateExpiredIsraelDates("20.9 ערב כיפור הסטודיו סגור", sep16), /סגור/);
assert.doesNotMatch(annotateExpiredIsraelDates("20.9 ערב כיפור הסטודיו סגור", sep27), /סגור/);

const dec29 = new Date("2026-12-29T10:00:00.000Z");
assert.match(annotateExpiredIsraelDates("הסטודיו סגור 28.12-3.1", dec29), /סגור/);

assert.equal(
  stripExpiredDatedStatusFromReply("אפשר לקבוע לרביעי ב-30.9", sep27),
  "אפשר לקבוע לרביעי ב-30.9"
);

const monthName = stripExpiredDatedStatusFromReply("אלין בחופשה עד 3 בספטמבר, הלינק נשאר.", sep27);
assert.doesNotMatch(monthName, /חופשה/);
assert.match(monthName, /הלינק נשאר/);

console.log("wa-expired-knowledge-dates.test.ts: ok");
