import assert from "node:assert/strict";
import {
  OPENING_SERVICE_LIST_PICK_BRIDGE,
  assistantReplyMentionsCatalogService,
  ensureOpeningServiceListPickBridge,
  shouldAttachOpeningServiceListPickBridge,
} from "@/lib/wa-opening-service-list-pick-bridge";

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

console.log("wa-opening-service-list-pick-bridge.test.ts: ok");
