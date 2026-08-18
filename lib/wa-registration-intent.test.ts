import assert from "node:assert/strict";
import {
  classifyRegistrationIntentMembershipReply,
  matchesRegistrationIntentPhrase,
} from "@/lib/wa-registration-intent";

assert.equal(matchesRegistrationIntentPhrase("רוצה להצטרף בשבת לפוואר אנד הייט"), true);
assert.equal(matchesRegistrationIntentPhrase("רוצה להצטרף לפוואר אנד הייט"), true);
assert.equal(matchesRegistrationIntentPhrase("אשמח להחליף שיעור"), true);
assert.equal(matchesRegistrationIntentPhrase("אני מנסה להירשם לשיעור"), true);
assert.equal(matchesRegistrationIntentPhrase("מנסה להירשם לשיעור"), true);
assert.equal(matchesRegistrationIntentPhrase("רוצה להירשם מחר"), true);

assert.equal(matchesRegistrationIntentPhrase("כמה עולה השיעור?"), false);
assert.equal(matchesRegistrationIntentPhrase("מה הכתובת"), false);
assert.equal(matchesRegistrationIntentPhrase(""), false);

assert.equal(classifyRegistrationIntentMembershipReply("כן"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("כן יש לי"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("יש לי מנוי"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("yes"), "yes");

assert.equal(classifyRegistrationIntentMembershipReply("לא"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("אין לי"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("אין לי מנוי"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("no"), "no");

assert.equal(classifyRegistrationIntentMembershipReply("אין בעיה"), "unclear");
assert.equal(classifyRegistrationIntentMembershipReply("מה זה"), "unclear");
assert.equal(classifyRegistrationIntentMembershipReply("Power & HIIT"), "unclear");

console.log("wa-registration-intent.test.ts: ok");
