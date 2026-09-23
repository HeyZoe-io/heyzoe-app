import assert from "node:assert/strict";
import {
  formatLeadConversationDateTime,
  marketingLeadConversationAt,
} from "@/lib/lead-activity";

const userAt = "2026-08-20T11:46:05.000Z";
const touchedAt = "2026-08-21T08:00:00.000Z";
const createdAt = "2026-08-01T10:00:00.000Z";

assert.equal(
  marketingLeadConversationAt({
    last_user_message_at: userAt,
    updated_at: touchedAt,
    created_at: createdAt,
  }),
  userAt
);

assert.equal(
  marketingLeadConversationAt({
    last_user_message_at: null,
    updated_at: touchedAt,
    created_at: createdAt,
  }),
  touchedAt
);

assert.equal(
  marketingLeadConversationAt({
    last_user_message_at: "not-a-date",
    updated_at: touchedAt,
    created_at: createdAt,
  }),
  touchedAt
);

assert.equal(marketingLeadConversationAt(null), null);
assert.equal(marketingLeadConversationAt({}), null);

// 11:46 UTC = 14:46 ישראל (קיץ). אותו מחרוזת בדף לידים ובדף שיחות.
assert.equal(formatLeadConversationDateTime(userAt), "20.08.2026, 14:46");
assert.equal(formatLeadConversationDateTime(null), "—");
assert.equal(formatLeadConversationDateTime("nope"), "—");

console.log("lead-activity.test.ts: ok");
