import assert from "node:assert/strict";
import {
  assistantReplyClaimsUnauthorizedBookingChange,
  buildClassRescheduleTeamHandoffReply,
  matchesClassRescheduleUpdate,
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

console.log("wa-class-reschedule.test.ts: ok");
