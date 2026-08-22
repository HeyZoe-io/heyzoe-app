import assert from "node:assert/strict";
import { defaultSalesFlowConfig, formatSalesFlowForPrompt } from "@/lib/sales-flow";

const cfg = defaultSalesFlowConfig([]);
const names = ["אקרו יוגה", "אקרו יוגה לזוג"];
const benefits = new Map([
  ["אקרו יוגה", "כוח וגמישות"],
  ["אקרו יוגה לזוג", "תרגול זוגי"],
]);

const enabled = formatSalesFlowForPrompt(cfg, names, benefits, "", "", "", {
  warmupSessionEnabled: true,
});
assert.match(enabled, /שאלה:\s*מה בא לך להשיג באימונים אצלנו\?/);
assert.match(enabled, /אפשרויות:.*כוח וחיטוב/);
assert.match(enabled, /הפחתת כאבים/);
assert.match(enabled, /פאן וגיוון באימונים/);
assert.doesNotMatch(enabled, /סשן חימום אינו פעיל/);

const disabled = formatSalesFlowForPrompt(cfg, names, benefits, "", "", "", {
  warmupSessionEnabled: false,
});
assert.match(disabled, /סשן חימום אינו פעיל/);
assert.doesNotMatch(disabled, /שאלה:\s*מה בא לך להשיג באימונים אצלנו\?/);
assert.doesNotMatch(disabled, /אפשרויות:.*כוח וחיטוב/);
assert.doesNotMatch(disabled, /הפחתת כאבים/);
assert.doesNotMatch(disabled, /פאן וגיוון באימונים/);
assert.match(disabled, /אל תסיקי בחירת מוצר משאלה פתוחה/);

const omittedDefaultsToOn = formatSalesFlowForPrompt(cfg, names, benefits);
assert.match(omittedDefaultsToOn, /שאלה:\s*מה בא לך להשיג באימונים אצלנו\?/);

console.log("sales-flow-prompt-warmup.test.ts: ok");
