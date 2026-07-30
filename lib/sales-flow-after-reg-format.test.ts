import assert from "node:assert/strict";
import { formatAfterTrialRegistrationForWhatsAppDelivery } from "@/lib/sales-flow";

/** Joe's after_trial_registration_body style: headers on their own line, values on the next. */
const JOE_BODY = `איזה כיף שרכשת 😃

עכשיו כל מה שנשאר זה
להירשם דרך האפליקציה
___
יש ללחוץ על קישור להורדת האפליקציה 👇

https://link-to.app/acrobyjoe

נשלח אליך מייל עם שם משתמש וסיסמה
(במידה ולא – נא ללחוץ על ״שכחתי סיסמה״)
___
לכניסה והרשמה לשיעורים:

חתימה על ההצהרות

בחירת שיעור והרשמה

בחירת שיעור – Acroyoga Level 1:
מגיע/ה לבד: גבר – Base, אישה – Flyer
מגיעים בזוג: Couple
___
כתובת:
📍 רוטשילד 122, תל אביב (דרך בר אילן מצד ימין)

סרטון למצוא הכניסה:
https://mc.ht/s/e0qKfzF

מגיעים לסטודיו עם אוטו? 🚗
   שימו בוויז  ביל"ו 17, תל אביב 

כשתגיעו, תראו מימין שער צהוב, ותלחצו על הלינק הזה לפתוח :
ללחוץ רק פעם אחת ולחכות 10 שניות

https://gatekeeper-9682.twil.io/gate17hodor
  
(עד 30 דק' לפני ואחרי השיעור)

לאחר שחניתם, תחצו את מגרש הכדורסל ותראו את הסטודיו, שם אנחנו עפים 🧚‍♀️`;

const joeDelivered = formatAfterTrialRegistrationForWhatsAppDelivery(
  JOE_BODY,
  "",
  "רוטשילד 122, תל אביב",
  "הנה הדרכה",
  undefined,
  "he"
);

for (const header of [
  "לכניסה והרשמה לשיעורים:",
  "בחירת שיעור – Acroyoga Level 1:",
  "כתובת:",
  "סרטון למצוא הכניסה:",
  "כשתגיעו, תראו מימין שער צהוב, ותלחצו על הלינק הזה לפתוח :",
]) {
  assert.ok(
    joeDelivered.includes(header),
    `expected header to survive: ${JSON.stringify(header)}\n---\n${joeDelivered}`
  );
}

assert.ok(joeDelivered.includes("📍 רוטשילד 122, תל אביב (דרך בר אילן מצד ימין)"));
assert.ok(joeDelivered.includes("https://mc.ht/s/e0qKfzF"));

/** Empty placeholder on same line as label must be dropped. */
const withEmptyAddressPlaceholder = formatAfterTrialRegistrationForWhatsAppDelivery(
  `כל הכבוד!\n\nכתובת: {business_address}\nנתראה בקרוב!`,
  "",
  "",
  "",
  undefined,
  "he"
);
assert.equal(withEmptyAddressPlaceholder.includes("כתובת:"), false);
assert.ok(withEmptyAddressPlaceholder.includes("כל הכבוד!"));
assert.ok(withEmptyAddressPlaceholder.includes("נתראה בקרוב!"));

/** Filled placeholder on same line keeps the line (with value). */
const withFilledAddress = formatAfterTrialRegistrationForWhatsAppDelivery(
  `כתובת: {business_address}`,
  "",
  "רוטשילד 122",
  "",
  undefined,
  "he"
);
assert.ok(withFilledAddress.includes("כתובת: רוטשילד 122"));

console.log("sales-flow-after-reg-format.test.ts: ok");
