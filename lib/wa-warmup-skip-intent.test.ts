import assert from "node:assert/strict";
import { detectClosedPlaybookIntent } from "@/lib/wa-closed-playbook-intents";
import {
  isJoinSignupIntentText,
  isWarmupSkipIntentText,
  shouldStartSalesFlowFromOutOfFlowSignup,
} from "@/lib/wa-warmup-skip-intent";

type Case = { text: string; phase: "opening" | "warmup" };

const mustSkip: Case[] = [
  { text: "רוצה להירשם", phase: "opening" },
  { text: "איך נרשמים?", phase: "warmup" },
  { text: "בוא נתקדם", phase: "opening" },
  { text: "לא רוצה לענות על שאלות", phase: "warmup" },
  { text: "רק רוצה פרטים", phase: "warmup" },
  { text: "רוצה אימון ניסיון", phase: "opening" },
  { text: "רוצה אימון היכרות", phase: "opening" },
  { text: "רוצה אימון הכרות", phase: "warmup" },
  { text: "איך מתחילים?", phase: "warmup" },
];

const mustNotSkip: Case[] = [
  { text: "רוצה להתחיל", phase: "opening" },
  { text: "איך מתחילים?", phase: "opening" },
  { text: "כמה עולה להירשם?", phase: "warmup" },
  { text: "יש לי שאלה", phase: "warmup" },
  { text: "כמה עולה?", phase: "opening" },
  { text: "מתי יש שיעורים?", phase: "warmup" },
];

for (const { text, phase } of mustSkip) {
  assert.equal(
    isWarmupSkipIntentText(text, phase),
    true,
    `expected skip: "${text}" (${phase})`
  );
}

for (const { text, phase } of mustNotSkip) {
  assert.equal(
    isWarmupSkipIntentText(text, phase),
    false,
    `expected no skip: "${text}" (${phase})`
  );
}

assert.equal(isJoinSignupIntentText("איך מתחילים?"), true, "CTA join: איך מתחילים");
assert.equal(isJoinSignupIntentText("כמה עולה להירשם?"), false, "CTA join trap: price");
assert.equal(isJoinSignupIntentText("היי, איך אני יכולה להירשם לשיעור ניסיון?"), true);
assert.equal(isJoinSignupIntentText("איך נרשמים"), true);
assert.equal(isJoinSignupIntentText("רוצה להירשם לשיעור ניסיון"), true);
assert.equal(isJoinSignupIntentText("אני רוצה להירשם"), true);
assert.equal(isJoinSignupIntentText("אשמח להירשם"), true);
assert.equal(isJoinSignupIntentText("אני רוצה לבטל את ההרשמה"), false, "cancel must not be join-signup");

const outOfFlowSignup = "היי, איך אני יכולה להירשם לשיעור ניסיון?";
assert.equal(detectClosedPlaybookIntent(outOfFlowSignup), null);
assert.equal(detectClosedPlaybookIntent("אני רוצה להירשם"), null);
assert.equal(detectClosedPlaybookIntent("רוצה להירשם לשיעור ניסיון"), null);
assert.equal(
  shouldStartSalesFlowFromOutOfFlowSignup({
    inbound: outOfFlowSignup,
    salesFlowStarted: false,
    trialRegistered: false,
    sessionPhase: null,
  }),
  true,
  "out-of-flow trial signup must enter product pick"
);
assert.equal(
  shouldStartSalesFlowFromOutOfFlowSignup({
    inbound: outOfFlowSignup,
    salesFlowStarted: true,
    trialRegistered: false,
    sessionPhase: "warmup",
  }),
  false,
  "already in-flow must not re-enter here"
);
assert.equal(
  shouldStartSalesFlowFromOutOfFlowSignup({
    inbound: "אני רוצה לבטל את ההרשמה",
    salesFlowStarted: false,
    trialRegistered: false,
    sessionPhase: null,
  }),
  false,
  "cancel must stay on closed playbook"
);
assert.equal(
  shouldStartSalesFlowFromOutOfFlowSignup({
    inbound: "אפשר לדחות שיעור?",
    salesFlowStarted: false,
    trialRegistered: false,
    sessionPhase: null,
  }),
  false,
  "reschedule must stay on closed playbook"
);

console.log("wa-warmup-skip-intent: extra join-signup / flow-entry assertions passed");
