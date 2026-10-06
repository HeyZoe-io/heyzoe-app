import assert from "node:assert/strict";
import {
  parseConversationMessageContent,
  parseConversationMessageForDashboard,
} from "@/lib/conversation-message-display";
import { stripAssistantInteractiveButtonsLog } from "@/lib/wa-interactive-log";
import { excerptForReactionQuote } from "@/lib/wa-inbound-reaction";

const limitlessFollowup =
  "הולה! זו לימי מLimitless סטודיו 🌟\n\n_לביטול קבלת הודעות שלח *הסר*_\n\n[כפתור תשובה: בואו נתחיל]";

const parsed = parseConversationMessageContent(limitlessFollowup);
assert.equal(parsed.kind, "interactive");
if (parsed.kind === "interactive") {
  assert.equal(parsed.buttons.length, 1);
  assert.equal(parsed.buttons[0]?.label, "בואו נתחיל");
  assert.equal(parsed.buttons[0]?.url, undefined);
  assert.equal(parsed.text.includes("[כפתור"), false);
  assert.match(parsed.text, /הולה!/);
}

const canonical = parseConversationMessageContent("שלום\n\n[כפתור: בואו נתחיל]");
assert.equal(canonical.kind, "interactive");
if (canonical.kind === "interactive") {
  assert.equal(canonical.buttons[0]?.label, "בואו נתחיל");
}

assert.equal(stripAssistantInteractiveButtonsLog(limitlessFollowup).includes("[כפתור"), false);
assert.equal(excerptForReactionQuote(limitlessFollowup).includes("[כפתור"), false);

const spaced = "שורה ראשונה\n\nשורה שנייה  עם רווח";
const beforeFix = parseConversationMessageForDashboard({
  role: "assistant",
  content: spaced,
  createdAt: "2026-10-04T18:06:26.622Z",
  modelUsed: "sales_flow",
});
assert.equal(beforeFix.kind, "text");
if (beforeFix.kind === "text") assert.equal(beforeFix.text, "שורה ראשונה שורה שנייה עם רווח");

const spacesStillCollapsed = parseConversationMessageForDashboard({
  role: "assistant",
  content: spaced,
  createdAt: "2026-10-05T08:00:00.000Z",
  modelUsed: "sales_flow",
});
assert.equal(spacesStillCollapsed.kind, "text");
if (spacesStillCollapsed.kind === "text") {
  assert.equal(spacesStillCollapsed.text, "שורה ראשונה\n\nשורה שנייה עם רווח");
}

const afterFix = parseConversationMessageForDashboard({
  role: "assistant",
  content: spaced,
  createdAt: "2026-10-05T09:00:00.000Z",
  modelUsed: "sales_flow",
});
assert.equal(afterFix.kind, "text");
if (afterFix.kind === "text") assert.equal(afterFix.text, spaced);

const fromApp = parseConversationMessageForDashboard({
  role: "assistant",
  content: spaced,
  createdAt: "2026-10-04T18:06:26.622Z",
  modelUsed: "wa_business_app",
});
assert.equal(fromApp.kind, "text");
if (fromApp.kind === "text") assert.equal(fromApp.text, spaced);

const inbound = parseConversationMessageForDashboard({
  role: "user",
  content: spaced,
  createdAt: "2026-10-04T18:06:26.622Z",
});
assert.equal(inbound.kind, "text");
if (inbound.kind === "text") assert.equal(inbound.text, spaced);

const audioLog = parseConversationMessageContent(
  "[media] https://example.com/storage/recording.m4a"
);
assert.equal(audioLog.kind, "media");
if (audioLog.kind === "media") {
  assert.equal(audioLog.isAudio, true);
  assert.equal(audioLog.isVideo, false);
  assert.equal(audioLog.url, "https://example.com/storage/recording.m4a");
}

console.log("conversation-message-display tests passed");
