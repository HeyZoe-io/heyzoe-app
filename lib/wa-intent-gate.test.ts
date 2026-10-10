import assert from "node:assert/strict";
import { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook-intents";
import { pendingServiceMenuReply } from "@/lib/wa-opening-service-list-pick-bridge";
import { buildReplyRoutePromptBlock } from "@/lib/wa-reply-route";
import {
  consequentialIntentPromptLine,
  decideIntentGate,
  scoreIntentTurn,
  extractConsequentialIntent,
  INTENT_AMBIGUOUS_QUESTION,
  INTENT_POLICY_OFFER_LINE,
  policyAnswerIsGrounded,
} from "@/lib/wa-intent-gate";

const notice = {
  knowledgeQa: [{ question: "ביטול מנוי", answer: "ביטול מנוי דורש הודעה של 30 יום" }],
};
const empty = {};

function gate(input: {
  tag: string;
  route: "handoff" | "policy_question" | "booking_change" | "class_move" | "membership_purchase" | "answer";
  text: string;
  answer: string;
  knowledge?: typeof notice | typeof empty;
  hint?: string | null;
}) {
  return decideIntentGate({
    extracted: extractConsequentialIntent(input.tag),
    route: input.route,
    hintCategory: input.hint ?? null,
    playbookCategory: detectClosedPlaybookIntent(input.text)?.category ?? null,
    answer: input.answer,
    knowledge: input.knowledge ?? empty,
    inbound: input.text,
  });
}

assert.equal(extractConsequentialIntent("שלום").status, "missing");
assert.equal(extractConsequentialIntent("[[intent:nope]]\nשלום").status, "invalid");
assert.equal(extractConsequentialIntent("[[route:handoff]]\n[[intent:explicit_request]]\nעובר").intent, "explicit_request");
assert.equal(extractConsequentialIntent("[[intent:explicit_request]]\nעובר").body.includes("intent"), false);

const categories = [
  { text: "תבטלי לי את המנוי", route: "handoff" as const },
  { text: "תקפיאי לי את המנוי", route: "handoff" as const },
  { text: "אני רוצה החזר", route: "handoff" as const },
  { text: "תבטלי את השיעור של מחר", route: "booking_change" as const },
  { text: "תעבירי את האימון למחר", route: "class_move" as const },
  { text: "אני רוצה לחדש את המנוי", route: "membership_purchase" as const },
];
for (const row of categories) {
  assert.equal(
    gate({ tag: "[[intent:explicit_request]]", route: row.route, text: row.text, answer: "מעבירה לצוות" }).action,
    "explicit",
    row.text
  );
  const question = gate({
    tag: "[[intent:policy_question]]",
    route: row.route,
    text: row.text,
    answer: "ביטול מנוי דורש הודעה של 30 יום",
    knowledge: notice,
  });
  assert.equal(question.action, "answer", row.text);
  if (question.action === "answer") assert.match(question.text, /30 יום/);
  assert.equal(
    gate({ tag: "[[intent:ambiguous]]", route: row.route, text: row.text, answer: "כלל" }).action,
    "clarify"
  );
  assert.equal(
    gate({ tag: "", route: row.route, text: row.text, answer: "כלל" }).action,
    "fallback"
  );
}

assert.equal(
  gate({
    tag: "[[intent:policy_question]]",
    route: "handoff",
    text: "צריך להודיע על ביטול המנוי חודש מראש נכון?",
    answer: "ביטול מנוי דורש הודעה של 30 יום",
    knowledge: notice,
  }).action,
  "answer"
);
assert.equal(
  gate({
    tag: "[[intent:policy_question]]",
    route: "handoff",
    text: "צריך להודיע על ביטול המנוי חודש מראש נכון?",
    answer: "צריך להודיע 14 יום מראש",
    knowledge: empty,
  }).action,
  "uncovered"
);
const clarify = gate({
  tag: "[[intent:ambiguous]]",
  route: "answer",
  text: "בנוגע לאימון של מחר",
  answer: "במה אפשר לעזור?",
  hint: "class_cancel",
});
assert.equal(clarify.action, "clarify");
if (clarify.action === "clarify") assert.equal(clarify.text, INTENT_AMBIGUOUS_QUESTION);

assert.equal(
  gate({
    tag: "[[intent:policy_question]]",
    route: "handoff",
    text: "יש לי תלונה על השיעור",
    answer: "מצטערת",
    knowledge: notice,
  }).action,
  "skip"
);
assert.equal(
  gate({
    tag: "[[intent:policy_question]]",
    route: "handoff",
    text: "יש לי פציעה בברך, אפשר להתאמן?",
    answer: "כדאי לבדוק",
    knowledge: notice,
  }).action,
  "skip"
);
assert.equal(
  gate({
    tag: "[[intent:explicit_request]]",
    route: "handoff",
    text: "נציג אנושי",
    answer: "מעבירה",
    hint: "human_agent",
  }).action,
  "explicit"
);

assert.equal(
  scoreIntentTurn({
    decision: { action: "explicit" },
    route: "answer",
    humanAgent: false,
  }),
  "handoff"
);
const bareCancel = gate({
  tag: "[[intent:explicit_request]]",
  route: "answer",
  text: "אז אני רוצה לבטל.",
  answer: "מה לבטל?",
});
assert.equal(bareCancel.action, "explicit");
const bareMissing = gate({
  tag: "",
  route: "answer",
  text: "אז אני רוצה לבטל.",
  answer: "",
});
assert.equal(bareMissing.action, "fallback");
if (bareMissing.action === "fallback") {
  assert.equal(
    scoreIntentTurn({ decision: bareMissing, route: "answer", humanAgent: false }),
    "handoff"
  );
}
assert.equal(policyAnswerIsGrounded("ביטול מנוי דורש הודעה של 30 יום", "ביטול מנוי דורש הודעה של 30 יום"), true);
assert.equal(policyAnswerIsGrounded("צריך 14 יום", "ביטול מנוי דורש הודעה של 30 יום"), false);
assert.match(INTENT_POLICY_OFFER_LINE, /צוות/);
assert.ok(buildReplyRoutePromptBlock().includes(consequentialIntentPromptLine()));

assert.equal(
  pendingServiceMenuReply({
    inbound: "אני רוצה הגנה עצמית",
    body: "",
    menuPending: true,
    services: [{ name: "הגנה עצמית" }, { name: "פילאטיס מכשירים" }],
  }),
  "pick"
);
assert.equal(
  pendingServiceMenuReply({
    inbound: "היי אשמח לשמוע מידע",
    body: "",
    menuPending: true,
    services: [{ name: "הגנה עצמית" }],
  }),
  "nudge"
);

console.log("wa-intent-gate.test.ts: ok");
