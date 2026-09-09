import assert from "node:assert/strict";
import {
  OPENING_SERVICE_LIST_PICK_BRIDGE,
  assistantReplyMentionsCatalogService,
  buildAmbiguousCatalogTrialPickMessage,
  ensureOpeningServiceListPickBridge,
  inboundLooksLikeTrialClassRegistrationPick,
  resolveAssistantRecommendedOtherCatalogService,
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

const ikmaNames = [
  "קרב מגע לילדים",
  "קרב מגע לנוער",
  "תהליך ירידה במשקל",
  "אימון אישי",
  "אימון זוגי",
];

assert.deepEqual(
  resolveAssistantRecommendedOtherCatalogService({
    assistantReply:
      "בן 11 זה בדיוק בטווח של קרב מגע לנוער 🙂 האימונים לנוער בגילאי 9-12 הם: מסלול אקדמיה לנוער. מתי נוח לך להגיע?",
    lastPickedServiceName: "קרב מגע לילדים",
    serviceNames: ikmaNames,
  }),
  { mode: "switch", serviceName: "קרב מגע לנוער" },
  "Zoe named youth after kids pick → switch, do not keep kids schedule"
);

assert.deepEqual(
  resolveAssistantRecommendedOtherCatalogService({
    assistantReply:
      "לקרב מגע לנוער היום (רביעי) יש שיעור ב17:30. אפשר להגיע ללא צורך ברישום מראש!",
    lastPickedServiceName: "קרב מגע לילדים",
    serviceNames: ikmaNames,
  }),
  { mode: "switch", serviceName: "קרב מגע לנוער" },
  "today-at-17:30 youth rec after kids pick → switch"
);

assert.equal(
  resolveAssistantRecommendedOtherCatalogService({
    assistantReply: "בכל עת! נשמח לראותכם היום בשיעור.",
    lastPickedServiceName: "קרב מגע לילדים",
    serviceNames: ikmaNames,
  }),
  null,
  "thanks closing without another catalog name → no switch"
);

assert.deepEqual(
  resolveAssistantRecommendedOtherCatalogService({
    assistantReply: "קרב מגע לילדים זה לגילאי 6-8. בגיל 11 מתאים קרב מגע לנוער.",
    lastPickedServiceName: "קרב מגע לילדים",
    serviceNames: ikmaNames,
  }),
  { mode: "switch", serviceName: "קרב מגע לנוער" },
  "current + one other named → still switch to the other product"
);

assert.deepEqual(
  resolveAssistantRecommendedOtherCatalogService({
    assistantReply: "אפשר קרב מגע לנוער או תהליך ירידה במשקל, לפי מה שנוח.",
    lastPickedServiceName: "קרב מגע לילדים",
    serviceNames: ikmaNames,
  }),
  { mode: "ambiguous" },
  "two other catalog names → product pick, not kids schedule"
);

assert.equal(
  resolveAssistantRecommendedOtherCatalogService({
    assistantReply: "בן 11 זה בדיוק בטווח של קרב מגע לנוער",
    lastPickedServiceName: null,
    serviceNames: ikmaNames,
  }),
  null,
  "no last pick → opening bridge handles this"
);

console.log("wa-opening-service-list-pick-bridge.test.ts: ok");
