import assert from "node:assert/strict";
import { buildDefaultConversationOpening } from "@/lib/business-conversation-opening";
import { fillRegistrationText, matchQuestionButton } from "@/lib/business-conversation-flow-text";

assert.equal(
  fillRegistrationText({
    template: "רשמתי אותך ל{מוצר} ב{יום} בשעה {שעה}.",
    productName: "שחייה",
    day: "ראשון",
    time: "18:00",
  }),
  "רשמתי אותך לשחייה בראשון בשעה 18:00."
);

assert.equal(matchQuestionButton(["שחייה", "ריצה"], "שחייה"), 0);
assert.equal(matchQuestionButton(["שחייה", "ריצה"], "  ריצה "), 1);
assert.equal(matchQuestionButton(["שחייה"], "אופניים"), -1);

const opening = buildDefaultConversationOpening({
  botName: "זואי",
  businessName: "Pipman Team",
  tagline: "טריאתלון וריצה לכל הגילאים",
  address: "אזור רחובות והסביבה",
});
assert.match(opening, /היי! איזה כיף שהגעת אלינו/);
assert.match(opening, /שמי זואי מ־Pipman Team/);
assert.match(opening, /טריאתלון וריצה לכל הגילאים/);
assert.match(opening, /כתובתנו היא אזור רחובות והסביבה/);

console.log("business-conversation-flow-text.test.ts ok");
