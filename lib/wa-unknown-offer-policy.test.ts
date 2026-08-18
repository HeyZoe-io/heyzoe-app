import assert from "node:assert/strict";
import {
  isIntroPackSplitQuestion,
  knowledgeCoversIntroPackSplit,
  sfServiceOfferPolicyBlob,
  shouldHandoffUnknownIntroPackSplit,
} from "@/lib/wa-unknown-offer-policy";

assert.equal(isIntroPackSplitQuestion("מה הכוונה שני אימוני היכרות? אפשר אחד?"), true);
assert.equal(isIntroPackSplitQuestion("אפשר רק שיעור אחד?"), true);
assert.equal(isIntroPackSplitQuestion("אפשר לקנות אחד בלי השני"), true);
assert.equal(isIntroPackSplitQuestion("מתי השיעור?"), false);
assert.equal(isIntroPackSplitQuestion("כמה עולה?"), false);

assert.equal(
  knowledgeCoversIntroPackSplit(["80 ₪ לשני שיעורי היכרות"]),
  false,
  "package price is not permission to buy one"
);

assert.equal(
  knowledgeCoversIntroPackSplit(["אפשר לרכוש שיעור היכרות אחד בתיאום"]),
  true
);
assert.equal(
  knowledgeCoversIntroPackSplit(["לא ניתן לרכוש רק אחד — חבילה של שני אימונים"]),
  true
);
assert.equal(
  knowledgeCoversIntroPackSplit(["מוביליטי וגמישות: כולל אימון ניסיון אחד"]),
  true,
  "product copy can cover a single trial even without a business fact"
);
assert.equal(
  knowledgeCoversIntroPackSplit(["80 ₪ לשני שיעורי היכרות | תיאור: שיעור היכרות בקבוצה קטנה"]),
  false,
  "product pack price + generic description is not coverage"
);

assert.equal(
  shouldHandoffUnknownIntroPackSplit({
    text: "מה הכוונה שני אימוני היכרות? אפשר אחד?",
    knowledgeBlobs: ["80 ₪ לשני שיעורי היכרות", "קבוצות קטנות"],
  }),
  true
);
assert.equal(
  shouldHandoffUnknownIntroPackSplit({
    text: "מה הכוונה שני אימוני היכרות? אפשר אחד?",
    knowledgeBlobs: ["אי אפשר לקנות שיעור אחד — רק שני אימוני היכרות"],
  }),
  false
);
assert.equal(
  shouldHandoffUnknownIntroPackSplit({
    text: "אפשר אחד?",
    knowledgeBlobs: [
      "80 ₪ לשני שיעורי היכרות",
      sfServiceOfferPolicyBlob({
        name: "מוביליטי וגמישות",
        priceText: "80 ₪ לשני שיעורי היכרות",
        benefit: "",
        descriptionText: "אפשר גם אימון ניסיון אחד בתיאום עם הצוות",
      }),
    ],
  }),
  false,
  "explicit product description should answer without handoff"
);

console.log("wa-unknown-offer-policy.test.ts: ok");
