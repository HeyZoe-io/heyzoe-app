import assert from "node:assert/strict";
import {
  looksLikeMembershipStatusConfirm,
  matchesArboxRegistrationVerifyAsk,
} from "@/lib/wa-arbox-registration-verify";

assert.equal(matchesArboxRegistrationVerifyAsk("מוודאה שהיום יש לנו אימון ניסיון"), true);
assert.equal(matchesArboxRegistrationVerifyAsk("אני וחברה רשומות. רק רציתי לוודא"), true);
assert.equal(matchesArboxRegistrationVerifyAsk("רק רציתי לוודא את ההרשמה"), true);
assert.equal(matchesArboxRegistrationVerifyAsk("אני רשומה"), true);
assert.equal(matchesArboxRegistrationVerifyAsk("אני רשומה לשיעור של מחר?"), true);

assert.equal(matchesArboxRegistrationVerifyAsk("מתי יש אימון ניסיון היום?"), false);
assert.equal(matchesArboxRegistrationVerifyAsk("מה יש היום?"), false);
assert.equal(matchesArboxRegistrationVerifyAsk("נרשמתי"), false);
assert.equal(matchesArboxRegistrationVerifyAsk("היי"), false);
assert.equal(matchesArboxRegistrationVerifyAsk("אני רק רוצה לוודא"), false);
assert.equal(matchesArboxRegistrationVerifyAsk("רק רציתי לוודא שקיבלתם"), false);
const membershipConfirm =
  "היי, בהמשך לשיחה הקודמת, אני רק רוצה לוודא שבקשת הפסקת המנוי ברורה ואני לא אקבל חיוב גם עבור אוקטובר.";
assert.equal(matchesArboxRegistrationVerifyAsk(membershipConfirm), false);
assert.equal(looksLikeMembershipStatusConfirm(membershipConfirm), true);
assert.equal(looksLikeMembershipStatusConfirm("אני רשומה לשיעור של מחר?"), false);
assert.equal(
  matchesArboxRegistrationVerifyAsk("איזו הרשמה? ביקשתי לבטל המנוי, אני מוודאת שהוא בוטל"),
  false
);

console.log("wa-arbox-registration-verify.test.ts: ok");
