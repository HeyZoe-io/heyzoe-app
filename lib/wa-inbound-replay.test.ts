import assert from "node:assert/strict";
import { parseMetaWebhook } from "@/lib/whatsapp";
import {
  buildInboundReplayPayload,
  INBOUND_REPLAY_PAYLOAD_FLAG,
  parseWaSessionId,
  pickUnansweredInbound,
} from "@/lib/wa-inbound-replay";

const now = new Date("2026-10-09T14:00:00Z");

assert.deepEqual(parseWaSessionId("wa_1070253039505140_972523393475"), {
  phoneNumberId: "1070253039505140",
  phone: "972523393475",
});
assert.equal(parseWaSessionId("marketing_972523393475"), null);

const unanswered = pickUnansweredInbound(
  [
    { id: 3, created_at: "2026-10-09T13:40:00Z", role: "event", content: "[heyzoe:x]" },
    { id: 2, created_at: "2026-10-09T13:29:05Z", role: "user", content: "Max power" },
    { id: 1, created_at: "2026-10-09T13:27:56Z", role: "assistant", content: "hi" },
  ],
  now
);
assert.ok(unanswered.ok && unanswered.row.id === 2);

const answered = pickUnansweredInbound(
  [
    { id: 3, created_at: "2026-10-09T13:30:00Z", role: "assistant", content: "reply" },
    { id: 2, created_at: "2026-10-09T13:29:05Z", role: "user", content: "Max power" },
  ],
  now
);
assert.deepEqual(answered, { ok: false, reason: "already_answered" });

const stale = pickUnansweredInbound(
  [{ id: 2, created_at: "2026-10-08T12:00:00Z", role: "user", content: "Max power" }],
  now
);
assert.deepEqual(stale, { ok: false, reason: "outside_window" });

const body = buildInboundReplayPayload({
  phoneNumberId: "1070253039505140",
  phone: "972508318162",
  text: "Max power",
  replayOfId: 2,
});
const payload = JSON.parse(body) as Record<string, unknown>;
assert.equal(payload[INBOUND_REPLAY_PAYLOAD_FLAG], true);
const msg = parseMetaWebhook(payload);
assert.ok(msg && msg.type === "text");
assert.equal(msg.text, "Max power");
assert.equal(msg.from, "+972508318162");
assert.equal(msg.toNumber, "1070253039505140");
assert.equal(msg.messageId, "replay_2");

console.log("wa-inbound-replay tests passed");
