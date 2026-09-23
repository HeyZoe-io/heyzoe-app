import assert from "node:assert/strict";
import {
  classifyMarketingOptOutTemplate,
  estimatedDurationMs,
  nextVersionTemplateName,
  OPTOUT_RESUBMIT_THROTTLE_MS,
  plannedWriteCalls,
} from "@/lib/marketing-optout-resubmit-plan";
import { MARKETING_OPT_OUT_BUTTON_HE } from "@/lib/meta-marketing-opt-out-button";

const body = [{ type: "BODY", text: "היי" }];

{
  const item = classifyMarketingOptOutTemplate({
    template: { name: "hello", language: "he", status: "APPROVED", category: "MARKETING", components: body },
    inUse: false,
    takenNames: new Set(),
    allOnWaba: [],
  });
  assert.equal(item.class, "EDIT_IN_PLACE");
}

{
  const item = classifyMarketingOptOutTemplate({
    template: { name: "hello", language: "he", status: "APPROVED", category: "MARKETING", components: body },
    inUse: true,
    takenNames: new Set(["hello_v2"]),
    allOnWaba: [],
  });
  assert.equal(item.class, "NEW_VERSION");
  assert.equal(item.planned_name, "hello_v3");
}

{
  const item = classifyMarketingOptOutTemplate({
    template: { name: "hello", language: "he", status: "PENDING", category: "MARKETING", components: body },
    inUse: true,
    takenNames: new Set(),
    allOnWaba: [],
  });
  assert.equal(item.class, "DEFERRED");
}

{
  const full = Array.from({ length: 10 }, (_, i) => ({ type: "QUICK_REPLY", text: `b${i}` }));
  const item = classifyMarketingOptOutTemplate({
    template: {
      name: "full",
      language: "he",
      status: "APPROVED",
      category: "MARKETING",
      components: [{ type: "BUTTONS", buttons: full }],
    },
    inUse: false,
    takenNames: new Set(),
    allOnWaba: [],
  });
  assert.equal(item.class, "MANUAL");
}

{
  const item = classifyMarketingOptOutTemplate({
    template: {
      name: "done",
      language: "he",
      status: "APPROVED",
      category: "MARKETING",
      components: [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: MARKETING_OPT_OUT_BUTTON_HE }] }],
    },
    inUse: true,
    takenNames: new Set(),
    allOnWaba: [],
  });
  assert.equal(item.class, "SKIP_HAS_BUTTON");
}

{
  const versioned = {
    name: "hello_v2",
    language: "he",
    status: "PENDING",
    category: "MARKETING",
    components: [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: MARKETING_OPT_OUT_BUTTON_HE }] }],
  };
  const item = classifyMarketingOptOutTemplate({
    template: { name: "hello", language: "he", status: "APPROVED", category: "MARKETING", components: body },
    inUse: true,
    takenNames: new Set(["hello_v2"]),
    allOnWaba: [versioned],
  });
  assert.equal(item.class, "SKIP_HAS_VERSION");
  assert.equal(item.planned_name, "hello_v2");
}

{
  const item = classifyMarketingOptOutTemplate({
    template: {
      name: "quota_warning_80",
      language: "he",
      status: "APPROVED",
      category: "MARKETING",
      components: body,
    },
    inUse: true,
    takenNames: new Set(),
    allOnWaba: [],
  });
  assert.equal(item.class, "EXCLUDED_ACCOUNT_ALERT");
}

assert.equal(nextVersionTemplateName("a", new Set()), "a_v2");
assert.equal(plannedWriteCalls([{ class: "EDIT_IN_PLACE" }, { class: "DEFERRED" }, { class: "NEW_VERSION" }] as never), 2);
assert.equal(estimatedDurationMs([1, 4]), 4 * OPTOUT_RESUBMIT_THROTTLE_MS);

console.log("marketing-optout-resubmit-plan.test.ts: ok");
