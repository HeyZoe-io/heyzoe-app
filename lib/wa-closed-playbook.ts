import {
  buildClosedPlaybookDefaultReply,
  closedPlaybookModelUsed,
} from "@/lib/wa-closed-playbook-copy";
import { findRelevantActivePromo, lookupPlaybookFact } from "@/lib/wa-closed-playbook-facts";
import { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook-intents";
import type {
  ClosedPlaybookKnowledge,
  ClosedPlaybookResolution,
} from "@/lib/wa-closed-playbook-types";

export type { ClosedPlaybookCategory, ClosedPlaybookIntent, ClosedPlaybookResolution } from "@/lib/wa-closed-playbook-types";
export { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook-intents";
export {
  CLOSED_PLAYBOOK_CANCELLATION_REPLY,
  CLOSED_PLAYBOOK_COACH_OWNER_REPLY,
  CLOSED_PLAYBOOK_COMPLAINT_REPLY,
  CLOSED_PLAYBOOK_DISCOUNT_NO_PROMO_REPLY,
  CLOSED_PLAYBOOK_FREEZE_REPLY,
  CLOSED_PLAYBOOK_GROUP_REPLY,
  CLOSED_PLAYBOOK_MEDICAL_REPLY,
  CLOSED_PLAYBOOK_REFUND_REPLY,
  buildClosedPlaybookDefaultReply,
} from "@/lib/wa-closed-playbook-copy";

/**
 * Inbound closed playbook: facts-first where required, else fixed copy.
 * notifyHumanRequested is the only flag the webhook should use — do not special-case categories there.
 *
 * Policy + fact → fact text, no notify.
 * Policy + no fact → default, notify.
 * Action + fact → fact text, notify.
 * Action + no fact → default, notify.
 * Discount + relevant promo → promo text, no notify.
 * Coach/owner → default, notify (no facts-check).
 */
export function resolveClosedPlaybook(opts: {
  inbound: string;
  knowledge: ClosedPlaybookKnowledge | null | undefined;
}): ClosedPlaybookResolution | null {
  const intent = detectClosedPlaybookIntent(opts.inbound);
  if (!intent) return null;

  const knowledge = opts.knowledge ?? {};
  const botName = knowledge.botName;

  if (intent.category === "coach_owner") {
    return {
      category: intent.category,
      shape: intent.shape,
      reply: buildClosedPlaybookDefaultReply("coach_owner", botName),
      modelUsed: closedPlaybookModelUsed("coach_owner", "default"),
      notifyHumanRequested: true,
      source: "default",
    };
  }

  if (intent.category === "discount") {
    const promo = findRelevantActivePromo(opts.inbound, knowledge.promotionsText);
    if (promo) {
      return {
        category: "discount",
        shape: intent.shape,
        reply: promo,
        modelUsed: closedPlaybookModelUsed("discount", "promo"),
        notifyHumanRequested: false,
        source: "promo",
      };
    }
    return {
      category: "discount",
      shape: intent.shape,
      reply: buildClosedPlaybookDefaultReply("discount", botName),
      modelUsed: closedPlaybookModelUsed("discount", "default"),
      notifyHumanRequested: true,
      source: "default",
    };
  }

  const fact = lookupPlaybookFact(intent.category, knowledge);
  if (fact) {
    return {
      category: intent.category,
      shape: intent.shape,
      reply: fact,
      modelUsed: closedPlaybookModelUsed(intent.category, "fact"),
      notifyHumanRequested: intent.shape === "action",
      source: "fact",
    };
  }

  return {
    category: intent.category,
    shape: intent.shape,
    reply: buildClosedPlaybookDefaultReply(intent.category, botName),
    modelUsed: closedPlaybookModelUsed(intent.category, "default"),
    notifyHumanRequested: true,
    source: "default",
  };
}
