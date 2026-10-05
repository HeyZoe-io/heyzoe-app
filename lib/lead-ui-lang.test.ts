import assert from "node:assert/strict";
import type { BusinessKnowledgePack } from "@/lib/business-context";
import {
  detectLeadInboundLanguage,
  inboundIsCatalogServiceName,
  matchesSwitchToRussianIntent,
  resolveLeadContentLanguage,
} from "@/lib/lead-ui-lang";
import { truncateWaButtonLabel } from "@/lib/wa-button-label";

const bodyPumpKnowledge = {
  salesFlowServices: [{ name: "BODY PUMP" }],
  serviceNamesForOpening: ["BODY PUMP", "Reformer Pilates Advanced Level"],
} as unknown as BusinessKnowledgePack;

const shouldMatch = [
  "רוסית?",
  "רוסית",
  "ברוסית",
  "אפשר ברוסית?",
  "אפשר ברוסית",
  "אפשר לכתוב ברוסית",
  "אפשר לדבר ברוסית",
  "אפשר ברוסית בבקשה",
  "נמשיך ברוסית",
  "היי אפשר ברוסית",
  "русская?",
  "русский",
  "можно на русском?",
  "можно по-русски",
  "по-русски",
  "in russian please",
  "russian?",
];
for (const p of shouldMatch) {
  assert.equal(matchesSwitchToRussianIntent(p), true, p);
}

const shouldNotMatch = [
  "יש שיעורים ברוסית?",
  "אפשר פרטים על שיעור ברוסית",
  "אשמח לפרטים",
  "בואו נתחיל",
  "אפשר בעברית?",
  "hebrew?",
  "что у вас по расписанию",
  "Привет, хочу детали",
  "россия",
];
for (const p of shouldNotMatch) {
  assert.equal(matchesSwitchToRussianIntent(p), false, p);
}

assert.equal(resolveLeadContentLanguage({ inboundText: "אפשר ברוסית?", persisted: "he" }), "ru");
assert.equal(resolveLeadContentLanguage({ inboundText: "אשמח לפרטים" }), "he");
assert.equal(resolveLeadContentLanguage({ inboundText: "Привет" }), "ru");
assert.equal(resolveLeadContentLanguage({ inboundText: "Ok I purchased this!" }), "en");
assert.equal(
  resolveLeadContentLanguage({ inboundText: "Thanks for your help !", persisted: "en" }),
  "en"
);

assert.equal(inboundIsCatalogServiceName("BODY PUMP", bodyPumpKnowledge), true);
assert.equal(inboundIsCatalogServiceName("body pump!", bodyPumpKnowledge), true);
assert.equal(inboundIsCatalogServiceName("When is BODY PUMP?", bodyPumpKnowledge), false);
assert.equal(
  inboundIsCatalogServiceName(
    truncateWaButtonLabel("Reformer Pilates Advanced Level"),
    bodyPumpKnowledge
  ),
  true
);
assert.equal(detectLeadInboundLanguage("BODY PUMP", bodyPumpKnowledge), "unknown");
assert.equal(
  resolveLeadContentLanguage({
    inboundText: "BODY PUMP",
    persisted: "he",
    knowledge: bodyPumpKnowledge,
  }),
  "he"
);
assert.equal(
  resolveLeadContentLanguage({
    inboundText: "BODY PUMP",
    knowledge: bodyPumpKnowledge,
  }),
  "he"
);
assert.equal(
  resolveLeadContentLanguage({
    inboundText: "BODY PUMP",
    persisted: "en",
    knowledge: bodyPumpKnowledge,
  }),
  "en"
);
assert.equal(
  resolveLeadContentLanguage({
    inboundText: "When is BODY PUMP?",
    persisted: "he",
    knowledge: bodyPumpKnowledge,
  }),
  "en"
);
assert.equal(
  resolveLeadContentLanguage({
    inboundText: "Hello! Can I get more info on this?",
    persisted: "en",
    slug: "omers-place",
  }),
  "he"
);
assert.equal(
  detectLeadInboundLanguage("Hello! Can I get more info on this?", null, "omers-place"),
  "he"
);
assert.equal(
  resolveLeadContentLanguage({
    inboundText: "Hello! Can I get more info on this?",
    slug: "limitless",
  }),
  "en"
);
assert.equal(
  resolveLeadContentLanguage({
    inboundText: "Hi, can I book a trial class?",
    slug: "omers-place",
  }),
  "en"
);

console.log("lead-ui-lang.test.ts: ok");
