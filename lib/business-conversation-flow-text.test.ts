import assert from "node:assert/strict";
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

console.log("business-conversation-flow-text.test.ts ok");
