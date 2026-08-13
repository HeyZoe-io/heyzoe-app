import assert from "node:assert/strict";
import {
  inferMarketingFlowButtonFromFreeText,
  marketingFlowUserTextLooksLikeQuestion,
} from "@/lib/marketing-flow-answer-infer";

const gymQuestion = "אבל רגע שלא נבזבז לך את הזמן…יש לך סטודיו\\חדר כושר?";
const gymButtons = ["כן!", "אני כאן לכיף", "יש עסק אחר"];

function infer(userText: string): string | null {
  return inferMarketingFlowButtonFromFreeText({
    questionText: gymQuestion,
    buttons: gymButtons,
    userText,
  });
}

assert.equal(infer("חדר כושר"), "כן!", "gym echo → yes");
assert.equal(infer("סטודיו"), "כן!", "studio echo → yes");
assert.equal(infer("יש לי חדר כושר"), "כן!", "I have a gym → yes");
assert.equal(infer("יש לי סטודיו"), "כן!", "I have a studio → yes");
assert.equal(infer("כן"), "כן!", "yes without bang");
assert.equal(infer("כן!"), "כן!", "exact yes");
assert.equal(infer("אני כאן לכיף"), "אני כאן לכיף", "exact fun button");
assert.equal(infer("מספרה"), "יש עסק אחר", "off-niche → other business");

assert.equal(infer("כמה זה עולה?"), null, "price question stays open");
assert.equal(infer("מה ההבדל מבוט אחר?"), null, "product question stays open");
assert.equal(infer("איך זה עובד"), null, "how-it-works stays open");
assert.equal(infer("אני פשוט מעדיפה לדבר בפון"), null, "phone request stays open");

assert.equal(marketingFlowUserTextLooksLikeQuestion("כמה זה עולה?"), true);
assert.equal(marketingFlowUserTextLooksLikeQuestion("חדר כושר"), false);

console.log("marketing-flow-answer-infer: assertions passed");
