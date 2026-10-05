import assert from "node:assert/strict";
import { STARTER_MONTHLY_CONTACT_LIMIT, starterQuotaShouldBlock } from "@/lib/conversation-quota";
import {
  STARTER_MONTHLY_CONVERSATION_LIMIT,
  PRO_MONTHLY_CONVERSATION_LIMIT,
  countsAsOpenedZoeConversation,
  monthlyConversationLimitForPlan,
  openedConversationPhoneKey,
  openedConversationsSinceIso,
} from "@/lib/zoe-opened-conversations";

assert.equal(STARTER_MONTHLY_CONVERSATION_LIMIT, STARTER_MONTHLY_CONTACT_LIMIT);
assert.equal(PRO_MONTHLY_CONVERSATION_LIMIT, 500);
assert.equal(monthlyConversationLimitForPlan("basic"), 100);
assert.equal(monthlyConversationLimitForPlan("starter"), 100);
assert.equal(monthlyConversationLimitForPlan(""), 100);
assert.equal(monthlyConversationLimitForPlan("premium"), 500);
assert.equal(monthlyConversationLimitForPlan("pro"), 500);
assert.equal(monthlyConversationLimitForPlan("intro"), 500);

assert.equal(countsAsOpenedZoeConversation("claude-haiku-4-5"), true);
assert.equal(countsAsOpenedZoeConversation("claude-haiku-4-5#route=answer;tag=ok"), true);
assert.equal(countsAsOpenedZoeConversation("sales_flow"), true);
assert.equal(countsAsOpenedZoeConversation("wa_followup_2"), true);
assert.equal(countsAsOpenedZoeConversation("wa_outbound"), true);
assert.equal(countsAsOpenedZoeConversation("starter_quota_cap_notice"), false);

assert.equal(starterQuotaShouldBlock({ monthlyCount: 99 }), false);
assert.equal(starterQuotaShouldBlock({ monthlyCount: 100 }), true);
assert.equal(starterQuotaShouldBlock({ monthlyCount: 140 }), true);
assert.equal(starterQuotaShouldBlock({ monthlyCount: 499, limit: 500 }), false);
assert.equal(starterQuotaShouldBlock({ monthlyCount: 500, limit: 500 }), true);
assert.equal(countsAsOpenedZoeConversation("wa_business_app"), false);
assert.equal(countsAsOpenedZoeConversation("manual_handoff"), false);
assert.equal(countsAsOpenedZoeConversation("lead_template"), false);
assert.equal(countsAsOpenedZoeConversation(null), false);
assert.equal(countsAsOpenedZoeConversation(""), false);

assert.equal(openedConversationPhoneKey("wa_123_972501234567"), "972501234567");
assert.equal(openedConversationPhoneKey("wa_999_+972501234567"), "972501234567");
assert.equal(openedConversationPhoneKey("wa_123_972501234567"), openedConversationPhoneKey("wa_999_+972501234567"));
assert.equal(openedConversationPhoneKey("marketing_972501234567"), null);

// 27 בספטמבר 2026 בצהריים UTC הוא עדיין ספטמבר בישראל (UTC+3) → 1 בספטמבר 00:00.
assert.equal(openedConversationsSinceIso(new Date("2026-09-27T12:00:00.000Z")), "2026-08-31T21:00:00.000Z");

console.log("zoe-opened-conversations.test.ts ok");
