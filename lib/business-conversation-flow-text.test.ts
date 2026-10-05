import assert from "node:assert/strict";
import { buildDefaultConversationOpening } from "@/lib/business-conversation-opening";
import {
  fillRegistrationText,
  inboundRestartsBusinessFlowFromStart,
  matchQuestionButton,
  serviceNameContainsInboundNeedle,
} from "@/lib/business-conversation-flow-text";

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
// «לא» must not match «פילאטיס» (ל+א inside the name).
assert.equal(matchQuestionButton(["פילאטיס מכשירים", "יוגה"], "לא"), -1);
assert.equal(matchQuestionButton(["כן", "לא תודה"], "לא"), 1);
assert.equal(matchQuestionButton(["כן", "לא תודה"], "כן"), 0);

assert.equal(serviceNameContainsInboundNeedle("פילאטיס מכשירים", "לא"), false);
assert.equal(serviceNameContainsInboundNeedle("פילאטיס מכשירים", "פילאטיס"), true);
assert.equal(serviceNameContainsInboundNeedle("פילאטיס מכשירים", "מכשירים"), true);

assert.equal(
  inboundRestartsBusinessFlowFromStart({ text: "אשמח לפרטים", businessSlug: "pipman-team" }),
  true
);
assert.equal(
  inboundRestartsBusinessFlowFromStart({
    text: "אשמח לפרטים",
    businessSlug: "pipman-team",
    currentQuestionButtons: ["טריאתלון ילדים ונוער", "ריצה"],
  }),
  true
);
assert.equal(
  inboundRestartsBusinessFlowFromStart({
    text: "אשמח לפרטים",
    businessSlug: "pipman-team",
    currentQuestionButtons: ["אשמח לפרטים", "לא תודה"],
  }),
  false
);
assert.equal(
  inboundRestartsBusinessFlowFromStart({ text: "מה השעות?", businessSlug: "pipman-team" }),
  false
);

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
