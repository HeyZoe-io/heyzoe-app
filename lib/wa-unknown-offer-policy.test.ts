import assert from "node:assert/strict";
import {
  isIntroPackSplitQuestion,
  knowledgeCoversIntroPackSplit,
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

console.log("wa-unknown-offer-policy.test.ts: ok");
