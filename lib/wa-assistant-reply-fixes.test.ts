import assert from "node:assert/strict";
import { applyKnownAssistantReplyFixes } from "@/lib/wa-assistant-reply-fixes";
import type { BusinessKnowledgePack } from "@/lib/business-context";

const knowledge = {
  serviceNamesForOpening: ["שיעור יוגה למתחילים", "שיעור יוגה ממשיכים", "שיעור יוגה למתקדמים"],
  salesFlowServices: [{ name: "יוגה לכל הרמות" }],
} as Pick<BusinessKnowledgePack, "serviceNamesForOpening" | "salesFlowServices"> as BusinessKnowledgePack;

const input =
  "יש לנו שיעורים למתחילים, ממשיקים, מתקדמים, יוגה לכל הרמות ויוגה לנשים.";

const fixed = applyKnownAssistantReplyFixes(input, { knowledge });

assert.match(fixed, /ממשיכים/);
assert.doesNotMatch(fixed, /ממשיקים/);

const leaked =
  "הבנתי! 😊 אתה צודק - אני לא מנהלת הגדרות או כיבויים של בוט. אלה פעולות שמנוהלות דרך **דף השיחות** בפלטפורמה, לא כאן בצ'אט. אם אתה צריך:\n- **לכבות בוט על מספר ספציפי** → דף השיחות → בחר את השיחה → הגדרות";
const scrubbed = applyKnownAssistantReplyFixes(leaked, { knowledge });
assert.doesNotMatch(scrubbed, /דף השיחות|כיבוי|HeyZoe|דשבורד/i);
assert.match(scrubbed, /השירותים שלנו/);

const scheduleKeep = [
  "אפשר לראות את מערכת השעות כאן: https://arbox.example.com/schedule",
  "הלוח המלא בלינק למערכת שעות, ואפשר גם להירשם משם לשיעור ניסיון.",
  "מחירי המנויים מופיעים בדשבורד של האפליקציה אצלכם באפליקציית הסטודיו.",
  "זה סטודיו בוטיק, השיעורים קטנים.",
  "אני זואי, נציגת הסטודיו. במה אפשר לעזור?",
  "הגדרות השיעור למתחילים: להביא מזרן ומים.",
].map((t) => applyKnownAssistantReplyFixes(t, { knowledge }));
assert.match(scheduleKeep[0], /מערכת השעות/);
assert.match(scheduleKeep[0], /arbox\.example\.com/);
assert.match(scheduleKeep[1], /מערכת שעות/);
assert.match(scheduleKeep[2], /דשבורד של האפליקציה/);
assert.match(scheduleKeep[3], /בוטיק/);
assert.match(scheduleKeep[4], /אני זואי/);
assert.match(scheduleKeep[5], /הגדרות השיעור/);

const mixed =
  "אפשר לראות את מערכת השעות כאן: https://arbox.example.com/schedule\nלכבות בוט זה דרך דף השיחות.";
const mixedFixed = applyKnownAssistantReplyFixes(mixed, { knowledge });
assert.match(mixedFixed, /מערכת השעות/);
assert.match(mixedFixed, /arbox\.example\.com/);
assert.doesNotMatch(mixedFixed, /דף השיחות|לכבות בוט/);

const normal = applyKnownAssistantReplyFixes("השיעורים אצלנו קטנים ואינטימיים, ויש יחס אישי.", { knowledge });
assert.match(normal, /השיעורים אצלנו/);

console.log("wa-assistant-reply-fixes.test.ts: ok");
