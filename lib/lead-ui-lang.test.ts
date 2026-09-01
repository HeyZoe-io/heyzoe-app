import assert from "node:assert/strict";
import { matchesSwitchToRussianIntent, resolveLeadContentLanguage } from "@/lib/lead-ui-lang";

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

console.log("lead-ui-lang.test.ts: ok");
