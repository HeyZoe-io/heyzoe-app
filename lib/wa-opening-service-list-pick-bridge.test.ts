import assert from "node:assert/strict";
import {
  OPENING_SERVICE_LIST_PICK_BRIDGE,
  assistantReplyMentionsCatalogService,
  buildAmbiguousCatalogTrialPickMessage,
  ensureOpeningServiceListPickBridge,
  inboundLooksLikeTrialClassRegistrationPick,
  shouldAttachOpeningServiceListPickBridge,
  shouldPromptAmbiguousCatalogTrialPick,
} from "@/lib/wa-opening-service-list-pick-bridge";
import { matchCatalogServicesFromFreeText } from "@/lib/wa-unknown-class-slot";
import type { SfServiceRow } from "@/lib/sf-service-rows";

const names = [
  "אימוני כוח - Strength",
  "Power&HIIT",
  "Power&HIIT Women",
  "Mobility Power",
  "כוח לנשים בלבד",
  "פילאטיס מכשירים",
];

assert.equal(
  shouldAttachOpeningServiceListPickBridge({
    phase: "opening",
    multiService: true,
    alreadyPickedService: false,
    inboundText: "לאימון strength עם אלין ב-9",
    assistantReply: "מושלם! אימוני כוח עם אלין זה בחירה מעולה 💪 יום שישי בשעה 09:00 זה פרפקט.",
    serviceNames: names,
  }),
  true,
  "inbound unique strength match → attach bridge"
);

assert.equal(
  shouldAttachOpeningServiceListPickBridge({
    phase: "opening",
    multiService: true,
    alreadyPickedService: false,
    inboundText: "כמה עולה שיעור ניסיון?",
    assistantReply: "המחיר הוא מחיר ניסיון לשיעור בודד",
    serviceNames: names,
  }),
  false,
  "price question without catalog name → no bridge"
);

assert.equal(
  shouldAttachOpeningServiceListPickBridge({
    phase: "opening",
    multiService: true,
    alreadyPickedService: false,
    inboundText: "נשמע טוב",
    assistantReply: "מושלם! אימוני כוח עם אלין זה בחירה מעולה 💪",
    serviceNames: names,
  }),
  true,
  "Claude named Strength uniquely → attach bridge"
);

assert.equal(
  shouldAttachOpeningServiceListPickBridge({
    phase: "cta",
    multiService: true,
    alreadyPickedService: false,
    inboundText: "לאימון strength עם אלין ב-9",
    assistantReply: "מושלם",
    serviceNames: names,
  }),
  false,
  "not in opening → no bridge"
);

assert.equal(
  shouldAttachOpeningServiceListPickBridge({
    phase: "opening",
    multiService: true,
    alreadyPickedService: true,
    inboundText: "לאימון strength עם אלין ב-9",
    assistantReply: "מושלם",
    serviceNames: names,
  }),
  false,
  "already picked → no bridge"
);

assert.equal(
  assistantReplyMentionsCatalogService(
    "מושלם! אימוני כוח עם אלין זה בחירה מעולה",
    "אימוני כוח - Strength"
  ),
  true
);

assert.equal(
  ensureOpeningServiceListPickBridge("מושלם!").includes(OPENING_SERVICE_LIST_PICK_BRIDGE),
  true
);

assert.equal(
  buildAmbiguousCatalogTrialPickMessage(3),
  "מצאתי 3 אימונים שתואמים לבחירה שלך, הכי כדאי לבחור מתוך הרשימה"
);

assert.equal(inboundLooksLikeTrialClassRegistrationPick("לאימון כוח עם אלין ב-9"), true);
assert.equal(inboundLooksLikeTrialClassRegistrationPick("רוצה להירשם לשיעור ניסיון"), true);
assert.equal(inboundLooksLikeTrialClassRegistrationPick("כמה עולה?"), false);

function svc(name: string): Pick<SfServiceRow, "name"> {
  return { name };
}

const ambiguousFamily = [
  svc("אקרו יוגה בוקר"),
  svc("אקרו יוגה ערב"),
  svc("פילאטיס מכשירים"),
];

const acroMatches = matchCatalogServicesFromFreeText("רוצה אקרו יוגה", ambiguousFamily);
assert.deepEqual(
  acroMatches.sort(),
  ["אקרו יוגה בוקר", "אקרו יוגה ערב"].sort(),
  "equal-score acro variants are ambiguous"
);

assert.equal(
  shouldPromptAmbiguousCatalogTrialPick({
    inboundText: "רוצה אקרו יוגה",
    matchCount: acroMatches.length,
    awaitingOpeningServicePick: true,
  }),
  true,
  "trial pick + multi match → ambiguous prompt"
);

assert.equal(
  shouldPromptAmbiguousCatalogTrialPick({
    inboundText: "כמה עולה אקרו?",
    matchCount: acroMatches.length,
    awaitingOpeningServicePick: true,
  }),
  false,
  "price question → no ambiguous prompt"
);

assert.equal(
  shouldPromptAmbiguousCatalogTrialPick({
    inboundText: "רוצה אקרו יוגה",
    matchCount: acroMatches.length,
    awaitingOpeningServicePick: false,
  }),
  false,
  "not awaiting pick → no ambiguous prompt"
);

console.log("wa-opening-service-list-pick-bridge.test.ts: ok");
