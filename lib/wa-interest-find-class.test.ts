import assert from "node:assert/strict";
import { buildReplyRoutePromptBlock } from "@/lib/wa-reply-route";
import {
  FIND_CLASS_ASK_MODEL,
  FIND_CLASS_BRIDGE_HE,
  composeFindClassOffer,
  formatServicePriceDetail,
  inboundHasQuestionBeyondClassInterest,
  isAffirmativeFindClassReply,
  isFindClassBridgeModel,
  isNegativeFindClassReply,
  resolveInterestQuestionAnswer,
  sanitizeFindClassAnswer,
  shouldOfferFindClassBeforeFlow,
} from "@/lib/wa-interest-find-class";

const apex =
  "היי בוקר טוב אני רוצה בלי נדר להתחיל להגיע לשיעורים של חן רציתי לדעת מה העלויות";

assert.equal(inboundHasQuestionBeyondClassInterest(apex), true);
assert.equal(inboundHasQuestionBeyondClassInterest("פרטים?"), false);
assert.equal(inboundHasQuestionBeyondClassInterest("היי אשמח לשמוע מידע"), false);
assert.equal(inboundHasQuestionBeyondClassInterest("אשמח לשמוע על האימונים"), false);
assert.equal(inboundHasQuestionBeyondClassInterest("אשמח לדעת על האימונים"), false);
assert.equal(inboundHasQuestionBeyondClassInterest("כמה עולה?"), true);
assert.equal(inboundHasQuestionBeyondClassInterest("איפה אתם נמצאים?"), true);
assert.equal(inboundHasQuestionBeyondClassInterest("יש חניה?"), true);
assert.equal(inboundHasQuestionBeyondClassInterest("כמה זמן השיעור?"), true);
assert.equal(
  inboundHasQuestionBeyondClassInterest("אשמח לשמוע פרטים על האימונים סוגים משך זמן מחיר ומיקום"),
  true
);
assert.equal(inboundHasQuestionBeyondClassInterest("איך נרשמים לשיעור ניסיון?"), false);
assert.equal(inboundHasQuestionBeyondClassInterest("מה שעות הפתיחה?"), false);

assert.equal(
  shouldOfferFindClassBeforeFlow({ route: "interest", inbound: apex, explicitSignup: true }),
  true
);
assert.equal(
  shouldOfferFindClassBeforeFlow({ route: "interest", inbound: "פרטים", explicitSignup: true }),
  false
);
assert.equal(
  shouldOfferFindClassBeforeFlow({
    route: "signup",
    inbound: "איך נרשמים לשיעור ניסיון?",
    explicitSignup: true,
  }),
  false
);
assert.equal(
  shouldOfferFindClassBeforeFlow({
    route: "signup",
    inbound: "אשמח על פרטים ומה העלות כדי להצטרף",
    explicitSignup: true,
  }),
  true
);
assert.equal(
  shouldOfferFindClassBeforeFlow({ route: "answer", inbound: "כמה עולה?", explicitSignup: false }),
  true
);
assert.equal(
  shouldOfferFindClassBeforeFlow({
    route: "answer",
    inbound: "מה שעות הפתיחה?",
    explicitSignup: false,
  }),
  false
);
assert.equal(
  shouldOfferFindClassBeforeFlow({
    route: "answer",
    inbound: "כמה עולה הכרטיסייה שלי?",
    explicitSignup: false,
  }),
  false
);

assert.equal(isAffirmativeFindClassReply("כן"), true);
assert.equal(isAffirmativeFindClassReply("כן בבקשה"), true);
assert.equal(isAffirmativeFindClassReply("כן, מה לגבי חניה?"), false);
assert.equal(isNegativeFindClassReply("לא תודה"), true);
assert.equal(isNegativeFindClassReply("כן"), false);
assert.equal(isFindClassBridgeModel(`${FIND_CLASS_ASK_MODEL}#route=interest;tag=ok;hint=day_timetable`), true);

const prices = formatServicePriceDetail([
  { name: "יוגה", priceText: "45" },
  { name: "פילאטיס", priceText: "45" },
  { name: "ילדים", priceText: "ללא עלות" },
]);
assert.match(prices, /יוגה, פילאטיס: 45 ₪/);
assert.match(prices, /ילדים: ללא עלות/);

const fromServices = resolveInterestQuestionAnswer({
  inbound: apex,
  claudeBody: "",
  services: [
    { name: "יוגה", priceText: "45" },
    { name: "ילדים", priceText: "ללא עלות" },
  ],
  address: "הרצל 1",
});
assert.match(fromServices, /45 ₪/);
assert.match(fromServices, /ללא עלות/);

const kept = resolveInterestQuestionAnswer({
  inbound: "כמה עולה?",
  claudeBody: "שיעור עולה 80 ₪.",
  services: [{ name: "יוגה", priceText: "45" }],
  address: "",
});
assert.equal(kept, "שיעור עולה 80 ₪.");
assert.doesNotMatch(kept, /45/);

assert.equal(
  sanitizeFindClassAnswer("אנחנו ברחוב הרצל 12.\nהאימון עולה 80 ₪.\n1. הרשמה\nשנשריין לך את האימון?"),
  "אנחנו ברחוב הרצל 12.\nהאימון עולה 80 ₪."
);

const offer = composeFindClassOffer(fromServices, "he");
assert.match(offer, new RegExp(FIND_CLASS_BRIDGE_HE.replace("?", "\\?")));
assert.match(offer, /45 ₪/);

const address = resolveInterestQuestionAnswer({
  inbound: "איפה אתם נמצאים?",
  claudeBody: "",
  services: [],
  address: "יפה נוף 98",
});
assert.match(address, /יפה נוף 98/);

const prompt = buildReplyRoutePromptBlock();
assert.match(prompt, /רוצה שנמצא/);
assert.doesNotMatch(prompt, /כמה עולה\?\" -> \[\[route:interest\]\] והגוף ריק, בלי מחיר/);

console.log("wa-interest-find-class.test.ts: ok");
