import assert from "node:assert/strict";
import { isJoinSignupIntentText, isWarmupSkipIntentText, shouldStartSalesFlowFromOutOfFlowSignup } from "@/lib/wa-warmup-skip-intent";
import {
  matchesTryClassIntent,
  shouldSendTryClassInfoOffer,
  shouldStartProductPickAfterTryClassOffer,
  shouldDeclineTryClassOffer,
  TRY_CLASS_OFFER_MODEL,
  TRY_CLASS_OFFER_QUESTION_HE,
} from "@/lib/wa-try-class-offer";

const miriamFirst = "היי, שלום.\nאפשר לנסות שיעור יוגה היום?";
const miriamTryTonight = "כן. אני אשמח לנסות היום בערב ב1930. \nאיפה חונים?";

assert.equal(matchesTryClassIntent(miriamFirst), true, "sanga: can I try yoga today");
assert.equal(matchesTryClassIntent(miriamTryTonight), true, "sanga: I'd like to try tonight");
assert.equal(matchesTryClassIntent("אשמח לנסות"), true);
assert.equal(matchesTryClassIntent("אני אשמח לנסות"), true);
assert.equal(matchesTryClassIntent("רוצה לנסות שיעור"), true);
assert.equal(matchesTryClassIntent("בא לי לנסות יוגה"), true);
assert.equal(matchesTryClassIntent("can I try a class"), true);

assert.equal(matchesTryClassIntent("כמה עולה לנסות?"), false, "price");
assert.equal(matchesTryClassIntent("מה זה שיעור ניסיון"), false);
assert.equal(matchesTryClassIntent("יש מצב לנסות לנסח לי שוב?"), false);
assert.equal(matchesTryClassIntent("רוצה להירשם לשיעור ניסיון"), false, "hard signup is not soft try");
assert.equal(matchesTryClassIntent("איפה חונים?"), false);

assert.equal(isJoinSignupIntentText(miriamFirst), false, "soft try must not skip the offer gate");
assert.equal(
  shouldStartSalesFlowFromOutOfFlowSignup({
    inbound: miriamFirst,
    salesFlowStarted: false,
    trialRegistered: false,
    sessionPhase: null,
  }),
  false,
  "out-of-flow soft try must not dump product pick"
);

assert.equal(
  shouldSendTryClassInfoOffer({
    inbound: miriamFirst,
    salesFlowStarted: false,
    trialRegistered: false,
    sessionPhase: "opening",
  }),
  true
);
assert.equal(
  shouldSendTryClassInfoOffer({
    inbound: miriamFirst,
    salesFlowStarted: true,
    trialRegistered: false,
    sessionPhase: "warmup",
  }),
  false,
  "already in-flow: warmup skip handles it"
);
assert.equal(
  shouldSendTryClassInfoOffer({
    inbound: miriamFirst,
    salesFlowStarted: false,
    trialRegistered: true,
    sessionPhase: "opening",
  }),
  false
);

assert.equal(isWarmupSkipIntentText(miriamFirst, "warmup"), true, "in-flow try-intent skips warmup");
assert.equal(isWarmupSkipIntentText("אשמח לנסות", "opening"), true);

assert.equal(
  shouldStartProductPickAfterTryClassOffer({
    inbound: "כן",
    lastAssistantModel: TRY_CLASS_OFFER_MODEL,
  }),
  true
);
assert.equal(
  shouldStartProductPickAfterTryClassOffer({
    inbound: "Да",
    lastAssistantModel: TRY_CLASS_OFFER_MODEL,
  }),
  true
);
assert.equal(
  shouldDeclineTryClassOffer({
    inbound: "לא",
    lastAssistantModel: TRY_CLASS_OFFER_MODEL,
  }),
  true
);
assert.equal(
  shouldStartProductPickAfterTryClassOffer({
    inbound: miriamTryTonight,
    lastAssistantModel: TRY_CLASS_OFFER_MODEL,
  }),
  true
);
assert.equal(
  shouldStartProductPickAfterTryClassOffer({
    inbound: "כן",
    lastAssistantModel: "claude-haiku-4-5",
  }),
  false,
  "bare yes only after the offer"
);
assert.equal(
  shouldDeclineTryClassOffer({
    inbound: "לא תודה",
    lastAssistantModel: TRY_CLASS_OFFER_MODEL,
  }),
  true
);
assert.equal(
  shouldStartProductPickAfterTryClassOffer({
    inbound: "לא תודה",
    lastAssistantModel: TRY_CLASS_OFFER_MODEL,
  }),
  false
);

assert.ok(TRY_CLASS_OFFER_QUESTION_HE.includes("מידע מסודר על השיעורים"));

console.log("wa-try-class-offer.test.ts: ok");
