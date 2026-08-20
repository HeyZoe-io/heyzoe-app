import assert from "node:assert/strict";
import {
  classifyRegistrationIntentMembershipReply,
  matchesExistingMembershipClaim,
  matchesRegistrationIntentPhrase,
} from "@/lib/wa-registration-intent";

assert.equal(matchesRegistrationIntentPhrase("רוצה להצטרף בשבת לפוואר אנד הייט"), true);
assert.equal(matchesRegistrationIntentPhrase("רוצה להצטרף לפוואר אנד הייט"), true);
assert.equal(matchesRegistrationIntentPhrase("אשמח להחליף שיעור"), true);
assert.equal(matchesRegistrationIntentPhrase("אני מנסה להירשם לשיעור"), true);
assert.equal(matchesRegistrationIntentPhrase("מנסה להירשם לשיעור"), true);
assert.equal(matchesRegistrationIntentPhrase("רוצה להירשם מחר"), true);
assert.equal(
  matchesRegistrationIntentPhrase("היי הייתי שמח להירשם לשיעור מתחילים אני ובת הזוג שלי"),
  true
);
assert.equal(matchesRegistrationIntentPhrase("הייתי שמח להירשם לשיעור מתחילים"), true);
assert.equal(matchesRegistrationIntentPhrase("אשמח להירשם לשיעור"), true);
assert.equal(matchesRegistrationIntentPhrase("נשמח להירשם"), true);

assert.equal(matchesRegistrationIntentPhrase("כמה עולה השיעור?"), false);
assert.equal(matchesRegistrationIntentPhrase("אפשר להירשם רק לשיעור ניסיון 1?"), false);
assert.equal(matchesRegistrationIntentPhrase("מה הכתובת"), false);
assert.equal(matchesRegistrationIntentPhrase(""), false);

assert.equal(classifyRegistrationIntentMembershipReply("כן"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("כן יש לי"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("יש לי מנוי"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("מנוי קיים"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("מנוי"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("yes"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("אימון ניסיון"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("מדובר באימון ניסיון"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("ניסיון"), "no");

assert.equal(classifyRegistrationIntentMembershipReply("לא"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("אין לי"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("אין לי מנוי"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("no"), "no");

assert.equal(matchesExistingMembershipClaim("יש לי מנוי"), true);
assert.equal(matchesExistingMembershipClaim("יש לנו מנוי"), true);
assert.equal(matchesExistingMembershipClaim("כבר יש לי מנוי"), true);
assert.equal(matchesExistingMembershipClaim("אני מנויה"), true);
assert.equal(matchesExistingMembershipClaim("אני כבר מנוי"), true);
assert.equal(matchesExistingMembershipClaim("i have a membership"), true);
assert.equal(matchesExistingMembershipClaim("I'm already a member"), true);

assert.equal(matchesExistingMembershipClaim("אין לי מנוי"), false);
assert.equal(matchesExistingMembershipClaim("רוצה מנוי"), false);
assert.equal(matchesExistingMembershipClaim("מה כולל המנוי"), false);
assert.equal(matchesExistingMembershipClaim("כן"), false);
assert.equal(matchesExistingMembershipClaim("יש פילאטיס?"), false);

assert.equal(classifyRegistrationIntentMembershipReply("אין בעיה"), "unclear");
assert.equal(classifyRegistrationIntentMembershipReply("מה זה"), "unclear");
assert.equal(classifyRegistrationIntentMembershipReply("Power & HIIT"), "unclear");

console.log("wa-registration-intent.test.ts: ok");
