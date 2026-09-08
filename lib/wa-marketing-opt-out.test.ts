import assert from "node:assert/strict";
import { parseMetaWebhook } from "@/lib/whatsapp";
import {
  contactBlocksMarketingBulk,
  extractMetaErrorCode,
  isMarketingOptOutErrorCode,
  isMarketingTemplateCategory,
  MARKETING_OPT_OUT_ERROR_CODE,
  parseMarketingOptOutStatuses,
  parseUserPreferencesWebhook,
  shouldSuppressLeadTemplate,
  shouldSuppressSessionMessage,
  SUPPRESSED_OPT_OUT_ERROR,
} from "@/lib/wa-marketing-opt-out";

{
  assert.equal(isMarketingOptOutErrorCode(131050), true);
  assert.equal(isMarketingOptOutErrorCode("131050"), true);
  assert.equal(isMarketingOptOutErrorCode(131049), false);
  assert.equal(MARKETING_OPT_OUT_ERROR_CODE, 131050);
}

{
  assert.equal(
    extractMetaErrorCode({
      error: { message: "Unable to deliver", code: 131050, type: "OAuthException" },
    }),
    131050
  );
  assert.equal(
    extractMetaErrorCode(
      JSON.stringify({ error: { code: 131050, error_data: { details: "stopped" } } })
    ),
    131050
  );
  assert.equal(extractMetaErrorCode("(#131050) Unable to deliver the message."), 131050);
  assert.equal(extractMetaErrorCode({ error: { code: 131026 } }), 131026);
  assert.equal(isMarketingOptOutErrorCode(extractMetaErrorCode({ error: { code: 131026 } })), false);
}

{
  const stopPayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "user_preferences",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "106540352242922" },
              contacts: [{ wa_id: "972501234567" }],
              user_preferences: [
                {
                  wa_id: "972501234567",
                  detail: "User requested to stop marketing messages",
                  category: "marketing_messages",
                  value: "stop",
                  timestamp: 1731705721,
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const stop = parseUserPreferencesWebhook(stopPayload);
  assert.equal(stop.length, 1);
  assert.equal(stop[0]?.preference, "stop");
  assert.equal(stop[0]?.phoneNumberId, "106540352242922");
  assert.equal(stop[0]?.waId, "972501234567");
  assert.equal(parseMetaWebhook(stopPayload), null, "user_preferences is not an inbound message");

  const resume = parseUserPreferencesWebhook({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "user_preferences",
            value: {
              metadata: { phone_number_id: "1" },
              user_preferences: [{ category: "marketing_messages", value: "resume", wa_id: "972509999999" }],
            },
          },
        ],
      },
    ],
  });
  assert.equal(resume[0]?.preference, "resume");
  assert.equal(resume[0]?.waId, "972509999999");
}

{
  const noWaId = parseUserPreferencesWebhook({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "user_preferences",
            value: {
              metadata: { phone_number_id: "1" },
              contacts: [{}],
              user_preferences: [{ category: "marketing_messages", value: "stop" }],
            },
          },
        ],
      },
    ],
  });
  assert.equal(noWaId.length, 1);
  assert.equal(noWaId[0]?.waId, "");

  const fallbackWa = parseUserPreferencesWebhook({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "user_preferences",
            value: {
              metadata: { phone_number_id: "9" },
              contacts: [{ wa_id: "972508888888" }],
              user_preferences: [{ category: "marketing_messages", value: "stop" }],
            },
          },
        ],
      },
    ],
  });
  assert.equal(fallbackWa[0]?.waId, "972508888888");
}

{
  assert.deepEqual(
    parseUserPreferencesWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { messages: [{ type: "text" }] } }] }],
    }),
    []
  );
}

{
  const statuses = parseMarketingOptOutStatuses({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "555" },
              statuses: [
                {
                  recipient_id: "972501111111",
                  status: "failed",
                  errors: [{ code: 131050, title: "Unable to deliver" }],
                },
                {
                  recipient_id: "972502222222",
                  status: "failed",
                  errors: [{ code: 131049, title: "frequency" }],
                },
                {
                  recipient_id: "972503333333",
                  status: "delivered",
                  errors: [{ code: 131050 }],
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0]?.phoneNumberId, "555");
  assert.equal(statuses[0]?.recipientPhone, "972501111111");
}

{
  assert.equal(contactBlocksMarketingBulk({ opted_out: true, marketing_opted_out: false }), true);
  assert.equal(contactBlocksMarketingBulk({ opted_out: false, marketing_opted_out: true }), true);
  assert.equal(contactBlocksMarketingBulk({ opted_out: false, marketing_opted_out: false }), false);
  assert.equal(contactBlocksMarketingBulk({ opted_out: null, marketing_opted_out: null }), false);
}

{
  assert.equal(isMarketingTemplateCategory(""), true);
  assert.equal(isMarketingTemplateCategory(null), true);
  assert.equal(isMarketingTemplateCategory("MARKETING"), true);
  assert.equal(isMarketingTemplateCategory("marketing"), true);
  assert.equal(isMarketingTemplateCategory("UTILITY"), false);
  assert.equal(isMarketingTemplateCategory("AUTHENTICATION"), false);

  assert.equal(
    shouldSuppressLeadTemplate({ category: "MARKETING", optedOut: true, marketingOptedOut: false }),
    true
  );
  assert.equal(
    shouldSuppressLeadTemplate({ category: "UTILITY", optedOut: true, marketingOptedOut: false }),
    true
  );
  assert.equal(
    shouldSuppressLeadTemplate({ category: "AUTHENTICATION", optedOut: true, marketingOptedOut: false }),
    true
  );
  assert.equal(
    shouldSuppressLeadTemplate({ category: "MARKETING", optedOut: false, marketingOptedOut: true }),
    true
  );
  assert.equal(
    shouldSuppressLeadTemplate({ category: "", optedOut: false, marketingOptedOut: true }),
    true
  );
  assert.equal(
    shouldSuppressLeadTemplate({ category: null, optedOut: false, marketingOptedOut: true }),
    true
  );
  assert.equal(
    shouldSuppressLeadTemplate({ category: "UTILITY", optedOut: false, marketingOptedOut: true }),
    false
  );
  assert.equal(
    shouldSuppressLeadTemplate({
      category: "AUTHENTICATION",
      optedOut: false,
      marketingOptedOut: true,
    }),
    false
  );
  assert.equal(
    shouldSuppressLeadTemplate({ category: "MARKETING", optedOut: false, marketingOptedOut: false }),
    false
  );

  assert.equal(shouldSuppressSessionMessage(true), true);
  assert.equal(shouldSuppressSessionMessage(false), false);
  assert.equal(SUPPRESSED_OPT_OUT_ERROR, "suppressed_opt_out");
}

console.log("wa-marketing-opt-out.test.ts: ok");
