import assert from "node:assert/strict";
import {
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

assert.equal(matchesClassRescheduleUpdate("אפשר לדחות שיעור?"), false);
assert.equal(matchesClassRescheduleUpdate("מה מדיניות הביטול"), false);

assert.equal(
  buildClassRescheduleTeamHandoffReply("אלין"),
  "היי כאן אלין הבוטית, תודה על העדכון! אמסור את המידע לצוות שלנו"
);

console.log("wa-class-reschedule.test.ts: ok");
