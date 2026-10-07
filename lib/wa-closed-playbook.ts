import {
  buildClosedPlaybookDefaultReply,
  buildNonArboxClassChangeTeamHandoffReply,
  CLOSED_PLAYBOOK_POLICY_QUESTION_REPLY,
  closedPlaybookModelUsed,
} from "@/lib/wa-closed-playbook-copy";
import { findMatchingGroupCatalogProduct, lookupPlaybookFact } from "@/lib/wa-closed-playbook-facts";
import { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook-intents";
import type {
  ClosedPlaybookKnowledge,
  ClosedPlaybookResolution,
} from "@/lib/wa-closed-playbook-types";

export type { ClosedPlaybookCategory, ClosedPlaybookIntent, ClosedPlaybookResolution } from "@/lib/wa-closed-playbook-types";
export { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook-intents";
export {
  CLOSED_PLAYBOOK_CANCELLATION_REPLY,
  CLOSED_PLAYBOOK_CLASS_CANCEL_ACTION_REPLY,
  CLOSED_PLAYBOOK_CLASS_CANCEL_REPLY,
  CLOSED_PLAYBOOK_COACH_OWNER_REPLY,
  CLOSED_PLAYBOOK_COMPLAINT_REPLY,
  CLOSED_PLAYBOOK_DISCOUNT_NO_PROMO_REPLY,
  CLOSED_PLAYBOOK_POLICY_QUESTION_REPLY,
  CLOSED_PLAYBOOK_FREEZE_REPLY,
  CLOSED_PLAYBOOK_GROUP_REPLY,
  CLOSED_PLAYBOOK_MEDICAL_REPLY,
  CLOSED_PLAYBOOK_REFUND_REPLY,
  buildClosedPlaybookDefaultReply,
  buildNonArboxClassChangeTeamHandoffReply,
  replyGivesGenericClassCancelAppHowTo,
} from "@/lib/wa-closed-playbook-copy";

/**
 * Inbound closed playbook: facts-first where required, else fixed copy.
 * Group: unique catalog product → source catalog (webhook re-sends product pick);
 * else fact; else default. notifyHumanRequested is the webhook notify flag.
 *
 * Class-cancel: knowledge fact if one exists. Arbox with no fact → app how-to.
 * Any other business with no fact → team handoff that names the request.
 * Group + unique catalog product → catalog (webhook: product-pick menu), no notify.
 * Discount: configured promotions text, then the closed copy, and the team is notified.
 * No promotions text → the closed copy only, and the team is notified.
 * Coach/owner → default, notify (no facts-check).
 */

/** ידע העסק עצמו אומר לבטל/להחליף דרך אפליקציה — אז מותר לצטט אותו. */
export function knowledgeInstructsClassCancelViaApp(
  knowledge:
    | {
        knowledgeQa?: Array<{ question?: string | null; answer?: string | null }> | null;
        traits?: string[] | null;
        faqsText?: string | null;
        membershipsAndCardsText?: string | null;
        businessDescription?: string | null;
      }
    | null
    | undefined
): boolean {
  if (!knowledge) return false;
  const blob = [
    ...(knowledge.knowledgeQa ?? []).flatMap((pair) => [pair.question, pair.answer]),
    ...(knowledge.traits ?? []),
    knowledge.faqsText,
    knowledge.membershipsAndCardsText,
    knowledge.businessDescription,
  ]
    .map((part) => String(part ?? ""))
    .join("\n");
  return /אפליקצי/u.test(blob) && /(?:לבטל|ביטול|מבטלים|הרשמ)/u.test(blob);
}

const POLICY_FACT_CATEGORIES = new Set<ClosedPlaybookResolution["category"]>([
  "class_cancel",
  "cancellation",
  "freeze",
  "refund",
]);

/** Route policy_question: quote a configured fact, otherwise forward the question. */
export function replyForPolicyQuestionRoute(opts: {
  inbound: string;
  knowledge: ClosedPlaybookKnowledge | null | undefined;
}): {
  reply: string;
  notifyHumanRequested: boolean;
  modelUsed: string;
  category: ClosedPlaybookResolution["category"] | null;
} {
  const intent = detectClosedPlaybookIntent(opts.inbound);
  const category = intent && POLICY_FACT_CATEGORIES.has(intent.category) ? intent.category : null;
  const fact = category ? lookupPlaybookFact(category, opts.knowledge) : null;
  if (fact && category) {
    return {
      reply: fact,
      notifyHumanRequested: false,
      modelUsed: closedPlaybookModelUsed(category, "fact"),
      category,
    };
  }
  return {
    reply: CLOSED_PLAYBOOK_POLICY_QUESTION_REPLY,
    notifyHumanRequested: true,
    modelUsed: "closed_playbook_policy_question",
    category,
  };
}

export function resolveClosedPlaybook(opts: {
  inbound: string;
  knowledge: ClosedPlaybookKnowledge | null | undefined;
  /** crm_type=arbox ו-api key. בלי זה אין הוראות ביטול באפליקציה. */
  hasArbox?: boolean;
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
    const promo = String(knowledge.promotionsText ?? "").trim();
    const closed = buildClosedPlaybookDefaultReply("discount", botName);
    if (promo) {
      return {
        category: "discount",
        shape: intent.shape,
        reply: `${promo}\n\n${closed}`,
        modelUsed: closedPlaybookModelUsed("discount", "promo"),
        notifyHumanRequested: true,
        source: "promo",
      };
    }
    return {
      category: "discount",
      shape: intent.shape,
      reply: closed,
      modelUsed: closedPlaybookModelUsed("discount", "default"),
      notifyHumanRequested: true,
      source: "default",
    };
  }

  if (intent.category === "group") {
    const catalogName = findMatchingGroupCatalogProduct(opts.inbound, knowledge.salesFlowServices);
    if (catalogName) {
      return {
        category: "group",
        shape: intent.shape,
        reply: buildClosedPlaybookDefaultReply("group", botName),
        modelUsed: closedPlaybookModelUsed("group", "catalog"),
        notifyHumanRequested: false,
        source: "catalog",
        catalogServiceName: catalogName,
      };
    }
  }

  const fact = lookupPlaybookFact(intent.category, knowledge);
  if (
    intent.shape === "policy" &&
    !fact &&
    (intent.category === "class_cancel" ||
      intent.category === "cancellation" ||
      intent.category === "freeze" ||
      intent.category === "refund")
  ) {
    return {
      category: intent.category,
      shape: "policy",
      reply: CLOSED_PLAYBOOK_POLICY_QUESTION_REPLY,
      modelUsed: "closed_playbook_policy_question",
      notifyHumanRequested: true,
      source: "default",
    };
  }
  if (intent.category === "class_cancel" && !fact && opts.hasArbox !== true) {
    return {
      category: "class_cancel",
      shape: intent.shape,
      reply: buildNonArboxClassChangeTeamHandoffReply(opts.inbound),
      modelUsed: "closed_playbook_class_cancel_team_handoff",
      notifyHumanRequested: true,
      source: "default",
    };
  }
  const notifyHumanRequested = intent.shape === "action";
  if (fact) {
    return {
      category: intent.category,
      shape: intent.shape,
      reply: fact,
      modelUsed: closedPlaybookModelUsed(intent.category, "fact"),
      notifyHumanRequested,
      source: "fact",
    };
  }

  return {
    category: intent.category,
    shape: intent.shape,
    reply: buildClosedPlaybookDefaultReply(intent.category, botName),
    modelUsed: closedPlaybookModelUsed(intent.category, "default"),
    notifyHumanRequested: intent.category === "class_cancel" ? intent.shape === "action" : true,
    source: "default",
  };
}
