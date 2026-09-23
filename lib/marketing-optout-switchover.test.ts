import assert from "node:assert/strict";
import { originalTemplateName } from "@/lib/marketing-optout-resubmit-plan";
import { parseTemplateCategoryUpdate } from "@/lib/marketing-optout-switchover";
import { shouldSuppressLeadTemplate } from "@/lib/wa-marketing-opt-out";

assert.equal(originalTemplateName("sessions_expiring_v2"), "sessions_expiring");
assert.equal(originalTemplateName("quota_warning_80"), null);
assert.equal(originalTemplateName("hello_v12"), "hello");

{
  const event = parseTemplateCategoryUpdate({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123",
        changes: [
          {
            field: "template_category_update",
            value: {
              message_template_id: "99",
              message_template_name: "freeze_created",
              message_template_language: "he",
              previous_category: "UTILITY",
              new_category: "MARKETING",
            },
          },
        ],
      },
    ],
  });
  assert.equal(event?.new_category, "MARKETING");
  assert.equal(event?.message_template_name, "freeze_created");
}

assert.equal(
  shouldSuppressLeadTemplate({ category: "MARKETING", optedOut: false, marketingOptedOut: true }),
  true
);
assert.equal(
  shouldSuppressLeadTemplate({ category: "UTILITY", optedOut: false, marketingOptedOut: true }),
  false
);

console.log("marketing-optout-switchover.test.ts: ok");
