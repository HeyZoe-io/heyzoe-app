import assert from "node:assert/strict";
import { isJoinSignupIntentText, isWarmupSkipIntentText } from "@/lib/wa-warmup-skip-intent";

type Case = { text: string; phase: "opening" | "warmup" };

const mustSkip: Case[] = [
  { text: "רוצה להירשם", phase: "opening" },
  { text: "איך נרשמים?", phase: "warmup" },
  { text: "בוא נתקדם", phase: "opening" },
  { text: "לא רוצה לענות על שאלות", phase: "warmup" },
  { text: "רק רוצה פרטים", phase: "warmup" },
  { text: "רוצה אימון ניסיון", phase: "opening" },
  { text: "איך מתחילים?", phase: "warmup" },
];

const mustNotSkip: Case[] = [
  { text: "רוצה להתחיל", phase: "opening" },
  { text: "איך מתחילים?", phase: "opening" },
  { text: "כמה עולה להירשם?", phase: "warmup" },
  { text: "יש לי שאלה", phase: "warmup" },
  { text: "כמה עולה?", phase: "opening" },
  { text: "מתי יש שיעורים?", phase: "warmup" },
];

for (const { text, phase } of mustSkip) {
  assert.equal(
    isWarmupSkipIntentText(text, phase),
    true,
    `expected skip: "${text}" (${phase})`
  );
}

for (const { text, phase } of mustNotSkip) {
  assert.equal(
    isWarmupSkipIntentText(text, phase),
    false,
    `expected no skip: "${text}" (${phase})`
  );
}

assert.equal(isJoinSignupIntentText("איך מתחילים?"), true, "CTA join: איך מתחילים");
assert.equal(isJoinSignupIntentText("כמה עולה להירשם?"), false, "CTA join trap: price");

console.log(`wa-warmup-skip-intent: ${mustSkip.length + mustNotSkip.length + 2} assertions passed`);
