import assert from "node:assert/strict";
import { buildNonArboxClassChangeTeamHandoffReply } from "@/lib/wa-closed-playbook-copy";
import {
  BOOKED_CLASS_MOVE_APP_MODEL,
  BOOKED_CLASS_MOVE_APP_REPLY,
  buildBookedClassMoveAppReply,
  CLASS_MOVE_CLARIFY_MODEL,
  classifyRegistrationIntentMembershipReply,
  inboundSaysClassChangeAppFailed,
  matchesBookedClassMoveIntent,
  matchesExistingMembershipClaim,
  matchesRegistrationIntentPhrase,
  REGISTRATION_INTENT_CLARIFY_QUESTION,
  resolveArboxClassMoveOutcome,
  resolveRescheduleWithMemberFlag,
  RESCHEDULE_MEMBER_BY_FLAG_MODEL,
  resolveBookedClassMoveBranch,
  shouldAskMembershipVsTrialFirst,
} from "@/lib/wa-registration-intent";
import { isJoinSignupIntentText } from "@/lib/wa-warmup-skip-intent";

assert.equal(matchesRegistrationIntentPhrase("רוצה להצטרף בשבת לפוואר אנד הייט"), true);
assert.equal(matchesRegistrationIntentPhrase("רוצה להצטרף לפוואר אנד הייט"), true);
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
assert.equal(resolveBookedClassMoveBranch(sickReschedule), "app", "trial booking swap → app");
assert.equal(matchesRegistrationIntentPhrase(sickReschedule), false);
assert.match(buildBookedClassMoveAppReply(sickReschedule), /מצטערת לשמוע/);
assert.match(buildBookedClassMoveAppReply(sickReschedule), /מהאפליקציה/);
assert.equal(matchesBookedClassMoveIntent("אפשר להזיז את האימון?"), true);
assert.equal(matchesBookedClassMoveIntent("אפשר להזיז אותי מחמישי לשני?"), true);
assert.equal(matchesBookedClassMoveIntent("אפשר לתאם ליום אחר השבוע?"), true);
assert.equal(resolveBookedClassMoveBranch("אפשר לתאם ליום אחר השבוע?"), "app");
assert.equal(
  resolveBookedClassMoveBranch("אפשר להחליף שיעור?", { salesFlowStarted: true, sessionPhase: "opening" }),
  "product_pick"
);
assert.equal(
  resolveBookedClassMoveBranch("אפשר להחליף שיעור?", { trialRegistered: true, salesFlowStarted: true }),
  "app"
);
assert.equal(matchesBookedClassMoveIntent("אשמח להחליף שיעור"), true);
assert.equal(resolveBookedClassMoveBranch("אשמח להחליף שיעור"), "app");
assert.equal(buildBookedClassMoveAppReply("אשמח להחליף שיעור"), BOOKED_CLASS_MOVE_APP_REPLY);
assert.equal(matchesBookedClassMoveIntent("אפשר לדחות שיעור?"), true);
assert.equal(
  resolveBookedClassMoveBranch("אני רשומה לשיעור, יש לי מנוי, אפשר לדחות?"),
  "app"
);
assert.equal(
  resolveBookedClassMoveBranch("רשומה לשיעור ניסיון, אפשר להחליף?", { salesFlowStarted: true }),
  "app"
);
assert.equal(resolveBookedClassMoveBranch("יש לי כרטיסיה, אפשר להחליף שיעור?"), "app");

const apexPostponeTrial =
  "הי\n\nהיינו אמורים לעשות אימון נסיון היום ב 19:00\nזה לא מסתדר\nאפשרי בבקשה לדחות בשבוע - ליום ד הבא לשעה 19:30 ?\nתודה";
const apexCantAttendTrial =
  "לגבי האימון ניסיון היום בקרוספיט משולב ב17:30 אני לא אוכל להגיע אז אם אפשר לקבוע למועד אחר זה יהיה מעולה";
assert.equal(matchesBookedClassMoveIntent(apexCantAttendTrial), true, "can't attend booked trial");
assert.equal(resolveBookedClassMoveBranch(apexCantAttendTrial), "app");
assert.equal(matchesBookedClassMoveIntent("היום לא אוכל להגיע מחר אשמח"), false);
assert.equal(
  matchesBookedClassMoveIntent("אשמח לאימון ניסיון אבל היום לא אוכל להגיע, אפשר לקבוע למועד אחר?"),
  true,
  "explicit other-slot still a move, trial-topic handler runs first when desire is present"
);

assert.equal(matchesBookedClassMoveIntent(apexPostponeTrial), true, "postpone existing trial");
assert.equal(
  resolveBookedClassMoveBranch(apexPostponeTrial, { salesFlowStarted: true, sessionPhase: "opening" }),
  "app",
  "already-booked trial postpone → app, not product pick / warmup"
);

const lateCancelThenTomorrow =
  "היי הייתי אמורה להגיע היום ב7:15 ולצערי לא הסתדר כי היה לילה מאתגר וביטלתי מאוחר, ואשמח להגיע מחר בשעה 7:30 אני רואה שיש הרבה מקום בשעה הזאת.";
assert.equal(matchesBookedClassMoveIntent(lateCancelThenTomorrow), true);
assert.equal(resolveBookedClassMoveBranch(lateCancelThenTomorrow), "app");
assert.equal(matchesBookedClassMoveIntent("הייתי אמורה להגיע מחר, מתי יש שיעור?"), false);
assert.equal(matchesBookedClassMoveIntent("אני רשומה לשיעור יוגה"), false);
assert.equal(matchesBookedClassMoveIntent("לא מרגישה טוב"), false);
assert.equal(matchesBookedClassMoveIntent("אשמח לתאם שיעור ניסיון בשישי בעשר"), false);
assert.equal(matchesBookedClassMoveIntent("מתי אני רשומה"), false);
assert.equal(
  matchesBookedClassMoveIntent("תבטלי את השיעור עם שיר בבקשה. היא חולה."),
  false
);

const tightsMoveOffApp =
  "היי תמחקו אותי בבקשה מהשיעור של יום ראשון הקרוב ותעבירו אותי ליום שני ב08.30 אי אפשר דרך האפליקציה תודנ";
assert.equal(matchesBookedClassMoveIntent(tightsMoveOffApp), true);
assert.equal(inboundSaysClassChangeAppFailed(tightsMoveOffApp), true);
assert.equal(matchesBookedClassMoveIntent("תעבירו אותי למנהלת"), false);
assert.equal(matchesBookedClassMoveIntent("מתי יש שיעור ביום שני?"), false);
assert.equal(inboundSaysClassChangeAppFailed("אפשר להחליף שיעור?"), false);
const moveHandoff = buildNonArboxClassChangeTeamHandoffReply(tightsMoveOffApp);
assert.match(moveHandoff, /מעבירה לצוות/);
assert.match(moveHandoff, /לבטל או להחליף את השיעור/);
assert.doesNotMatch(moveHandoff, /אפליקצי/);

const vagueMove = "השעה שקבעתי לא מסתדרת, יש מצב למצוא לי משהו אחר?";
assert.equal(resolveArboxClassMoveOutcome(vagueMove).kind, "ask");
assert.equal(resolveArboxClassMoveOutcome(vagueMove).reply, REGISTRATION_INTENT_CLARIFY_QUESTION);
assert.equal(resolveArboxClassMoveOutcome(vagueMove).model, CLASS_MOVE_CLARIFY_MODEL);
assert.equal(resolveArboxClassMoveOutcome(vagueMove).notifyTeam, false);

assert.equal(resolveArboxClassMoveOutcome("אפשר להזיז את האימון?").kind, "ask");
assert.equal(resolveArboxClassMoveOutcome("יש לי מנוי, אפשר להזיז את האימון למחר?").kind, "ask");
assert.equal(resolveArboxClassMoveOutcome("רשומה לשיעור ניסיון, אפשר להחליף?").kind, "ask");
assert.equal(resolveArboxClassMoveOutcome(sickReschedule).kind, "ask");
assert.equal(resolveArboxClassMoveOutcome("מתאמנת אצלכם כבר שנה").kind, "ask");

const memberFromClaude = resolveArboxClassMoveOutcome("מתאמנת אצלכם כבר שנה", { stated: "member" });
assert.equal(memberFromClaude.kind, "member");
assert.equal(memberFromClaude.reply, BOOKED_CLASS_MOVE_APP_REPLY);
assert.equal(memberFromClaude.notifyTeam, false);

const memberFact = resolveArboxClassMoveOutcome("מתאמנת אצלכם כבר שנה", {
  stated: "member",
  knowledge: {
    botName: "זואי",
    knowledgeQa: [{ question: "החלפת שיעור", answer: "אצלנו מחליפים רק עד 3 שעות לפני, דרך הוואטסאפ של הצוות." }],
  },
});
assert.equal(memberFact.kind, "member");
assert.match(memberFact.reply, /3 שעות/);
assert.equal(memberFact.model, "closed_playbook_fact_reschedule");

const trialFromClaude = resolveArboxClassMoveOutcome("זה השיעור הראשון שלי", { stated: "trial" });
assert.equal(trialFromClaude.kind, "trial_team");
assert.match(trialFromClaude.reply, /צוות/);
assert.equal(trialFromClaude.notifyTeam, true);

const vague = "אפשר להזיז את האימון למחר?";
const flaggedMember = resolveRescheduleWithMemberFlag(vague, { arboxIsMember: true });
assert.equal(flaggedMember.kind, "member");
assert.equal(flaggedMember.reply, BOOKED_CLASS_MOVE_APP_REPLY);
assert.equal(flaggedMember.model, RESCHEDULE_MEMBER_BY_FLAG_MODEL);
assert.equal(flaggedMember.notifyTeam, false);

const flaggedFalse = resolveRescheduleWithMemberFlag(vague, { arboxIsMember: false });
assert.equal(flaggedFalse.kind, "ask");
assert.equal(flaggedFalse.reply, REGISTRATION_INTENT_CLARIFY_QUESTION);
assert.equal(flaggedFalse.model, CLASS_MOVE_CLARIFY_MODEL);

const flaggedNull = resolveRescheduleWithMemberFlag(vague, { arboxIsMember: null });
assert.equal(flaggedNull.kind, "ask");
assert.equal(flaggedNull.model, CLASS_MOVE_CLARIFY_MODEL);

const flaggedMissing = resolveRescheduleWithMemberFlag(vague);
assert.equal(flaggedMissing.kind, "ask");

const flaggedFact = resolveRescheduleWithMemberFlag(vague, {
  arboxIsMember: true,
  knowledge: {
    botName: "זואי",
    knowledgeQa: [{ question: "החלפת שיעור", answer: "אצלנו מחליפים רק עד 3 שעות לפני, דרך הוואטסאפ של הצוות." }],
  },
});
assert.equal(flaggedFact.kind, "member");
assert.match(flaggedFact.reply, /3 שעות/);
assert.equal(flaggedFact.model, RESCHEDULE_MEMBER_BY_FLAG_MODEL);

const flaggedTrialAnswer = resolveRescheduleWithMemberFlag("זה אימון ניסיון", {
  stated: "trial",
  arboxIsMember: true,
});
assert.equal(flaggedTrialAnswer.kind, "trial_team");
assert.equal(flaggedTrialAnswer.model, "class_move_trial_team_handoff");

const flaggedAlreadyMember = resolveRescheduleWithMemberFlag(vague, {
  stated: "member",
  arboxIsMember: true,
});
assert.equal(flaggedAlreadyMember.kind, "member");
assert.equal(flaggedAlreadyMember.model, BOOKED_CLASS_MOVE_APP_MODEL);

console.log("wa-registration-intent.test.ts: ok");
