import assert from "node:assert/strict";
import {
  NO_RESPONSE_HUMAN_TOUCH_DAYS,
  isHumanOutboundModel,
  isNoResponseSalesPhase,
  isTemplateOutboundModel,
  isZoeAssistantModel,
  noResponseAudienceBlocks,
} from "@/lib/leads/no-response-audience";

const NOW = Date.parse("2026-09-26T08:00:00.000Z");
const USER = "2026-09-22T14:59:50.000Z";

function msg(role: string, model: string | null, at: string) {
  return { role, model_used: model, created_at: at };
}

assert.equal(NO_RESPONSE_HUMAN_TOUCH_DAYS, 7);
assert.equal(isNoResponseSalesPhase("schedule_date"), true);
assert.equal(isNoResponseSalesPhase("cta"), true);
assert.equal(isNoResponseSalesPhase("opening"), false);
assert.equal(isNoResponseSalesPhase("registered"), false);
assert.equal(isNoResponseSalesPhase(null), false);
assert.equal(isZoeAssistantModel("claude-haiku-4-5"), true);
assert.equal(isZoeAssistantModel("sales_flow"), true);
assert.equal(isZoeAssistantModel("wa_followup_1"), true);
assert.equal(isZoeAssistantModel("lead_template"), false);
assert.equal(isZoeAssistantModel("wa_business_app"), false);
assert.equal(isZoeAssistantModel("manual_handoff"), false);
assert.equal(isZoeAssistantModel(""), false);
assert.equal(isHumanOutboundModel("wa_business_app"), true);
assert.equal(isTemplateOutboundModel("lead_template"), true);

{
  const blocks = noResponseAudienceBlocks({
    sessionPhase: "schedule_date",
    arboxIsMember: false,
    inMemberSyncLog: false,
    lastUserAtIso: USER,
    nowMs: NOW,
    messages: [
      msg("user", null, USER),
      msg("assistant", "sales_flow", "2026-09-22T15:10:00.000Z"),
    ],
  });
  assert.deepEqual(blocks, []);
}

{
  const blocks = noResponseAudienceBlocks({
    sessionPhase: "opening",
    arboxIsMember: false,
    inMemberSyncLog: false,
    lastUserAtIso: USER,
    nowMs: NOW,
    messages: [
      msg("user", null, USER),
      msg("assistant", "claude-haiku-4-5", "2026-09-22T15:10:00.000Z"),
    ],
  });
  assert.deepEqual(blocks, ["not_sales_phase"]);
}

{
  const blocks = noResponseAudienceBlocks({
    sessionPhase: "warmup",
    arboxIsMember: false,
    inMemberSyncLog: false,
    lastUserAtIso: USER,
    nowMs: NOW,
    messages: [
      msg("user", null, USER),
      msg("assistant", "lead_template", "2026-09-22T15:10:00.000Z"),
    ],
  });
  assert.deepEqual(blocks, ["no_zoe_conversation"]);
}

{
  const blocks = noResponseAudienceBlocks({
    sessionPhase: "cta",
    arboxIsMember: true,
    inMemberSyncLog: false,
    lastUserAtIso: USER,
    nowMs: NOW,
    messages: [
      msg("user", null, USER),
      msg("assistant", "claude-haiku-4-5", "2026-09-22T15:10:00.000Z"),
    ],
  });
  assert.deepEqual(blocks, ["arbox_member"]);
}

{
  const blocks = noResponseAudienceBlocks({
    sessionPhase: "warmup",
    arboxIsMember: false,
    inMemberSyncLog: false,
    lastUserAtIso: "2026-09-20T13:26:59.000Z",
    nowMs: Date.parse("2026-09-24T08:00:00.000Z"),
    messages: [
      msg("user", null, "2026-09-20T13:26:59.000Z"),
      msg("assistant", "greeting", "2026-09-20T13:27:10.000Z"),
      msg("assistant", "wa_business_app", "2026-09-24T07:53:00.000Z"),
    ],
  });
  assert.deepEqual(blocks, ["human_touch"]);
}

console.log("no-response-audience.test.ts: ok");
