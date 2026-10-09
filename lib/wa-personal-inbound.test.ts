import assert from "node:assert/strict";
import { buildHaikuRequest } from "@/lib/ai-models";
import {
  OWNER_SHORT_REPLY_WINDOW_MS,
  RULE3_ACK_FALLBACK,
  applyComplaintOpenerSafetyNet,
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

const complaint = { inbound: "אני רוצה החזר על השיעור", route: "answer" as const };
const notComplaint = { inbound: "מאחרת בעשר דקות", route: "answer" as const };
assert.equal(
  applyComplaintOpenerSafetyNet("אין בעיה, אני מעבירה את הבקשה לצוות", complaint),
  "אני מעבירה את הבקשה לצוות"
);
assert.equal(
  applyComplaintOpenerSafetyNet("אין בעיה בכלל 🙂 הבקשה עוברת לצוות עכשיו", complaint),
  "הבקשה עוברת לצוות עכשיו"
);
assert.equal(
  applyComplaintOpenerSafetyNet("סבבה! 💜 אעביר את זה לצוות היום", { ...complaint, route: "handoff" }),
  "אעביר את זה לצוות היום"
);
assert.equal(
  applyComplaintOpenerSafetyNet("בכיף - נטפל בזה יחד מול הצוות", complaint),
  "נטפל בזה יחד מול הצוות"
);
assert.equal(applyComplaintOpenerSafetyNet("אין בעיה", complaint), RULE3_ACK_FALLBACK.neutral);
assert.equal(
  applyComplaintOpenerSafetyNet("אין בעיה, תודה", { ...complaint, addressingMode: "feminine" }),
  RULE3_ACK_FALLBACK.feminine
);
assert.equal(
  applyComplaintOpenerSafetyNet("סבבה 🙂", { inbound: "תזכו אותי בבקשה", addressingMode: "plural" }),
  RULE3_ACK_FALLBACK.plural
);
assert.equal(
  applyComplaintOpenerSafetyNet("אין בעיה, השיעור ב-18:00 הערב", notComplaint),
  "אין בעיה, השיעור ב-18:00 הערב"
);
assert.equal(
  applyComplaintOpenerSafetyNet("אין בעיה, נתראה בערב", { inbound: "תזכורת לשיעור מחר", route: "answer" }),
  "אין בעיה, נתראה בערב"
);
assert.equal(
  applyComplaintOpenerSafetyNet("אין בעיה, נציג יחזור אליך בקרוב", {
    inbound: "אפשר נציג?",
    route: "handoff",
    hintCategory: "human_agent",
  }),
  "אין בעיה, נציג יחזור אליך בקרוב"
);
assert.equal(
  applyComplaintOpenerSafetyNet("אני מבינה, ואין בעיה להעביר את זה לצוות", complaint),
  "אני מבינה, ואין בעיה להעביר את זה לצוות"
);
assert.equal(
  applyComplaintOpenerSafetyNet("אין בעיה, אני מעבירה את זה לצוות", {
    inbound: "הסרטון בכלל לא מעורר חשק וחבל",
    route: "handoff",
  }),
  "אני מעבירה את זה לצוות"
);

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
assert.equal(judgment.includes("אין בעיה"), false);
assert.match(judgment, /תודה ששיתפת/);
assert.match(judgment, /לאיזה יום/);
assert.match(judgment, /13:00/);
assert.equal(judgment.includes("—"), false);
assert.equal(judgment.includes("–"), false);
assert.match(buildFreeQuestionBehaviorBlock({}), /2-3 משפטים/);
assert.equal(buildFreeQuestionBehaviorBlock({}).includes("[[route:"), false);
assert.equal(buildFreeQuestionBehaviorBlock({}).includes("אין בעיה"), false);
assert.match(
  buildBehaviorJudgmentBlock({ addressingMode: "feminine" }),
  /מצטערת לשמוע/
);
assert.match(buildFreeQuestionBehaviorBlock({ addressingMode: "neutral" }), /תודה ששיתפת, הבקשה עוברת לצוות/);

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
