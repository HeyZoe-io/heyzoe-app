import assert from "node:assert/strict";
import {
  isMarketingStatusTriggerColumn,
  marketingStatusEnteredColumn,
} from "@/lib/marketing-status-trigger";

assert.equal(marketingStatusEnteredColumn("in_process", "followup"), "followup");
assert.equal(marketingStatusEnteredColumn("human_followup", "requires_call"), null);
assert.equal(marketingStatusEnteredColumn("followup", "followup"), null);
assert.equal(marketingStatusEnteredColumn(null, "registered"), "registered");
assert.equal(marketingStatusEnteredColumn("in_process", "opted_out"), null);
assert.equal(marketingStatusEnteredColumn("followup", "not_relevant"), "not_relevant");
assert.equal(marketingStatusEnteredColumn("active", "in_process"), null);
assert.equal(isMarketingStatusTriggerColumn("opted_out"), false);
assert.equal(isMarketingStatusTriggerColumn("setup_call"), true);

console.log("marketing-status-trigger.test.ts: ok");
