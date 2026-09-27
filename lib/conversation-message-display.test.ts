import assert from "node:assert/strict";
import { parseConversationMessageContent } from "@/lib/conversation-message-display";
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

console.log("conversation-message-display tests passed");
