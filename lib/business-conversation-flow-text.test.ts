import assert from "node:assert/strict";
import { buildDefaultConversationOpening } from "@/lib/business-conversation-opening";
import {
  fillProductText,
  textUsesProductLink,
  fillRegistrationText,
  inboundRestartsBusinessFlowFromStart,
  matchQuestionButton,
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

const acro = { name: "אקרו יוגה - ליחיד", price: "80", duration: "80", sessions: "", link: "https://arbox.link/x" };
assert.equal(
  fillProductText("האימון עולה {מחיר} שקלים ונמשך {duration} דקות. נרשמים כאן: {קישור}", acro),
  "האימון עולה 80 שקלים ונמשך 80 דקות. נרשמים כאן: https://arbox.link/x"
);
assert.equal(fillProductText("{מפגשים} מפגשים", acro), "{מפגשים} מפגשים");
assert.equal(fillProductText("{מחיר}", null), "{מחיר}");
assert.equal(textUsesProductLink("נרשמים כאן: {קישור}"), true);
assert.equal(textUsesProductLink("שלום"), false);

assert.equal(matchQuestionButton(["שחייה", "ריצה"], "שחייה"), 0);
assert.equal(matchQuestionButton(["שחייה", "ריצה"], "  ריצה "), 1);
assert.equal(matchQuestionButton(["שחייה"], "אופניים"), -1);

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
