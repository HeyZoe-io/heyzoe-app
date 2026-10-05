import assert from "node:assert/strict";
import {
  stackSameType,
  templateAutomationGroupKey,
} from "@/lib/automation-board-layout";

assert.equal(
  templateAutomationGroupKey({ name: "birthday_wish2", category: "MARKETING" }, []),
  "type:birthday"
);
assert.equal(
  templateAutomationGroupKey({ name: "birthday_former_wish", category: "MARKETING" }, []),
  "type:birthday_former"
);
assert.equal(
  templateAutomationGroupKey(
    { name: "custom_promo", category: "MARKETING" },
    [{ trigger_type: "purchase", template_name: "custom_promo" }]
  ),
  "type:purchase"
);

const stackedTemplates = stackSameType(
  [
    { name: "summer_sale", category: "MARKETING" },
    { name: "birthday_wish", category: "MARKETING" },
    { name: "purchase_thanks", category: "UTILITY" },
    { name: "birthday_wish2", category: "MARKETING" },
  ],
  (template) => templateAutomationGroupKey(template, [])
);
assert.deepEqual(
  stackedTemplates.map((template) => template.name),
  ["summer_sale", "birthday_wish", "birthday_wish2", "purchase_thanks"]
);

const stackedTriggers = stackSameType(
  [
    { trigger_type: "birthday", created_at: "1" },
    { trigger_type: "purchase", created_at: "2" },
    { trigger_type: "site_lead", created_at: "3" },
    { trigger_type: "birthday", created_at: "4" },
    { trigger_type: "incoming_lead", created_at: "5" },
  ],
  (trigger) =>
    trigger.trigger_type === "site_lead" || trigger.trigger_type === "incoming_lead"
      ? "incoming_lead"
      : trigger.trigger_type
);
assert.deepEqual(
  stackedTriggers.map((trigger) => trigger.created_at),
  ["1", "4", "2", "3", "5"]
);

console.log("automation-board-layout.test.ts: ok");
