import assert from "node:assert/strict";
import {
  NO_RESPONSE_HUMAN_COOLDOWN_HOURS,
  NO_RESPONSE_RECENT_TEMPLATE_HOURS,
  isHumanOutboundModel,
  isTemplateOutboundModel,
  isZoeAssistantModel,
  noResponseAudienceBlocks,
} from "@/lib/leads/no-response-audience";

const NOW = Date.parse("2026-09-26T08:00:00.000Z");
const USER = "2026-09-22T14:59:50.000Z";
const HOUR = 60 * 60 * 1000;

function msg(role: string, model: string | null, at: string) {
  return { role, model_used: model, created_at: at };
}

function hoursBefore(hours: number): string {
  return new Date(NOW - hours * HOUR).toISOString();
}

function base(messages: ReturnType<typeof msg>[]) {
  return noResponseAudienceBlocks({
    arboxIsMember: false,
    inMemberSyncLog: false,
    lastUserAtIso: USER,
    nowMs: NOW,
    messages,
  });
}

assert.equal(NO_RESPONSE_HUMAN_COOLDOWN_HOURS, 48);
assert.equal(NO_RESPONSE_RECENT_TEMPLATE_HOURS, 72);
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
  const blocks = base([
    msg("user", null, USER),
    msg("assistant", "sales_flow", "2026-09-22T15:10:00.000Z"),
  ]);
  assert.deepEqual(blocks, []);
}

{
  const blocks = base([
    msg("user", null, USER),
    msg("assistant", "claude-haiku-4-5", "2026-09-22T15:10:00.000Z"),
  ]);
  assert.deepEqual(blocks, []);
}

{
  const blocks = base([
    msg("user", null, USER),
    msg("assistant", "lead_template", hoursBefore(10)),
  ]);
  assert.deepEqual(blocks, ["no_zoe_conversation", "recent_template"]);
}

{
  const blocks = noResponseAudienceBlocks({
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
  assert.deepEqual(blocks, ["human_cooldown"]);
}

{
  const blocks = base([
    msg("user", null, USER),
    msg("assistant", "sales_flow", "2026-09-22T15:10:00.000Z"),
    msg("assistant", "wa_business_app", hoursBefore(47)),
  ]);
  assert.deepEqual(blocks, ["human_cooldown"]);
}

{
  const blocks = base([
    msg("user", null, USER),
    msg("assistant", "sales_flow", "2026-09-22T15:10:00.000Z"),
    msg("assistant", "manual_handoff", hoursBefore(49)),
  ]);
  assert.deepEqual(blocks, []);
}

{
  const blocks = base([
    msg("user", null, USER),
    msg("assistant", "sales_flow", "2026-09-22T15:10:00.000Z"),
    msg("assistant", "lead_template", hoursBefore(71)),
  ]);
  assert.deepEqual(blocks, ["recent_template"]);
}

{
  const blocks = base([
    msg("user", null, USER),
    msg("assistant", "sales_flow", "2026-09-22T15:10:00.000Z"),
    msg("assistant", "lead_template", hoursBefore(73)),
  ]);
  assert.deepEqual(blocks, []);
}

console.log("no-response-audience.test.ts: ok");
