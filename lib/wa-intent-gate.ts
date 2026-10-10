/**
 * Consequential topics (cancel, freeze, refund, move, membership, a person)
 * run their handler only when Claude says the lead asked to do it.
 * A policy question is answered from knowledge. An unclear mention gets one question.
 * A missing tag keeps today's handler and logs [intent_gate] fallback.
 */

import { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook-intents";
import { lookupPlaybookFact } from "@/lib/wa-closed-playbook-facts";
import type { ClosedPlaybookCategory, ClosedPlaybookKnowledge } from "@/lib/wa-closed-playbook-types";
import type { WaReplyRoute } from "@/lib/wa-reply-route";

export const CONSEQUENTIAL_INTENTS = ["policy_question", "explicit_request", "ambiguous"] as const;
export type ConsequentialIntent = (typeof CONSEQUENTIAL_INTENTS)[number];
export type ConsequentialIntentStatus = "ok" | "missing" | "invalid";

export const INTENT_POLICY_OFFER_LINE = "אם צריך, אפשר להעביר את זה לצוות";
export const INTENT_AMBIGUOUS_QUESTION = "במה אפשר לעזור כאן?";

const INTENT_TAG_RE = /\[\[intent:([a-z_]+)\]\]/i;

const IN_SCOPE_ROUTES = new Set<WaReplyRoute>([
  "handoff",
  "policy_question",
  "booking_change",
  "booking_change_trial",
  "class_move",
  "class_move_member",
  "class_move_trial",
  "membership_purchase",
]);

const IN_SCOPE_HINTS = new Set([
  "cancellation",
  "freeze",
  "refund",
  "class_cancel",
  "reschedule",
  "human_agent",
  "membership_end_date",
  "membership_lookup",
  "membership_lookup_followup",
  "booked_class_move_app",
  "booking_mutation",
  "class_change_app_failed",
]);

/** Complaints, pain, and price talks keep today's handler. */
const PROTECTED_PLAYBOOK = new Set<ClosedPlaybookCategory>([
  "medical",
  "complaint",
  "discount",
  "coach_owner",
]);

const TOKEN_STOP = new Set([
  "את",
  "של",
  "על",
  "עם",
  "אין",
  "יש",
  "זה",
  "לא",
  "גם",
  "אם",
  "או",
  "מה",
  "איך",
  "אני",
  "היא",
  "הוא",
  "צריך",
  "אפשר",
]);

export type ExtractedConsequentialIntent = {
  intent: ConsequentialIntent | null;
  status: ConsequentialIntentStatus;
  body: string;
};

export type IntentGateDecision =
  | { action: "skip" }
  | { action: "explicit" }
  | { action: "answer"; text: string }
  | { action: "clarify"; text: string }
  | { action: "uncovered" }
  | { action: "fallback"; path: string };

function isIntent(value: string): value is ConsequentialIntent {
  return (CONSEQUENTIAL_INTENTS as readonly string[]).includes(value);
}

function stripIntentTags(raw: string): string {
  return String(raw ?? "")
    .replace(/^[ \t]*\[\[intent:[a-z_]+\]\][ \t]*\r?\n?/gim, "")
    .replace(/[ \t]*\[\[intent:[a-z_]+\]\][ \t]*/gi, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractConsequentialIntent(raw: string): ExtractedConsequentialIntent {
  const original = String(raw ?? "");
  const body = stripIntentTags(original);
  const match = INTENT_TAG_RE.exec(original);
  if (!match) {
    if (/\[\[intent:/i.test(original)) return { intent: null, status: "invalid", body };
    return { intent: null, status: "missing", body };
  }
  const name = String(match[1] ?? "").toLowerCase();
  if (!isIntent(name)) return { intent: null, status: "invalid", body };
  return { intent: name, status: "ok", body };
}

/** One short line. Complaints, pain, and a personal price request stay off this tag. */
export function consequentialIntentPromptLine(): string {
  return `כוונה, רק כשההודעה על ביטול, הקפאה, החזר, העברת אימון, מנוי או חיוב, או נציג. שורה שנייה:
[[intent:policy_question]] שאלה איך זה עובד. «צריך להודיע על ביטול חודש מראש?»
[[intent:explicit_request]] בקשה לבצע, גם בלי לפרט שיעור או מנוי. «תבטלי לי את המנוי». «אני רוצה לבטל». «נציג אנושי»
[[intent:ambiguous]] אזכור בלי שאלה ובלי בקשה. «בנוגע לאימון של מחר», והגוף רק שואל במה לעזור. «אני רוצה לבטל» אינה ambiguous.
תלונה, כאב, או בקשת מחיר אחר אינם התג הזה.`;
}

export function knowledgeBlobForPolicy(
  knowledge: ClosedPlaybookKnowledge | null | undefined
): string {
  if (!knowledge) return "";
  return [
    ...(knowledge.knowledgeQa ?? []).flatMap((pair) => [pair.question, pair.answer]),
    ...(knowledge.traits ?? []),
    knowledge.faqsText,
    knowledge.membershipsAndCardsText,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function contentTokens(text: string): string[] {
  return [
    ...new Set(
      String(text ?? "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3 && !TOKEN_STOP.has(part))
    ),
  ];
}

/** An answer that adds a number or a claim the knowledge does not contain is not covered. */
export function policyAnswerIsGrounded(answer: string, knowledge: string): boolean {
  const text = String(answer ?? "").replace(/\s+/g, " ").trim();
  const hay = String(knowledge ?? "");
  if (!text || !hay.trim()) return false;
  const numbers = [...text.matchAll(/\d+/g)].map((match) => match[0]);
  if (numbers.some((number) => !hay.includes(number))) return false;
  const tokens = contentTokens(text);
  if (tokens.length < 2) return hay.includes(text);
  const found = tokens.filter((token) => hay.includes(token)).length;
  return found / tokens.length >= 0.6;
}

export function withPolicyOffer(body: string): string {
  const text = String(body ?? "").trim();
  if (!text) return INTENT_POLICY_OFFER_LINE;
  if (text.includes("להעביר את זה לצוות") || text.includes("מעבירה לצוות") || text.includes("עוברת לצוות")) {
    return text;
  }
  return `${text}\n${INTENT_POLICY_OFFER_LINE}`;
}

export function intentGateApplies(input: {
  route: WaReplyRoute | null;
  hintCategory: string | null;
  playbookCategory: ClosedPlaybookCategory | null;
}): boolean {
  if (input.playbookCategory && PROTECTED_PLAYBOOK.has(input.playbookCategory)) return false;
  if (input.route && IN_SCOPE_ROUTES.has(input.route)) return true;
  if (input.hintCategory && IN_SCOPE_HINTS.has(input.hintCategory)) return true;
  if (
    input.playbookCategory &&
    (input.playbookCategory === "cancellation" ||
      input.playbookCategory === "freeze" ||
      input.playbookCategory === "refund" ||
      input.playbookCategory === "class_cancel" ||
      input.playbookCategory === "reschedule")
  ) {
    return true;
  }
  return false;
}

/** A cancel / freeze / refund / person request with no object still asks Zoe to act. */
export function bareActionRequest(text: string): boolean {
  return /(?:רוצ(?:ה|ה)|אשמח)\s+לבטל|אז\s+.{0,16}לבטל|תבטל|תקפיא|רוצ(?:ה|ה)\s+(?:החזר|להקפיא)|נציג\s+אנושי/u.test(
    String(text ?? "")
  );
}

export function decideIntentGate(input: {
  extracted: ExtractedConsequentialIntent;
  route: WaReplyRoute | null;
  hintCategory: string | null;
  playbookCategory: ClosedPlaybookCategory | null;
  answer: string;
  knowledge: ClosedPlaybookKnowledge | null | undefined;
  inbound?: string;
}): IntentGateDecision {
  if (input.playbookCategory && PROTECTED_PLAYBOOK.has(input.playbookCategory)) {
    return { action: "skip" };
  }
  const tagged = input.extracted.status === "ok" && Boolean(input.extracted.intent);
  const inScope = intentGateApplies({
    route: input.route,
    hintCategory: input.hintCategory,
    playbookCategory: input.playbookCategory,
  });
  const bare = bareActionRequest(input.inbound ?? "");
  if (!inScope && !tagged && !bare) return { action: "skip" };
  const path = bare && !inScope ? "bare_request" : input.route || input.hintCategory || input.playbookCategory || "consequential";
  if (!tagged) {
    return { action: "fallback", path };
  }
  if (input.extracted.intent === "explicit_request") return { action: "explicit" };
  if (input.extracted.intent === "ambiguous") {
    return { action: "clarify", text: INTENT_AMBIGUOUS_QUESTION };
  }
  const category = input.playbookCategory;
  const fact =
    category && !PROTECTED_PLAYBOOK.has(category) ? lookupPlaybookFact(category, input.knowledge) : null;
  const blob = knowledgeBlobForPolicy(input.knowledge);
  const body = String(input.answer ?? "").trim();
  const bodyGrounded = policyAnswerIsGrounded(body, blob);
  const factGrounded = Boolean(fact && policyAnswerIsGrounded(fact, blob));
  if (!bodyGrounded && !factGrounded) return { action: "uncovered" };
  const text = bodyGrounded ? body : String(fact ?? "").trim();
  if (!text) return { action: "uncovered" };
  return { action: "answer", text: withPolicyOffer(text) };
}

export function playbookCategoryForInbound(text: string): ClosedPlaybookCategory | null {
  return detectClosedPlaybookIntent(text)?.category ?? null;
}

const EXPLICIT_HANDLER_ROUTES = new Set([
  "handoff",
  "booking_change",
  "booking_change_trial",
  "class_move",
  "class_move_member",
  "class_move_trial",
  "membership_purchase",
]);

/** An explicit request still hands off when the route tag would only send the body. */
export function explicitNeedsDirectHandoff(route: string | null): boolean {
  return !route || !EXPLICIT_HANDLER_ROUTES.has(route);
}

export type ScoredTurnAction = "handoff" | "answer" | "clarify" | "send";

/** What the webhook would do. Send means the body goes out with no handoff. */
export function scoreIntentTurn(input: {
  decision: IntentGateDecision;
  route: string | null;
  humanAgent: boolean;
}): ScoredTurnAction {
  if (input.decision.action === "answer") return "answer";
  if (input.decision.action === "clarify") return "clarify";
  if (input.decision.action === "explicit") return "handoff";
  if (input.decision.action === "fallback" && input.decision.path === "bare_request") return "handoff";
  if (input.decision.action === "skip") {
    return input.route && EXPLICIT_HANDLER_ROUTES.has(input.route) ? "handoff" : "send";
  }
  if (input.humanAgent) return "handoff";
  if (input.route && (EXPLICIT_HANDLER_ROUTES.has(input.route) || input.route === "policy_question")) {
    return "handoff";
  }
  return "send";
}
