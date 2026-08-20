import assert from "node:assert/strict";
import {
  formatKnowledgeQaForPrompt,
  legacyFactsToQaPairs,
  lookupKnowledgeQaAnswerForInbound,
  parseFactLineToQaPair,
  parseKnowledgeQa,
  qaPairToTraitLine,
  relatedPhrasingsForQuestion,
  splitQuestionMatchNotes,
  usesKnowledgeQaDashboard,
} from "@/lib/knowledge-qa";

assert.equal(usesKnowledgeQaDashboard("acrobyjoe"), true);
assert.equal(usesKnowledgeQaDashboard("new-studio"), true);
assert.equal(usesKnowledgeQaDashboard(""), true);
assert.equal(usesKnowledgeQaDashboard("limitless"), true);
assert.equal(usesKnowledgeQaDashboard("Limitless"), true);
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
assert.ok(introVariants.includes("אימון הכרות"));

const hkTypoVariants = relatedPhrasingsForQuestion("אימון הכרות");
assert.ok(hkTypoVariants.includes("אימון ניסיון"));

const prompt = formatKnowledgeQaForPrompt([
  { question: "אימון ניסיון", answer: "עולה 50 ש״ח ונמשך שעה" },
  { question: "", answer: "הסטודיו גדול ומרווח" },
]);
assert.match(prompt, /שאלה\/נושא \(מתי להשתמש\): אימון ניסיון/);
assert.match(prompt, /תשובה בתיבה/);
assert.match(prompt, /עולה 50 ש״ח ונמשך שעה/);
assert.match(prompt, /אימון היכרות/);
assert.match(prompt, /עובדה כללית/);
assert.match(prompt, /הסטודיו גדול ומרווח/);

assert.equal(
  qaPairToTraitLine({ question: "יש מקלחות?", answer: "כן, ולוקרים" }),
  "מקלחות: כן, ולוקרים"
);

const returningQ =
  "הייתי בשיעור ניסיון. אפשר לבוא שוב? (מדובר רק על מי שכבר היה בשיעור בעבר)";
const returningA =
  "היי כיף שאתם רוצים לבוא שוב! אחרי השיעור ניסיון המחיר לשיעור יחיד הוא 150 ולזוג 250";
const joeQa = [
  { question: returningQ, answer: returningA },
  { question: "אימון ניסיון", answer: "כן, יש אימון ניסיון ב־80 ש״ח" },
];

assert.deepEqual(splitQuestionMatchNotes(returningQ).notes, [
  "מדובר רק על מי שכבר היה בשיעור בעבר",
]);
assert.equal(lookupKnowledgeQaAnswerForInbound(joeQa, "יש אימון ניסיון?")?.question, "אימון ניסיון");
assert.equal(lookupKnowledgeQaAnswerForInbound([{ question: returningQ, answer: returningA }], "יש אימון ניסיון?"), null);
assert.equal(
  lookupKnowledgeQaAnswerForInbound(joeQa, "הייתי בשיעור ניסיון")?.question,
  returningQ
);
assert.equal(lookupKnowledgeQaAnswerForInbound(joeQa, "אפשר לבוא שוב?")?.question, returningQ);
assert.equal(lookupKnowledgeQaAnswerForInbound(joeQa, "הייתי רוצה אימון ניסיון")?.question, "אימון ניסיון");

const parenOnlyReturning = {
  question: "שיעור ניסיון (מדובר רק על מי שכבר היה בשיעור בעבר)",
  answer: returningA,
};
assert.equal(lookupKnowledgeQaAnswerForInbound([parenOnlyReturning], "יש אימון ניסיון?"), null);
assert.equal(
  lookupKnowledgeQaAnswerForInbound([parenOnlyReturning], "הייתי אצלכם בשיעור ניסיון")?.question,
  parenOnlyReturning.question
);

console.log("knowledge-qa tests ok");
