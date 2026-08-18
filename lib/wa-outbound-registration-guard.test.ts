import assert from "node:assert/strict";
import {
  SCHEDULE_WHEN_CONVENIENT_QUESTION,
  ensureScheduleWhenConvenientQuestion,
  stripPrematureAfterRegistration,
} from "@/lib/wa-outbound-registration-guard";

const mixed =
  "מושלם! יום שני 18:00 זה שיעור מעולה 🙂 עכשיו בואו נרשום אתכם. הרישום והתשלום נעשים דרך לינק מאובטח כאן: https://plando.co.il/self_services/embed_store/20951 כל הכבוד! נרשמתם בהצלחה 🎉 מתרגשים לראותכם בקרוב!\nזה קורה בכתובת: דם המכבים 36, מודיעין ככה מגיעים אלינו:\nעולים לקומה 2 בבניין A מומלץ להגיע לשיעור לפחות 10 דקות לפני, עם בקבוק מים ומגבת אישית! סופר מחכים לראותכם. נתראה בקרוב! מוזמנים לבקר באינסטגרם שלנו בינתיים:\nhttps://www.instagram.com/sanga.yoga/";

const stripped = stripPrematureAfterRegistration(mixed);
assert.match(stripped, /plando\.co\.il/);
assert.doesNotMatch(stripped, /נרשמתם בהצלחה/);
assert.doesNotMatch(stripped, /זה קורה בכתובת/);
assert.doesNotMatch(stripped, /instagram\.com/);

assert.equal(
  stripPrematureAfterRegistration("כל הכבוד! נרשמת בהצלחה 🎉\nזה קורה בכתובת: הרצל 1"),
  ""
);

assert.equal(
  stripPrematureAfterRegistration("מעולה, נתראה מחר בשיעור"),
  "מעולה, נתראה מחר בשיעור"
);

const listed =
  "שיעורי יוגה מתחילים הם מושלמים לשניכם. השיעור עולה 30₪. יום ראשון 08:30\nיום שני 18:00\nיום שלישי 17:30\nיום חמישי 08:30";
const withQ = ensureScheduleWhenConvenientQuestion(listed);
assert.ok(withQ.endsWith(SCHEDULE_WHEN_CONVENIENT_QUESTION));

assert.equal(
  ensureScheduleWhenConvenientQuestion(`${listed}\n\nמתי נוח לך להגיע?`),
  `${listed}\n\nמתי נוח לך להגיע?`
);

assert.equal(ensureScheduleWhenConvenientQuestion("יום שני 18:00 זה מצוין"), "יום שני 18:00 זה מצוין");

console.log("wa-outbound-registration-guard.test.ts: ok");
