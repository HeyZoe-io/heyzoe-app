import assert from "node:assert/strict";
import { parseMetaWebhook } from "@/lib/whatsapp";
import { parseConversationMessageContent } from "@/lib/conversation-message-display";
import { renderWhatsAppTemplatePreview } from "@/lib/wa-zoe-admin-template-log";
import {
  digitsForMarketingLineCompare,
  formatWaUnsupportedLogContent,
  hebrewUnsupportedInboundLabel,
  isZoeAdminWhatsAppPhone,
  parseWaUnsupportedKind,
} from "@/lib/wa-inbound-unsupported";

assert.equal(digitsForMarketingLineCompare("+972 3-382-4981"), "97233824981");
assert.equal(digitsForMarketingLineCompare("033824981"), "97233824981");
assert.equal(isZoeAdminWhatsAppPhone("+97233824981"), true);
assert.equal(isZoeAdminWhatsAppPhone("972501234567"), false);

assert.equal(formatWaUnsupportedLogContent("unsupported"), "[unsupported] unsupported");
assert.equal(formatWaUnsupportedLogContent("hsm", "שלום אלין"), "שלום אלין");
assert.equal(parseWaUnsupportedKind("[unsupported] unsupported"), "unsupported");
assert.equal(parseWaUnsupportedKind("[unsupported] hsm"), "hsm");
assert.equal(parseWaUnsupportedKind("שלום"), null);

const parsedUi = parseConversationMessageContent("[unsupported] unsupported");
assert.equal(parsedUi.kind, "unsupported");
if (parsedUi.kind === "unsupported") {
  assert.equal(parsedUi.title, "הודעת תבנית מוואטסאפ");
}

const labels = hebrewUnsupportedInboundLabel("poll");
assert.equal(labels.title, "סקר");

const preview = renderWhatsAppTemplatePreview({
  templateName: "new_lead_notification",
  metaComponents: [
    { type: "BODY", text: "ליד חדש ב{{1}}: {{2}} בשעה {{3}}" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "פתח דשבורד" }] },
  ],
  sendComponents: [
    {
      type: "body",
      parameters: [
        { type: "text", text: "סטודיו אלין" },
        { type: "text", text: "0501234567" },
        { type: "text", text: "15:00" },
      ],
    },
  ],
});
assert.equal(preview.includes("ליד חדש בסטודיו אלין"), true);
assert.equal(preview.includes("[כפתור: פתח דשבורד]"), true);

const parsedUnsupported = parseMetaWebhook({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "1234567890" },
            contacts: [{ profile: { name: "Zoe" } }],
            messages: [
              {
                from: "97233824981",
                id: "wamid.UNSUP1",
                type: "unsupported",
                unsupported: { type: "hsm" },
                errors: [{ code: 131051, title: "Message type unknown" }],
              },
            ],
          },
        },
      ],
    },
  ],
});
assert.equal(parsedUnsupported?.type, "unsupported");
if (parsedUnsupported?.type === "unsupported") {
  assert.equal(parsedUnsupported.metaInboundType, "hsm");
  assert.equal(parsedUnsupported.from, "+97233824981");
}

const parsedWithBody = parseMetaWebhook({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "1234567890" },
            messages: [
              {
                from: "97233824981",
                id: "wamid.UNSUP2",
                type: "unsupported",
                text: { body: "היי אלין, יש ליד חדש" },
              },
            ],
          },
        },
      ],
    },
  ],
});
assert.equal(parsedWithBody?.type, "unsupported");
if (parsedWithBody?.type === "unsupported") {
  assert.equal(parsedWithBody.previewText, "היי אלין, יש ליד חדש");
}

console.log("wa-inbound-unsupported.test.ts: ok");
