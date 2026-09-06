import assert from "node:assert/strict";
import {
  classifyRegistrationIntentMembershipReply,
  matchesBookedClassMoveIntent,
  matchesExistingMembershipClaim,
  matchesRegistrationIntentPhrase,
  resolveBookedClassMoveBranch,
  shouldAskMembershipVsTrialFirst,
} from "@/lib/wa-registration-intent";
import { isJoinSignupIntentText } from "@/lib/wa-warmup-skip-intent";

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

const liveRegisterMe = "היי אשמח שתרשמי אותי לאימון כוח";
assert.equal(matchesRegistrationIntentPhrase(liveRegisterMe), true, "register-me (live)");
assert.equal(isJoinSignupIntentText(liveRegisterMe), false, "register-me is not join-signup");
assert.equal(shouldAskMembershipVsTrialFirst(liveRegisterMe), true, "register-me asks membership first");
assert.equal(matchesRegistrationIntentPhrase("אשמח שתרשמי אותי לאימון כוח"), true);
assert.equal(matchesRegistrationIntentPhrase("תרשמי אותי לאימון כוח"), true);
assert.equal(matchesRegistrationIntentPhrase("תרשום אותי לשיעור"), true);
assert.equal(matchesRegistrationIntentPhrase("תרשמו אותי בבקשה"), true);
assert.equal(matchesRegistrationIntentPhrase("תירשמי אותי לאימון"), true);
assert.equal(matchesRegistrationIntentPhrase("אפשר לרשום אותי לאימון כוח"), true);
assert.equal(matchesRegistrationIntentPhrase("רשמי אותי לאימון כוח"), true);
assert.equal(matchesRegistrationIntentPhrase("please sign me up for strength"), true);
assert.equal(matchesRegistrationIntentPhrase("can you register me"), true);
assert.equal(shouldAskMembershipVsTrialFirst("אשמח להירשם לאימון כוח"), true);
assert.equal(shouldAskMembershipVsTrialFirst("רוצה להצטרף בשבת לפוואר אנד הייט"), true);
assert.equal(shouldAskMembershipVsTrialFirst("אשמח להירשם לשיעור ניסיון"), false);

assert.equal(matchesRegistrationIntentPhrase("כמה עולה השיעור?"), false);
assert.equal(matchesRegistrationIntentPhrase("אפשר להירשם רק לשיעור ניסיון 1?"), false);
assert.equal(matchesRegistrationIntentPhrase("מה הכתובת"), false);
assert.equal(matchesRegistrationIntentPhrase(""), false);
assert.equal(matchesRegistrationIntentPhrase("18:30 מצוין"), false);
assert.equal(matchesRegistrationIntentPhrase("מתי יש אימון כוח"), false);
assert.equal(shouldAskMembershipVsTrialFirst("18:30 מצוין"), false);

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

const sickReschedule =
  "היי, אני רשומה לשיעור ניסיון היום ואני לא מרגישה טוב, אפשר לתאם ליום אחר השבוע?";
assert.equal(matchesBookedClassMoveIntent(sickReschedule), true);
assert.equal(resolveBookedClassMoveBranch(sickReschedule), "trial_pick");
assert.equal(matchesRegistrationIntentPhrase(sickReschedule), true);
assert.equal(matchesBookedClassMoveIntent("אפשר לתאם ליום אחר השבוע?"), true);
assert.equal(resolveBookedClassMoveBranch("אפשר לתאם ליום אחר השבוע?"), "clarify");
assert.equal(matchesBookedClassMoveIntent("אשמח להחליף שיעור"), true);
assert.equal(resolveBookedClassMoveBranch("אשמח להחליף שיעור"), "clarify");
assert.equal(matchesBookedClassMoveIntent("אפשר לדחות שיעור?"), true);
assert.equal(
  resolveBookedClassMoveBranch("אני רשומה לשיעור, יש לי מנוי, אפשר לדחות?"),
  "app"
);

assert.equal(matchesBookedClassMoveIntent("אני רשומה לשיעור יוגה"), false);
assert.equal(matchesBookedClassMoveIntent("לא מרגישה טוב"), false);
assert.equal(matchesBookedClassMoveIntent("אשמח לתאם שיעור ניסיון בשישי בעשר"), false);
assert.equal(matchesBookedClassMoveIntent("מתי אני רשומה"), false);
assert.equal(
  matchesBookedClassMoveIntent("תבטלי את השיעור עם שיר בבקשה. היא חולה."),
  false
);

console.log("wa-registration-intent.test.ts: ok");
