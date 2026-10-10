/**
 * Pending-offer reply. Claude tags the latest message; keyword lists run only
 * when that tag is missing or invalid.
 */

import {
  CTA_SERVICE_REPICK_BRIDGE_QUESTION,
  CTA_SERVICE_REPICK_DECLINE_MODEL,
  CTA_SERVICE_REPICK_HOLD_MODEL,
  CTA_SERVICE_REPICK_REASK_HOLD_MODEL,
  CTA_SERVICE_REPICK_REASK_MODEL,
  replyContainsServiceRepickBridge,
  serviceRepickAlreadyReasked,
} from "@/lib/wa-cta-service-repick";
import {
  FIND_CLASS_ASK_MODEL,
  FIND_CLASS_BRIDGE_HE,
  FIND_CLASS_DECLINE_MODEL,
  FIND_CLASS_HOLD_MODEL,
  FIND_CLASS_REASK_HOLD_MODEL,
  FIND_CLASS_REASK_MODEL,
  findClassOfferAlreadyReasked,
  isAffirmativeFindClassReply,
  isFindClassBridgeModel,
  isNegativeFindClassReply,
  shouldReaskFindClassBridge,
} from "@/lib/wa-interest-find-class";
import {
  LEAD_DAY_TRIAL_DECLINE_REPLY,
  LEAD_DAY_TRIAL_DECLINED_MODEL,
  LEAD_DAY_TRIAL_HOLD_MODEL,
  LEAD_DAY_TRIAL_JOIN_QUESTION,
  LEAD_DAY_TRIAL_REASK_HOLD_MODEL,
  LEAD_DAY_TRIAL_REASK_MODEL,
  isLeadDayTrialOfferPending,
  leadDayTrialOfferAlreadyReasked,
} from "@/lib/wa-lead-day-trial";
import {
  CATALOG_FAMILY_DECLINE_MODEL,
  CATALOG_FAMILY_HOLD_MODEL,
  CATALOG_FAMILY_PICK_MODEL,
  CATALOG_FAMILY_PICK_QUESTION_HE,
  CATALOG_FAMILY_REASK_HOLD_MODEL,
  CATALOG_FAMILY_REASK_MODEL,
  catalogFamilyAlreadyReasked,
  isCatalogFamilyPendingModel,
  isConcreteServiceMenuQuestion,
} from "@/lib/wa-opening-service-list-pick-bridge";
import { modelUsedBase } from "@/lib/wa-reply-route";
import { OPENING_SERVICE_PICK_MENU_MODELS } from "@/lib/sales-flow-start-triggers";
import { looksLikeLeadQuestion } from "@/lib/wa-split-answer";
import {
  TRY_CLASS_OFFER_DECLINE_HE,
  TRY_CLASS_OFFER_DECLINE_MODEL,
  TRY_CLASS_OFFER_HOLD_MODEL,
  TRY_CLASS_OFFER_MODEL,
  TRY_CLASS_OFFER_QUESTION_HE,
  TRY_CLASS_OFFER_REASK_HOLD_MODEL,
  TRY_CLASS_OFFER_REASK_MODEL,
  assistantAskedToTryAClass,
  isTryClassOfferAffirmative,
  isTryClassOfferNegative,
  isTryClassOfferPendingModel,
  tryClassOfferAlreadyReasked,
} from "@/lib/wa-try-class-offer";

export const OFFER_REPLIES = ["accept", "decline", "question", "unrelated"] as const;
export type OfferReply = (typeof OFFER_REPLIES)[number];
export type OfferReplyStatus = "ok" | "missing" | "invalid";

export type OfferPath =
  | "find_class"
  | "try_class"
  | "lead_day_trial"
  | "catalog_family"
  | "service_repick"
  | "service_menu";

export type PendingOffer = {
  path: OfferPath;
  summary: string;
  alreadyReasked: boolean;
  reaskModel: string;
  holdModel: string;
  reaskHoldModel: string;
  declineModel: string;
  declineText: string;
};

export type ExtractedOfferReply = {
  reply: OfferReply | null;
  status: OfferReplyStatus;
  body: string;
};

export type OfferDecisionAction = "accept" | "decline" | "reask" | "answer" | "keep";

export type OfferDecision = {
  action: OfferDecisionAction;
  usedFallback: boolean;
  logModel: string | null;
  reply: OfferReply;
};

const OFFER_TAG_RE = /\[\[offer_reply:([a-z_]+)\]\]/i;

const CLEARING_MODELS = new Set([
  FIND_CLASS_DECLINE_MODEL,
  TRY_CLASS_OFFER_DECLINE_MODEL,
  LEAD_DAY_TRIAL_DECLINED_MODEL,
  CATALOG_FAMILY_DECLINE_MODEL,
  CTA_SERVICE_REPICK_DECLINE_MODEL,
  "opening_service_menu_declined",
  "signup_intent_flow_entry",
]);

const MENU_ASK_MODELS = new Set<string>(
  OPENING_SERVICE_PICK_MENU_MODELS.filter(
    (model) =>
      model !== CATALOG_FAMILY_PICK_MODEL &&
      model !== CATALOG_FAMILY_REASK_MODEL &&
      model !== CATALOG_FAMILY_HOLD_MODEL &&
      model !== CATALOG_FAMILY_REASK_HOLD_MODEL &&
      model !== "opening_service_menu_reask" &&
      model !== "opening_service_menu_hold" &&
      model !== "opening_service_menu_reask_hold"
  )
);

const SERVICE_MENU_SUMMARY = "בחרי את האימון שמעניין אותך מהרשימה";

function isOfferReply(value: string): value is OfferReply {
  return (OFFER_REPLIES as readonly string[]).includes(value);
}

function stripOfferTags(raw: string): string {
  return String(raw ?? "")
    .replace(/\[\[offer_reply:[a-z_]+\]\]/gi, "")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Button and list reply ids skip Claude. A missing id does not. */
export function offerReplyApplies(input: { interactiveId?: string | null }): boolean {
  return !String(input.interactiveId ?? "").trim();
}

export function extractOfferReply(raw: string): ExtractedOfferReply {
  const original = String(raw ?? "");
  const body = stripOfferTags(original);
  const match = OFFER_TAG_RE.exec(original);
  if (!match) {
    if (/\[\[offer_reply:/i.test(original)) return { reply: null, status: "invalid", body };
    return { reply: null, status: "missing", body };
  }
  const name = String(match[1] ?? "").toLowerCase();
  if (!isOfferReply(name)) return { reply: null, status: "invalid", body };
  return { reply: name, status: "ok", body };
}

/** One short line, appended only while an offer is pending. */
export function offerReplyPromptLine(summary: string): string {
  const offer = String(summary ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  return `הצעה שמחכה: «${offer}». שורה 2: [[offer_reply:accept]] קיבלה, [[offer_reply:decline]] סירבה, [[offer_reply:question]] שאלה קודם, [[offer_reply:unrelated]] לא קשור.`;
}

export function appendOfferReask(body: string, question: string): string {
  const answer = String(body ?? "").trim();
  const ask = String(question ?? "").trim();
  if (!answer) return ask;
  if (!ask || answer.includes(ask)) return answer;
  return `${answer}\n\n${ask}`;
}

function pendingShape(
  path: OfferPath,
  summary: string,
  alreadyReasked: boolean,
  models: { reask: string; hold: string; reaskHold: string; decline: string; declineText: string }
): PendingOffer {
  return {
    path,
    summary,
    alreadyReasked,
    reaskModel: models.reask,
    holdModel: models.hold,
    reaskHoldModel: models.reaskHold,
    declineModel: models.decline,
    declineText: models.declineText,
  };
}

function pendingFromBase(base: string): PendingOffer | null {
  if (base === FIND_CLASS_ASK_MODEL || base === FIND_CLASS_HOLD_MODEL || isFindClassBridgeModel(base)) {
    return pendingShape("find_class", FIND_CLASS_BRIDGE_HE, findClassOfferAlreadyReasked(base), {
      reask: FIND_CLASS_REASK_MODEL,
      hold: FIND_CLASS_HOLD_MODEL,
      reaskHold: FIND_CLASS_REASK_HOLD_MODEL,
      decline: FIND_CLASS_DECLINE_MODEL,
      declineText: "סבבה. אם תרצי לשאול עוד משהו, אני כאן.",
    });
  }
  if (isTryClassOfferPendingModel(base)) {
    return pendingShape("try_class", TRY_CLASS_OFFER_QUESTION_HE, tryClassOfferAlreadyReasked(base), {
      reask: TRY_CLASS_OFFER_REASK_MODEL,
      hold: TRY_CLASS_OFFER_HOLD_MODEL,
      reaskHold: TRY_CLASS_OFFER_REASK_HOLD_MODEL,
      decline: TRY_CLASS_OFFER_DECLINE_MODEL,
      declineText: TRY_CLASS_OFFER_DECLINE_HE,
    });
  }
  if (isLeadDayTrialOfferPending(base)) {
    return pendingShape("lead_day_trial", LEAD_DAY_TRIAL_JOIN_QUESTION, leadDayTrialOfferAlreadyReasked(base), {
      reask: LEAD_DAY_TRIAL_REASK_MODEL,
      hold: LEAD_DAY_TRIAL_HOLD_MODEL,
      reaskHold: LEAD_DAY_TRIAL_REASK_HOLD_MODEL,
      decline: LEAD_DAY_TRIAL_DECLINED_MODEL,
      declineText: LEAD_DAY_TRIAL_DECLINE_REPLY,
    });
  }
  if (isCatalogFamilyPendingModel(base)) {
    return pendingShape(
      "catalog_family",
      CATALOG_FAMILY_PICK_QUESTION_HE,
      catalogFamilyAlreadyReasked(base),
      {
        reask: CATALOG_FAMILY_REASK_MODEL,
        hold: CATALOG_FAMILY_HOLD_MODEL,
        reaskHold: CATALOG_FAMILY_REASK_HOLD_MODEL,
        decline: CATALOG_FAMILY_DECLINE_MODEL,
        declineText: "סבבה. אם תרצי לבחור אימון אחר, אני כאן.",
      }
    );
  }
  if (
    base === CTA_SERVICE_REPICK_REASK_MODEL ||
    base === CTA_SERVICE_REPICK_HOLD_MODEL ||
    base === CTA_SERVICE_REPICK_REASK_HOLD_MODEL
  ) {
    return pendingShape(
      "service_repick",
      CTA_SERVICE_REPICK_BRIDGE_QUESTION,
      serviceRepickAlreadyReasked(base),
      {
        reask: CTA_SERVICE_REPICK_REASK_MODEL,
        hold: CTA_SERVICE_REPICK_HOLD_MODEL,
        reaskHold: CTA_SERVICE_REPICK_REASK_HOLD_MODEL,
        decline: CTA_SERVICE_REPICK_DECLINE_MODEL,
        declineText: "סבבה, נשארים עם האימון שכבר נבחר.",
      }
    );
  }
  if (
    MENU_ASK_MODELS.has(base) ||
    base === "opening_service_menu_hold" ||
    base === "opening_service_menu_reask" ||
    base === "opening_service_menu_reask_hold"
  ) {
    const alreadyReasked = base === "opening_service_menu_reask" || base === "opening_service_menu_reask_hold";
    return pendingShape("service_menu", SERVICE_MENU_SUMMARY, alreadyReasked, {
      reask: "opening_service_menu_reask",
      hold: "opening_service_menu_hold",
      reaskHold: "opening_service_menu_reask_hold",
      decline: "opening_service_menu_declined",
      declineText: "סבבה. אם תרצי לבחור אימון, אני כאן.",
    });
  }
  return null;
}

function isPassThroughGeneration(base: string): boolean {
  if (!base) return true;
  return /claude|haiku|gemini|gpt|wa-generation|wa_generation/i.test(base);
}

/**
 * Newest assistant models first. These offers have no clock expiry: an unrelated
 * reply keeps the offer via a hold model, until decline, accept, or a newer
 * non-offer turn falls outside this lookback.
 */
export function resolvePendingOffer(input: {
  modelsNewestFirst: string[];
  lastAssistantContent?: string | null;
}): PendingOffer | null {
  const models = input.modelsNewestFirst.map((model) => modelUsedBase(model)).filter(Boolean);
  const content = String(input.lastAssistantContent ?? "");
  for (let i = 0; i < Math.min(models.length, 4); i += 1) {
    const base = models[i] ?? "";
    if (CLEARING_MODELS.has(base)) return null;
    const pending = pendingFromBase(base);
    if (pending) return pending;
    if (isPassThroughGeneration(base)) {
      if (i === 0 && assistantAskedToTryAClass(content)) return pendingFromBase(TRY_CLASS_OFFER_MODEL);
      if (i === 0 && replyContainsServiceRepickBridge(content)) {
        return pendingFromBase(CTA_SERVICE_REPICK_HOLD_MODEL);
      }
      continue;
    }
    return null;
  }
  if (!models.length && assistantAskedToTryAClass(content)) return pendingFromBase(TRY_CLASS_OFFER_MODEL);
  if (!models.length && replyContainsServiceRepickBridge(content)) {
    return pendingFromBase(CTA_SERVICE_REPICK_HOLD_MODEL);
  }
  return null;
}

/** Old keyword outcome, used only when the tag is missing or invalid. */
export function keywordFallbackOfferReply(input: {
  path: OfferPath;
  route: string | null;
  inbound: string;
}): OfferReply {
  const inbound = String(input.inbound ?? "");
  if (input.path === "find_class") {
    if (isNegativeFindClassReply(inbound)) return "decline";
    if (isAffirmativeFindClassReply(inbound)) return "accept";
    if (
      shouldReaskFindClassBridge({ route: input.route, inbound }) &&
      looksLikeLeadQuestion(inbound)
    ) {
      return "question";
    }
    if (input.route === "interest" || input.route === "signup") return "accept";
    return "unrelated";
  }
  if (input.path === "try_class") {
    if (isTryClassOfferNegative(inbound)) return "decline";
    if (isTryClassOfferAffirmative(inbound)) return "accept";
    if (looksLikeLeadQuestion(inbound)) return "question";
    return "unrelated";
  }
  if (input.path === "lead_day_trial" || input.path === "catalog_family" || input.path === "service_repick") {
    if (isNegativeFindClassReply(inbound) || isTryClassOfferNegative(inbound)) return "decline";
    if (isAffirmativeFindClassReply(inbound)) return "accept";
    if (looksLikeLeadQuestion(inbound)) return "question";
    if (input.route === "interest" || input.route === "signup") return "accept";
    return "unrelated";
  }
  if (isConcreteServiceMenuQuestion(inbound)) return "unrelated";
  if (looksLikeLeadQuestion(inbound)) return "question";
  return "question";
}

export function decideOfferReply(input: {
  status: OfferReplyStatus;
  reply: OfferReply | null;
  pending: PendingOffer;
  fallback: OfferReply;
}): OfferDecision {
  const usedFallback = input.status !== "ok" || input.reply == null;
  const reply: OfferReply = usedFallback ? input.fallback : input.reply ?? input.fallback;
  if (usedFallback) {
    console.info("[offer_reply] fallback", { path: input.pending.path });
  }
  if (reply === "accept") {
    return { action: "accept", usedFallback, logModel: null, reply };
  }
  if (reply === "decline") {
    return { action: "decline", usedFallback, logModel: input.pending.declineModel, reply };
  }
  if (reply === "question") {
    if (!input.pending.alreadyReasked) {
      return { action: "reask", usedFallback, logModel: input.pending.reaskModel, reply };
    }
    return { action: "answer", usedFallback, logModel: input.pending.reaskHoldModel, reply };
  }
  return {
    action: "keep",
    usedFallback,
    logModel: input.pending.alreadyReasked ? input.pending.reaskHoldModel : input.pending.holdModel,
    reply,
  };
}
