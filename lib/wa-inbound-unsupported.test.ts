import assert from "node:assert/strict";
import { parseMetaWebhook, parseSmbMessageEchoes } from "@/lib/whatsapp";
import { parseConversationMessageContent } from "@/lib/conversation-message-display";
import {
  renderWhatsAppTemplatePreview,
  zoeAdminTemplateNameFromPlaceholder,
} from "@/lib/wa-zoe-admin-template-log";
import {
  digitsForMarketingLineCompare,
  formatWaUnsupportedLogContent,
  hebrewUnsupportedInboundLabel,
  isSystemInboundLogContent,
  isZoeAdminWhatsAppPhone,
  parseWaUnsupportedKind,
  unsupportedInboundPreviewShouldProcessAsText,
} from "@/lib/wa-inbound-unsupported";

assert.equal(digitsForMarketingLineCompare("+972 3-382-4981"), "97233824981");
assert.equal(digitsForMarketingLineCompare("033824981"), "97233824981");
assert.equal(isZoeAdminWhatsAppPhone("+97233824981"), true);
assert.equal(isZoeAdminWhatsAppPhone("972501234567"), false);

assert.equal(
  unsupportedInboundPreviewShouldProcessAsText({
    from: "972587715716",
    metaInboundType: "unsupported",
    previewText: "היי מה נשמע? אני מנסה  להירשם לשיעור שבוע הבא ולא נותן לי",
  }),
  "היי מה נשמע? אני מנסה  להירשם לשיעור שבוע הבא ולא נותן לי"
);
assert.equal(
  unsupportedInboundPreviewShouldProcessAsText({
    from: "+97233824981",
    metaInboundType: "hsm",
    previewText: "היי אלין, יש ליד חדש",
  }),
  null
);
assert.equal(
  unsupportedInboundPreviewShouldProcessAsText({
    from: "972587715716",
    metaInboundType: "image",
    previewText: "כיתוב על תמונה",
  }),
  null
);
assert.equal(
  unsupportedInboundPreviewShouldProcessAsText({
    from: "972587715716",
    metaInboundType: "unsupported",
    previewText: "",
  }),
  null
);

assert.equal(isSystemInboundLogContent("[unsupported] edit"), true);
assert.equal(isSystemInboundLogContent("[reaction] ❤️"), true);
assert.equal(isSystemInboundLogContent("תמחקו אותי מהשיעור"), false);

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

assert.equal(zoeAdminTemplateNameFromPlaceholder("הודעת תבנית (feature_class_cancelled_notify)"), "feature_class_cancelled_notify");
assert.equal(
  zoeAdminTemplateNameFromPlaceholder("הודעת תבנית (human_agent_request)\n\n0524677850\n27/09/2026 16:45"),
  "human_agent_request"
);
assert.equal(zoeAdminTemplateNameFromPlaceholder("היי, ביטול שיעור זמין עכשיו"), null);

const featurePreview = renderWhatsAppTemplatePreview({
  templateName: "feature_class_cancelled_notify",
  metaComponents: [
    {
      type: "BODY",
      text: "היי, פיצ'ר חדש: כששיעור מתבטל זואי שולחת הודעה לנרשמים.",
    },
  ],
});
assert.equal(featurePreview.includes("פיצ'ר חדש"), true);
assert.equal(zoeAdminTemplateNameFromPlaceholder(featurePreview), null);

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

const parsedRevoke = parseMetaWebhook({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "1234567890" },
            messages: [
              {
                from: "972501234567",
                id: "wamid.REVOKE1",
                type: "revoke",
                revoke: { original_message_id: "wamid.ORIG1" },
              },
            ],
          },
        },
      ],
    },
  ],
});
assert.equal(parsedRevoke?.type, "unsupported");
if (parsedRevoke?.type === "unsupported") {
  assert.equal(parsedRevoke.metaInboundType, "revoke");
  assert.equal(parsedRevoke.revokeOriginalMessageId, "wamid.ORIG1");
}
assert.equal(
  unsupportedInboundPreviewShouldProcessAsText({
    from: "972501234567",
    metaInboundType: "revoke",
    previewText: "שלום",
  }),
  null
);
assert.equal(isSystemInboundLogContent("[revoke]"), true);

const echoes = parseSmbMessageEchoes({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "smb_message_echoes",
          value: {
            metadata: { phone_number_id: "1234567890" },
            message_echoes: [
              {
                id: "wamid.REVOKEECHO",
                to: "972501234567",
                type: "revoke",
                revoke: { original_message_id: "wamid.ORIG2" },
              },
            ],
          },
        },
      ],
    },
  ],
});
assert.equal(echoes.length, 1);
assert.equal(echoes[0]?.text, "[revoke]");
assert.equal(echoes[0]?.revokeOriginalMessageId, "wamid.ORIG2");

console.log("wa-inbound-unsupported.test.ts: ok");
