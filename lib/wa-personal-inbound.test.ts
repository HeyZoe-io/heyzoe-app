import assert from "node:assert/strict";
import { buildHaikuRequest } from "@/lib/ai-models";
import {
  OWNER_SHORT_REPLY_WINDOW_MS,
  stripCasualAgreementOpener,
  buildBehaviorJudgmentBlock,
  buildFreeQuestionBehaviorBlock,
  claudePersonalTagStands,
  decidePersonalInbound,
  isBareEndearmentGreeting,
  ownerShortReplyBlocksBookingChange,
  type PersonalTurn,
} from "@/lib/wa-personal-inbound";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function ownerTurn(agoMs: number): PersonalTurn {
  return {
    role: "assistant",
    created_at: new Date(NOW - agoMs).toISOString(),
    model_used: "wa_business_app",
  };
}

function zoeTurn(agoMs: number): PersonalTurn {
  return {
    role: "assistant",
    created_at: new Date(NOW - agoMs).toISOString(),
    model_used: "claude-haiku-5-5",
  };
}

function decide(text: string, turns: PersonalTurn[], arboxIsMember = false, ownerNames?: string[]) {
  return decidePersonalInbound({ text, turns, arboxIsMember, ownerNames, nowMs: NOW });
}

assert.equal(OWNER_SHORT_REPLY_WINDOW_MS, 72 * 60 * 60 * 1000);
assert.equal(stripCasualAgreementOpener("אין בעיה, אני מעבירה את הבקשה לצוות"), "אני מעבירה את הבקשה לצוות");
assert.equal(stripCasualAgreementOpener("אין בעיה אעביר את ההודעה לצוות!"), "אעביר את ההודעה לצוות!");
assert.equal(stripCasualAgreementOpener("תודה ששיתפת, אני מעבירה לצוות"), "תודה ששיתפת, אני מעבירה לצוות");

assert.equal(decide("היוש כן ❤️", [ownerTurn(HOUR)]), "owner_short_reply");
assert.equal(decide("כן", [ownerTurn(HOUR)]), "owner_short_reply");
assert.equal(decide("סבבה", [ownerTurn(HOUR)]), "owner_short_reply");
assert.equal(decide("לא", [ownerTurn(HOUR)]), "owner_short_reply");
assert.equal(decide("❤️", [ownerTurn(HOUR)]), "owner_short_reply");
assert.equal(decide("כן", [ownerTurn(OWNER_SHORT_REPLY_WINDOW_MS + HOUR)]), null);
assert.equal(decide("כן", [ownerTurn(2 * HOUR), zoeTurn(HOUR)]), null);
assert.equal(decide("כן אני רוצה להעביר את השיעור למחר", [ownerTurn(HOUR)]), null);

const gili = {
  text: "היוש כן ❤️",
  turns: [ownerTurn(HOUR)],
  arboxIsMember: false,
  nowMs: NOW,
};
assert.equal(ownerShortReplyBlocksBookingChange(gili), true);
assert.equal(
  ownerShortReplyBlocksBookingChange({ ...gili, turns: [ownerTurn(OWNER_SHORT_REPLY_WINDOW_MS + HOUR)] }),
  false
);

assert.equal(decide("היי אהובה", []), null);
assert.equal(isBareEndearmentGreeting("היי אהובה"), true);
assert.equal(claudePersonalTagStands({ text: "היי אהובה", turns: [], arboxIsMember: false, nowMs: NOW }), false);
assert.equal(decide("היי אהובה שבוע הבא לא הגעתי כי אמרת לי שלא תהיי", []), "personal_address");
assert.equal(decide("היי אהובה", [], true), "personal_address");
assert.equal(decide("היי אהובה", [ownerTurn(10 * 24 * HOUR)]), "personal_address");
assert.equal(decide("היי אהובה", [ownerTurn(15 * 24 * HOUR)]), null);
assert.equal(decide("היי מאיוש אמרת לי", [], false, ["מאיוש"]), "personal_address");
assert.equal(decide("היי מאיוש", [], false, ["מאיוש"]), null);
assert.equal(
  decide("אהובה אמרת לי שלא תהיי, אז אפשר לבטל את השיעור של מחר", []),
  null
);
assert.equal(
  claudePersonalTagStands({ text: "מתי את חוזרת?", turns: [], arboxIsMember: false, nowMs: NOW }),
  true
);

const judgment = buildBehaviorJudgmentBlock({
  hasArboxConnection: true,
  canShowSchedule: true,
  canSendMembershipLink: true,
  canSendTrialLink: true,
});
assert.match(judgment, /אין בעיה/);
assert.match(judgment, /לאיזה יום/);
assert.match(judgment, /13:00/);
assert.equal(judgment.includes("—"), false);
assert.equal(judgment.includes("–"), false);
assert.match(buildFreeQuestionBehaviorBlock({}), /2-3 משפטים/);
assert.equal(buildFreeQuestionBehaviorBlock({}).includes("[[route:"), false);

const free55 = buildHaikuRequest("conversation-flow-free-question", "claude-haiku-5-5");
assert.deepEqual(free55, {
  model: "claude-haiku-5-5",
  max_tokens: 400,
  output_config: { effort: "low" },
  thinking: { type: "disabled" },
});
const free45 = buildHaikuRequest("conversation-flow-free-question", "claude-haiku-4-5");
assert.deepEqual(free45, { model: "claude-haiku-4-5", max_tokens: 280, temperature: 0.3 });
assert.equal("output_config" in free45, false);
assert.equal("thinking" in free45, false);

console.log("wa-personal-inbound.test.ts: ok");
