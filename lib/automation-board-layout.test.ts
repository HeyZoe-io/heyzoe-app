import assert from "node:assert/strict";
import {
  groupTemplatesForBoard,
  groupTriggersByType,
  interleaveTriggersAndTemplates,
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
  templateAutomationGroupKey({ name: "not_registered_after_trial2", category: "MARKETING" }, []),
  "type:not_registered_after_trial"
);
assert.equal(
  templateAutomationGroupKey(
    { name: "custom_promo", category: "MARKETING" },
    [{ trigger_type: "purchase", template_name: "custom_promo" }]
  ),
  "type:purchase"
);
assert.equal(
  templateAutomationGroupKey({ name: "summer_sale", category: "MARKETING" }, []),
  "category:MARKETING"
);

const triggerGroups = groupTriggersByType([
  { trigger_type: "birthday", template_name: "birthday_wish", created_at: "2026-02-01" },
  { trigger_type: "purchase", template_name: "purchase_thanks", created_at: "2026-01-01" },
  { trigger_type: "site_lead", template_name: "incoming_lead", created_at: "2026-03-01" },
  { trigger_type: "birthday", template_name: "birthday_wish2", created_at: "2026-01-15" },
]);
assert.deepEqual(
  triggerGroups.map((group) => group.type),
  ["incoming_lead", "purchase", "birthday"]
);
assert.deepEqual(
  triggerGroups.find((group) => group.type === "birthday")?.triggers.map((row) => row.created_at),
  ["2026-01-15", "2026-02-01"]
);

const templateGroups = groupTemplatesForBoard(
  [
    { name: "summer_sale", category: "MARKETING" },
    { name: "birthday_wish2", category: "MARKETING" },
    { name: "birthday_wish", category: "MARKETING" },
    { name: "purchase_thanks", category: "UTILITY" },
  ],
  []
);
assert.deepEqual(
  templateGroups.map((group) => [group.key, group.items.map((item) => item.name)]),
  [
    ["type:purchase", ["purchase_thanks"]],
    ["type:birthday", ["birthday_wish2", "birthday_wish"]],
    ["category:MARKETING", ["summer_sale"]],
  ]
);

const paired = interleaveTriggersAndTemplates(
  [
    { template_name: "birthday_wish" },
    { template_name: "birthday_wish" },
    { template_name: "birthday_wish2" },
  ],
  [{ name: "birthday_wish" }, { name: "birthday_wish2" }, { name: "birthday_extra" }]
);
assert.deepEqual(
  paired.map((item) => (item.kind === "trigger" ? "trigger" : item.template.name)),
  ["trigger", "birthday_wish", "trigger", "trigger", "birthday_wish2", "birthday_extra"]
);

console.log("automation-board-layout.test.ts: ok");
