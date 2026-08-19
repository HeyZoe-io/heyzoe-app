import assert from "node:assert/strict";
import {
  assistantReplyClaimsUnauthorizedBookingChange,
  buildClassRescheduleTeamHandoffReply,
  matchesClassRescheduleUpdate,
  resolveUnauthorizedBookingHandoff,
} from "@/lib/wa-class-reschedule";
import { matchesTrialAlreadyRegisteredMessage, matchesTrialRegisteredMessage } from "@/lib/sales-flow";

const postponed =
  "לא לכעוס אבל דחיתי לחמישי כי שכחתי שיש לי תור לרופא אבל כבר נרשמתי לחמישי";
assert.equal(matchesClassRescheduleUpdate(postponed), true);
assert.equal(matchesTrialAlreadyRegisteredMessage(postponed), false);
assert.equal(matchesTrialRegisteredMessage(postponed), false);

assert.equal(matchesClassRescheduleUpdate("החלפתי לשיעור של חמישי"), true);
assert.equal(matchesClassRescheduleUpdate("שיניתי מועד לערב"), true);
assert.equal(matchesClassRescheduleUpdate("I postponed my class to Thursday"), true);

assert.equal(matchesClassRescheduleUpdate("כבר נרשמתי"), false);
assert.equal(matchesClassRescheduleUpdate("נרשמתי לשיעור ניסיון"), false);
assert.equal(matchesTrialAlreadyRegisteredMessage("כבר נרשמתי"), true);
assert.equal(matchesTrialRegisteredMessage("נרשמתי"), true);
assert.equal(matchesClassRescheduleUpdate("כבר נרשמתי לחמישי"), true);
assert.equal(matchesTrialAlreadyRegisteredMessage("כבר נרשמתי לחמישי"), false);

const wrongHour =
  "יו אלין!\nאני רשומה ל-8 בטעות במקום 9.\nגיליתי עכשיו הכי במקרה\nאני ממש מצטערת, 9 זו השעה הקבועה שלי ברביעי, נרשמתי ל-8 בטעות לגמרי ….";
assert.equal(matchesClassRescheduleUpdate(wrongHour), true);
assert.equal(matchesTrialRegisteredMessage(wrongHour), false);
assert.equal(matchesClassRescheduleUpdate("נרשמתי לשעה 8 במקום 9"), true);
assert.equal(matchesClassRescheduleUpdate("I signed up for the wrong time by mistake"), true);

assert.equal(matchesClassRescheduleUpdate("אפשר לדחות שיעור?"), false);
assert.equal(matchesClassRescheduleUpdate("מה מדיניות הביטול"), false);
assert.equal(matchesClassRescheduleUpdate("אני רוצה לבטל את ההרשמה שלי"), true);
assert.equal(matchesClassRescheduleUpdate("תבטלי לי את ההרשמה"), true);

assert.equal(
  buildClassRescheduleTeamHandoffReply("לימי"),
  "היי! כאן לימי, אני אעביר את הפנייה שלך לצוות!"
);
assert.equal(
  buildClassRescheduleTeamHandoffReply("אלין"),
  "היי! כאן אלין, אני אעביר את הפנייה שלך לצוות!"
);

assert.equal(
  assistantReplyClaimsUnauthorizedBookingChange(
    "אני מבינה, קרה לך! 💜 עשיתי לך שינוי בהרשמה. אתה צריכה להיות ברשומה לשעה 9 ברביעי."
  ),
  true
);
assert.equal(assistantReplyClaimsUnauthorizedBookingChange("נשמח לראותך בשיעור"), false);
assert.equal(
  assistantReplyClaimsUnauthorizedBookingChange("רשמתי אותך לשיעור ניסיון ביום רביעי"),
  true
);
assert.equal(
  assistantReplyClaimsUnauthorizedBookingChange("אפשר לשנות מועד? אני אבדוק מול הצוות"),
  false
);
assert.equal(
  assistantReplyClaimsUnauthorizedBookingChange("הבנתי את ההרשמה שלך, אני מעבירה לצוות."),
  false
);
assert.equal(
  assistantReplyClaimsUnauthorizedBookingChange("בדקתי ביומן ואין לי הרשאה לשנות."),
  false
);

// Third phrasing: not דחיתי/החלפתי and not נרשמתי בטעות — inbound keywords miss;
// fabricated confirmation must still be blocked by the outbound claim-guard.
const thirdPhrasing =
  "היי יש טעות בשיבוץ שלי לרביעי — יצא 8:00 ואני תמיד ב-9:00, אפשר לסדר?";
assert.equal(matchesClassRescheduleUpdate(thirdPhrasing), false);
const thirdFabricated = "אוקיי תיקנתי אותך ל-9 ברביעי, הכל מעודכן ביומן.";
const thirdDecision = resolveUnauthorizedBookingHandoff({
  inbound: thirdPhrasing,
  assistantReply: thirdFabricated,
});
assert.equal(thirdDecision.handoff, true);
assert.equal(thirdDecision.reason, "assistant_claim");
assert.equal(
  resolveUnauthorizedBookingHandoff({ inbound: thirdPhrasing, assistantReply: null }).handoff,
  false
);
assert.equal(
  resolveUnauthorizedBookingHandoff({
    inbound: thirdPhrasing,
    assistantReply: "אין לי גישה ליומן ההרשמות, אני מעבירה לצוות.",
  }).handoff,
  false
);

// #1 general claim-guard (not an inbound keyword, not the old verb allowlist).
// Turn 1 may skip Claude via #2; the proof is a follow-up that does not match
// inbound, plus a completion claim using unlisted verbs (סגרתי / הסרתי).
const cancelRequest = "אני רוצה לבטל את ההרשמה שלי";
const cancelFollowUp = "כן תעשי את זה עכשיו";
assert.equal(matchesClassRescheduleUpdate(cancelFollowUp), false);
const claudeClaimedCancelDone =
  "סגרתי לך את זה, הסרתי אותך מהרשימה. את כבר לא רשומה לשיעור.";
assert.equal(assistantReplyClaimsUnauthorizedBookingChange(claudeClaimedCancelDone), true);
const cancelFollowUpDecision = resolveUnauthorizedBookingHandoff({
  inbound: cancelFollowUp,
  assistantReply: claudeClaimedCancelDone,
});
assert.equal(cancelFollowUpDecision.handoff, true);
assert.equal(cancelFollowUpDecision.reason, "assistant_claim");
assert.equal(
  resolveUnauthorizedBookingHandoff({
    inbound: cancelRequest,
    assistantReply: claudeClaimedCancelDone,
  }).reason,
  "assistant_claim"
);
assert.equal(
  assistantReplyClaimsUnauthorizedBookingChange("הזזתי אותך ל-9 ברביעי"),
  true
);
assert.equal(
  assistantReplyClaimsUnauthorizedBookingChange("טיפלתי בהרשמה שלך, את כבר לא ברשימה."),
  true
);

console.log("wa-class-reschedule.test.ts: ok");
