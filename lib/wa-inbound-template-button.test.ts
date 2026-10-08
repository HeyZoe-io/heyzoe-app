import assert from "node:assert/strict";
import { parseMetaWebhook } from "@/lib/whatsapp";
import { isMetaInteractiveMenuReply, isSalesFlowFreeTextInbound } from "@/lib/sales-flow-inbound";
import { resolveSendBeforeClaudeReason } from "@/lib/wa-send-before-claude";

function metaPayload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "1234567890" },
              contacts: [{ profile: { name: "Dana" } }],
              messages: [{ from: "972501234567", id: "wamid.IN1", ...message }],
            },
          },
        ],
      },
    ],
  };
}

const templateClick = parseMetaWebhook(
  metaPayload({
    type: "button",
    button: { text: "נציג אנושי", payload: "נציג אנושי" },
    context: { id: "wamid.TEMPLATE1" },
  })
);
assert.equal(templateClick?.type, "text");
if (templateClick?.type === "text") {
  assert.equal(templateClick.text, "נציג אנושי");
  assert.equal(templateClick.metaInteractiveReplyKind, "template_button");
  assert.equal(templateClick.replyToWamid, "wamid.TEMPLATE1");
  assert.equal(isMetaInteractiveMenuReply(templateClick), false);
  assert.equal(isSalesFlowFreeTextInbound(templateClick), true);
  assert.equal(
    resolveSendBeforeClaudeReason({
      text: templateClick.text,
      interactiveId: templateClick.metaInteractiveReplyId,
      interactiveKind: templateClick.metaInteractiveReplyKind,
      openingTrigger: false,
      matchesMenuLabel: false,
      warmupOption: false,
    }),
    "explicit_human_request"
  );
}

const menuClick = parseMetaWebhook(
  metaPayload({
    type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: "opt_1", title: "פילאטיס" } },
  })
);
assert.equal(menuClick?.type, "text");
if (menuClick?.type === "text") {
  assert.equal(menuClick.metaInteractiveReplyKind, "button_reply");
  assert.equal(isMetaInteractiveMenuReply(menuClick), true);
}

console.log("wa-inbound-template-button.test.ts: ok");
