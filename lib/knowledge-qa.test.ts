import assert from "node:assert/strict";
import {
  formatKnowledgeQaForPrompt,
  legacyFactsToQaPairs,
  parseFactLineToQaPair,
  parseKnowledgeQa,
  qaPairToTraitLine,
  relatedPhrasingsForQuestion,
  usesKnowledgeQaDashboard,
} from "@/lib/knowledge-qa";

assert.equal(usesKnowledgeQaDashboard("acrobyjoe"), true);
assert.equal(usesKnowledgeQaDashboard("new-studio"), true);
assert.equal(usesKnowledgeQaDashboard(""), true);
assert.equal(usesKnowledgeQaDashboard("limitless"), false);
assert.equal(usesKnowledgeQaDashboard("Limitless"), false);
assert.equal(usesKnowledgeQaDashboard("info-2815"), false);

assert.deepEqual(parseKnowledgeQa([{ question: " אימון ניסיון ", answer: " 50 ש״ח " }]), [
  { question: "אימון ניסיון", answer: "50 ש״ח" },
]);
assert.deepEqual(parseKnowledgeQa([{ q: "חניה", a: "כחול לבן" }]), [
  { question: "חניה", answer: "כחול לבן" },
]);
assert.deepEqual(parseKnowledgeQa([{ question: "", answer: "" }]), []);

assert.deepEqual(parseFactLineToQaPair("לאילו גילאים זה מתאים? מגיל 16"), {
  question: "לאילו גילאים זה מתאים?",
  answer: "מגיל 16",
});
assert.deepEqual(parseFactLineToQaPair("שיעורים לכל הרמות"), {
  question: "",
  answer: "שיעורים לכל הרמות",
});

const migrated = legacyFactsToQaPairs([
  "שיעורים לכל הרמות",
  "יש חניה? כן, כחול-לבן",
]);
assert.equal(migrated.length, 2);
assert.equal(migrated[0]?.answer, "שיעורים לכל הרמות");
assert.equal(migrated[1]?.question, "יש חניה?");
assert.equal(migrated[1]?.answer, "כן, כחול-לבן");

const trialVariants = relatedPhrasingsForQuestion("אימון ניסיון");
assert.ok(trialVariants.includes("אימון היכרות"), `expected intro synonym, got ${trialVariants.join(", ")}`);
assert.ok(trialVariants.includes("שיעור ניסיון"));
assert.ok(trialVariants.some((v) => /trial/i.test(v)));

const introVariants = relatedPhrasingsForQuestion("אימון היכרות");
assert.ok(introVariants.includes("אימון ניסיון"));

const prompt = formatKnowledgeQaForPrompt([
  { question: "אימון ניסיון", answer: "עולה 50 ש״ח ונמשך שעה" },
  { question: "", answer: "הסטודיו גדול ומרווח" },
]);
assert.match(prompt, /שאלה\/נושא \(מתי להשתמש\): אימון ניסיון/);
assert.match(prompt, /תשובה לליד \(מה להגיד\): עולה 50 ש״ח ונמשך שעה/);
assert.match(prompt, /אימון היכרות/);
assert.match(prompt, /עובדה כללית/);
assert.match(prompt, /הסטודיו גדול ומרווח/);

assert.equal(
  qaPairToTraitLine({ question: "יש מקלחות?", answer: "כן, ולוקרים" }),
  "מקלחות: כן, ולוקרים"
);

console.log("knowledge-qa tests ok");
