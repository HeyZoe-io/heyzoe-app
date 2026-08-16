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

const normal = applyKnownAssistantReplyFixes("השיעורים אצלנו קטנים ואינטימיים, ויש יחס אישי.", { knowledge });
assert.match(normal, /השיעורים אצלנו/);

console.log("wa-assistant-reply-fixes.test.ts: ok");
