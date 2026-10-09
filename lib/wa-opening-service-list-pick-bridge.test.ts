import assert from "node:assert/strict";
import {
  OPENING_SERVICE_LIST_PICK_BRIDGE,
  assistantReplyMentionsCatalogService,
  buildAmbiguousCatalogTrialPickMessage,
  CATALOG_FAMILY_PICK_MODEL,
  CATALOG_FAMILY_PICK_QUESTION_HE,
  looksLikeOutOfFlowCatalogClassPick,
  ensureOpeningServiceListPickBridge,
  inboundLooksLikeTrialClassRegistrationPick,
  isAffirmativeCatalogFamilyConfirm,
  pendingServiceMenuReply,
  PENDING_SERVICE_MENU_NUDGE,
  resolveAmbiguousCatalogFamilyNames,
  resolveCatalogFamilyPickNames,
  resolveAssistantRecommendedOtherCatalogService,
  assistantConfirmedExistingBooking,
  shouldAttachOpeningServiceListPickBridge,
  shouldPromptAmbiguousCatalogTrialPick,
} from "@/lib/wa-opening-service-list-pick-bridge";
import { isOpeningServicePickMenuModel } from "@/lib/sales-flow-start-triggers";
import { matchCatalogServicesFromFreeText, matchCatalogServiceFromFreeText } from "@/lib/wa-unknown-class-slot";
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

const shiraReply =
  "כן 💜 את רשומה לשיעור ניסיון של פונקציונאלי נערות ביום ראשון בשעה 17:00. כל הפרטים נשלחו אלייך, וסופר מחכים לראותך!";
assert.equal(
  assistantConfirmedExistingBooking({ route: "registration_check", assistantReply: shiraReply }),
  true,
  "registration check answered yes → no sales flow"
);
assert.equal(
  assistantConfirmedExistingBooking({
    route: "registration_check",
    assistantReply: "כן, מקומך שמור ביום ראשון בשעה 17:00 לפונקציונאלי נערות 🙂",
  }),
  true
);
assert.equal(
  assistantConfirmedExistingBooking({
    route: "my_schedule",
    assistantReply: "האימון שלך ביום ראשון בשעה 17:00, את משובצת 💜",
  }),
  true
);
assert.equal(
  assistantConfirmedExistingBooking({
    route: "registration_check",
    assistantReply: "עדיין לא רשומה לשיעור, רוצה שנשריין לך מקום?",
  }),
  false,
  "registration check answered no → redirect may still run"
);
assert.equal(
  assistantConfirmedExistingBooking({ route: "answer", assistantReply: shiraReply }),
  false,
  "not a registration check → unchanged"
);
assert.equal(
  assistantConfirmedExistingBooking({ route: null, assistantReply: shiraReply }),
  false,
  "missing route tag → unchanged"
);

assert.equal(looksLikeOutOfFlowCatalogClassPick("פילאטיס מזרן"), true);
assert.equal(looksLikeOutOfFlowCatalogClassPick("פילאטיס"), true);
assert.equal(looksLikeOutOfFlowCatalogClassPick("יש פילאטיס?"), false, "info question");
assert.equal(looksLikeOutOfFlowCatalogClassPick("כמה עולה פילאטיס מזרן"), false);
assert.equal(CATALOG_FAMILY_PICK_QUESTION_HE, "האם זה האימון שמעניין אותך?");
assert.equal(CATALOG_FAMILY_PICK_MODEL, "sales_flow_catalog_family_pick");
assert.equal(isOpeningServicePickMenuModel(CATALOG_FAMILY_PICK_MODEL), true);

const sangaFamily = [
  svc("שיעור יוגה מתחילים"),
  svc("שיעור יוגה ממשיכים"),
  svc("שיעור יוגה מתקדמים"),
  svc("יוגה לכל הרמות"),
  svc("שיעור יוגה נשים"),
  svc("קורס מתחילים (8 מפגשים)"),
];
assert.equal(
  matchCatalogServiceFromFreeText("שיעור יוגה נשים", sangaFamily),
  "שיעור יוגה נשים"
);
assert.deepEqual(
  resolveAmbiguousCatalogFamilyNames({
    inboundText: "שיעור יוגה נשים",
    services: sangaFamily,
    awaitingOpeningServicePick: true,
  }),
  [],
  "exact women's yoga must not fall through to the yoga family menu"
);
assert.ok(
  resolveAmbiguousCatalogFamilyNames({
    inboundText: "רוצה יוגה",
    services: sangaFamily,
    awaitingOpeningServicePick: true,
  }).length >= 2,
  "bare yoga family still prompts"
);
assert.deepEqual(
  resolveCatalogFamilyPickNames({
    inboundText: "אני רוצה להירשם ל 1130 לאימון נערות",
    services: [
      { name: "נערות ה׳-ז׳" },
      { name: "נערות ח׳-יא׳" },
      { name: "Friday power" },
    ],
  }).sort(),
  ["נערות ה׳-ז׳", "נערות ח׳-יא׳"].sort(),
  "two classes sharing נערות are offered, not the whole catalog"
);
assert.equal(isAffirmativeCatalogFamilyConfirm("כן"), true);
assert.equal(isAffirmativeCatalogFamilyConfirm("כן!"), true);
assert.equal(isAffirmativeCatalogFamilyConfirm("שיעור יוגה נשים"), false);

assert.equal(
  pendingServiceMenuReply({
    inbound: "היי אשמח לשמוע מידע",
    body: "",
    menuPending: true,
  }),
  "nudge"
);
assert.equal(
  pendingServiceMenuReply({
    inbound: "כמה עולה?",
    body: "השיעור עולה 80 שקלים.",
    menuPending: true,
  }),
  "body"
);
assert.equal(
  pendingServiceMenuReply({
    inbound: "היי אשמח לשמוע מידע",
    body: "היי! שמחה לעזור",
    menuPending: true,
  }),
  "nudge"
);
assert.equal(
  pendingServiceMenuReply({
    inbound: "היי אשמח לשמוע מידע",
    body: "",
    menuPending: false,
  }),
  "body"
);
assert.match(PENDING_SERVICE_MENU_NUDGE, /מהרשימה למעלה/);

console.log("wa-opening-service-list-pick-bridge.test.ts: ok");
