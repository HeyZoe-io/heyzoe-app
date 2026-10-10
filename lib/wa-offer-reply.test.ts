import assert from "node:assert/strict";
import {
  FIND_CLASS_ASK_MODEL,
  FIND_CLASS_REASK_MODEL,
  isAffirmativeFindClassReply,
  isFindClassBridgeModel,
  isNegativeFindClassReply,
} from "@/lib/wa-interest-find-class";
import { CATALOG_FAMILY_PICK_MODEL } from "@/lib/wa-opening-service-list-pick-bridge";
import { LEAD_DAY_TRIAL_OFFER_MODEL } from "@/lib/wa-lead-day-trial";
import { TRY_CLASS_OFFER_MODEL, isExactTryClassOfferYes } from "@/lib/wa-try-class-offer";
import { CTA_SERVICE_REPICK_BRIDGE_QUESTION } from "@/lib/wa-cta-service-repick";
import {
  appendOfferReask,
  decideOfferReply,
  extractOfferReply,
  keywordFallbackOfferReply,
  offerReplyApplies,
  offerReplyPromptLine,
  resolvePendingOffer,
  type OfferPath,
  type PendingOffer,
} from "@/lib/wa-offer-reply";

function pending(path: OfferPath, alreadyReasked = false): PendingOffer {
  const resolved = resolvePendingOffer({
    modelsNewestFirst: [
      path === "find_class"
        ? alreadyReasked
          ? FIND_CLASS_REASK_MODEL
          : FIND_CLASS_ASK_MODEL
        : path === "try_class"
          ? TRY_CLASS_OFFER_MODEL
          : path === "lead_day_trial"
            ? LEAD_DAY_TRIAL_OFFER_MODEL
            : path === "catalog_family"
              ? CATALOG_FAMILY_PICK_MODEL
              : path === "service_repick"
                ? "cta_service_repick_hold"
                : "flow_continuation_opening_service_pick",
    ],
  });
  assert.ok(resolved, path);
  if (alreadyReasked && path !== "find_class") {
    return { ...resolved, alreadyReasked: true };
  }
  return resolved;
}

function decision(
  path: OfferPath,
  tag: string,
  inbound: string,
  alreadyReasked = false
) {
  const offer = pending(path, alreadyReasked);
  const parsed = extractOfferReply(tag ? `[[route:interest]]\n[[offer_reply:${tag}]]\nתשובה` : "תשובה בלי תג");
  return decideOfferReply({
    status: parsed.status,
    reply: parsed.reply,
    pending: offer,
    fallback: keywordFallbackOfferReply({ path, route: "interest", inbound }),
  });
}

const paths: OfferPath[] = [
  "find_class",
  "try_class",
  "lead_day_trial",
  "catalog_family",
  "service_repick",
  "service_menu",
];

for (const path of paths) {
  assert.equal(decision(path, "accept", "זה באזור הסופר פארם?").action, "accept", path);
  assert.equal(decision(path, "decline", "כן").action, "decline", path);
  assert.equal(decision(path, "question", "כן").action, "reask", path);
  assert.equal(decision(path, "question", "כן", true).action, "answer", path);
  assert.equal(decision(path, "unrelated", "כן").action, "keep", path);
  assert.equal(decision(path, "nope", "איזה שיעורים יש?").usedFallback, true, path);
}

assert.equal(offerReplyApplies({ interactiveId: "btn_yes" }), false);
assert.equal(offerReplyApplies({ interactiveId: "" }), true);
assert.equal(offerReplyApplies({}), true);

const superPharm = decision("find_class", "question", "זה באזור הסופר פארם?");
assert.equal(superPharm.action, "reask");
assert.equal(superPharm.reply, "question");
assert.equal(superPharm.usedFallback, false);

const classes = decision("find_class", "accept", "איזה שיעורים יש?");
assert.equal(classes.action, "accept");
assert.equal(classes.usedFallback, false);

const logs: unknown[] = [];
const original = console.info;
console.info = (...args: unknown[]) => {
  logs.push(args);
};
const missing = decision("find_class", "", "זה באזור הסופר פארם?");
console.info = original;
assert.equal(missing.usedFallback, true);
assert.equal(missing.action, "reask");
assert.ok(
  logs.some(
    (entry) =>
      Array.isArray(entry) &&
      entry[0] === "[offer_reply] fallback" &&
      (entry[1] as { path?: string }).path === "find_class"
  )
);

assert.equal(isAffirmativeFindClassReply("כן"), true);
assert.equal(isNegativeFindClassReply("לא"), true);
assert.equal(isExactTryClassOfferYes("כן"), true);
assert.equal(isExactTryClassOfferYes("אשמח לנסות שיעור"), false);
assert.equal(isFindClassBridgeModel(FIND_CLASS_REASK_MODEL), true);
assert.equal(isFindClassBridgeModel("interest_find_class_declined"), false);

const line = offerReplyPromptLine(FIND_CLASS_ASK_MODEL);
assert.ok(line.includes("[[offer_reply:accept]]"));
assert.ok(line.includes("[[offer_reply:question]]"));
assert.ok(line.length < 400);

assert.equal(
  appendOfferReask("כן, זה ליד הסופר פארם.", "רוצה שנמצא את השיעור המתאים עבורך?"),
  "כן, זה ליד הסופר פארם.\n\nרוצה שנמצא את השיעור המתאים עבורך?"
);
assert.equal(appendOfferReask("כבר שאלתי?", "כבר שאלתי?"), "כבר שאלתי?");

const kept = resolvePendingOffer({
  modelsNewestFirst: ["interest_answer_find_class_hold#route=answer;tag=ok", FIND_CLASS_ASK_MODEL],
});
assert.equal(kept?.path, "find_class");
assert.equal(kept?.alreadyReasked, false);

const cleared = resolvePendingOffer({
  modelsNewestFirst: ["interest_find_class_declined", FIND_CLASS_ASK_MODEL],
});
assert.equal(cleared, null);

const repick = resolvePendingOffer({
  modelsNewestFirst: ["claude-haiku-5-5"],
  lastAssistantContent: `מתאים למתחילות.\n\n${CTA_SERVICE_REPICK_BRIDGE_QUESTION}`,
});
assert.equal(repick?.path, "service_repick");
assert.equal(repick?.alreadyReasked, false);

console.log("wa-offer-reply.test.ts: ok");
