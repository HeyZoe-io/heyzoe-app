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

console.log("wa-assistant-reply-fixes.test.ts: ok");
