import assert from "node:assert/strict";
import {
  exactTypedCatalogServiceName,
  exactTypedCatalogSwitchTarget,
  resolveMidFlowCatalogSwitchTarget,
  isPhaseAgnosticExplicitServiceSwitch,
  isAmbiguousPartialCatalogServiceSwitch,
  isCatalogSpecificKnowledgeQuestion,
  findAmbiguousPartialCatalogMatches,
  resolveImplicitServiceSwitchFromFreeText,
  withServiceRepickAckPrefix,
  SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE,
} from "@/lib/wa-cta-service-repick";

const names = ["אקרו יוגה - סדנת היכרות", "אקרו יוגה - לזוג", "אקרו יוגה"];

assert.equal(exactTypedCatalogServiceName("אקרו יוגה - לזוג", names), "אקרו יוגה - לזוג");
assert.equal(exactTypedCatalogServiceName("  אקרו יוגה - לזוג  ", names), "אקרו יוגה - לזוג");
assert.equal(exactTypedCatalogServiceName("אקרו יוגה  -  לזוג", names), "אקרו יוגה - לזוג");

assert.equal(exactTypedCatalogServiceName("אקרו יוגה - לזוג בבקשה", names), null);
assert.equal(exactTypedCatalogServiceName("רוצה לעבור לאקרו יוגה - לזוג", names), null);
assert.equal(exactTypedCatalogServiceName("לזוג", names), null);
assert.equal(exactTypedCatalogServiceName("", names), null);

assert.equal(
  isPhaseAgnosticExplicitServiceSwitch("אקרו יוגה - לזוג", "אקרו יוגה - סדנת היכרות", names),
  false
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch(
    "רוצה לעבור לאקרו יוגה - לזוג",
    "אקרו יוגה - סדנת היכרות",
    names
  ),
  true
);

const limitless = [
  "אימוני כוח - Strength",
  "POWER&HIIT",
  "Mobility power",
  "מוביליטי וגמישות",
  "פילאטיס מכשירים",
  "פילאטיס מזרן",
  "אימון אישי",
  "עיסוי רפואי",
];

assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אני רוצה לנסות פילאטיס", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("יש פילאטיס?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("יש לכם פילאטיס", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("האם יש פילאטיס?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("פילאטיס?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אפשר פילאטיס?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אפשר לי פילאטיס", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אפשר לשלם בביט?", "אימון אישי", limitless),
  false
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("תגידי גם פילאטיס אצלכם", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("עיסוי רפואי", "אימון אישי", limitless),
  false,
  "exact closed catalog name is a direct switch, not an ambiguous menu reopen"
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("יש אצלכם עיסוי רפואי?", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch(
    "האם פילאטיס מתאים לנשים בהיריון?",
    "אימון אישי",
    limitless
  ),
  false
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("פילאטיס מתאים למתחילים?", "אימון אישי", limitless),
  false
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("פילאטיס?", "", limitless),
  false,
  "no prior pick — not mid-flow switch"
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch("אני רוצה לנסות פילאטיס", "אימון אישי", limitless),
  false
);
assert.deepEqual(findAmbiguousPartialCatalogMatches("פילאטיס", ["פילאטיס מכשירים"]), []);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("מה זה פילאטיס", "אימון אישי", limitless),
  false
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch("רוצה לעבור לפילאטיס מכשירים", "אימון אישי", limitless),
  true
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("רוצה לעבור לפילאטיס מכשירים", "אימון אישי", limitless),
  false
);

{
  const dashboard = "אשמח להבין ראשית איזה אימון מעניין אותך?";
  assert.equal(
    withServiceRepickAckPrefix(dashboard),
    `${SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE}\n${dashboard}`
  );
  assert.equal(
    withServiceRepickAckPrefix(`${SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE}\n${dashboard}`),
    `${SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE}\n${dashboard}`
  );
}

assert.equal(
  exactTypedCatalogSwitchTarget("אקרו יוגה - לזוג", "אקרו יוגה - סדנת היכרות", names),
  "אקרו יוגה - לזוג"
);
assert.equal(exactTypedCatalogSwitchTarget("אקרו יוגה - לזוג", "אקרו יוגה - לזוג", names), null);
assert.equal(exactTypedCatalogSwitchTarget("אקרו יוגה - לזוג", null, names), "אקרו יוגה - לזוג");
assert.equal(exactTypedCatalogSwitchTarget("אקרו יוגה - לזוג בבקשה", "אקרו יוגה", names), null);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("אקרו יוגה - לזוג", "אקרו יוגה - סדנת היכרות", names),
  false,
  "exact sibling acro name is not an ambiguous family token"
);

const joe = [
  "קורס אקרויוגה אונליין",
  "סדנאות ואירועים מיוחדים",
  "עמידות ידיים / גמישות",
  "אקרו יוגה - ליחיד",
  "אקרו יוגה - לזוג",
  "שיעור אקרו אישי (1 - 1)",
];
assert.equal(exactTypedCatalogServiceName("אקרו יוגה - לזוג", joe), "אקרו יוגה - לזוג");
assert.equal(exactTypedCatalogSwitchTarget("אקרו יוגה - לזוג", "אקרו יוגה - ליחיד", joe), "אקרו יוגה - לזוג");
assert.equal(isAmbiguousPartialCatalogServiceSwitch("אקרו יוגה - לזוג", "אקרו יוגה - ליחיד", joe), false);
assert.equal(isAmbiguousPartialCatalogServiceSwitch("פילאטיס", "אימון אישי", limitless), true);

assert.equal(isCatalogSpecificKnowledgeQuestion("העמידות ידיים זה שיעור קבוצתי??"), true);
assert.equal(isCatalogSpecificKnowledgeQuestion("עמידות ידיים זה אימון קבוצתי"), true);
assert.equal(isCatalogSpecificKnowledgeQuestion("זה קבוצתי או אישי?"), true);
assert.equal(
  isCatalogSpecificKnowledgeQuestion("רוצה אימון אישי"),
  false,
  "requesting a personal class is not a format question"
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch(
    "העמידות ידיים זה שיעור קבוצתי??",
    "אקרו יוגה - ליחיד",
    joe
  ),
  false,
  "asking if a named class is group is knowledge, not a product switch"
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("יש עמידות ידיים?", "אקרו יוגה - ליחיד", joe),
  true,
  "asking if they have another class still opens the menu"
);
assert.equal(
  resolveImplicitServiceSwitchFromFreeText({
    text: "העמידות ידיים זה שיעור קבוצתי??",
    lastPickedServiceName: "אקרו יוגה - ליחיד",
    services: joe.map((name) => ({ name })),
    awaitingServicePick: true,
  }),
  null
);

const sanga = [
  "שיעור יוגה מתחילים",
  "שיעור יוגה ממשיכים",
  "שיעור יוגה מתקדמים",
  "יוגה לכל הרמות",
  "שיעור יוגה נשים",
  "קורס מתחילים (8 מפגשים)",
];
assert.equal(
  isCatalogSpecificKnowledgeQuestion("כמה אנשים יש בשיעור?"),
  true,
  "class-size question is knowledge"
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("כמה אנשים יש בשיעור?", "שיעור יוגה מתקדמים", sanga),
  false,
  "אנשים must not match שיעור יוגה נשים via substring"
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch("כמה אנשים יש בשיעור?", "שיעור יוגה מתקדמים", sanga),
  false
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch(
    "לא מעניין אותי אימון אחר\nמעניין אותי לדעת כמה אנשים יש בשיעור",
    "שיעור יוגה מתקדמים",
    sanga
  ),
  false
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch(
    "לא מעניין אותי אימון אחר\nמעניין אותי לדעת כמה אנשים יש בשיעור",
    "שיעור יוגה מתקדמים",
    sanga
  ),
  false,
  "rejecting another class while asking class size is not a product switch"
);
assert.equal(
  isPhaseAgnosticExplicitServiceSwitch("רוצה שיעור יוגה נשים", "שיעור יוגה מתקדמים", sanga),
  true,
  "explicit request for the women's class still switches"
);
assert.equal(
  isAmbiguousPartialCatalogServiceSwitch("יש שיעור יוגה נשים?", "שיעור יוגה מתקדמים", sanga),
  true
);

{
  const limitlessMenu = [
    "אימוני כוח - Strength",
    "Power&HIIT",
    "Mobility Power",
    "כוח לנשים בלבד",
    "פילאטיס מכשירים (כסא)",
    "פילאטיס מזרן",
  ];
  assert.equal(
    resolveMidFlowCatalogSwitchTarget({
      inboundText: "פילאטיס מכשירים (כסא)",
      lastPickedServiceName: "Power&HIIT",
      serviceNames: limitlessMenu,
      isInteractiveReply: true,
    }),
    "פילאטיס מכשירים (כסא)",
    "tapping a previous service list row during schedule must switch product"
  );
  assert.equal(
    resolveMidFlowCatalogSwitchTarget({
      inboundText: "פילאטיס מכשירים (כסא)",
      lastPickedServiceName: "Power&HIIT",
      serviceNames: limitlessMenu,
      isInteractiveReply: false,
    }),
    "פילאטיס מכשירים (כסא)"
  );
  assert.equal(
    resolveMidFlowCatalogSwitchTarget({
      inboundText: "פילאטיס מכשירים (כסא)",
      lastPickedServiceName: null,
      serviceNames: limitlessMenu,
      isInteractiveReply: true,
    }),
    null,
    "first opening list_reply stays on the service-pick handler"
  );
  assert.equal(
    resolveMidFlowCatalogSwitchTarget({
      inboundText: "פילאטיס מכשירים (כסא)",
      lastPickedServiceName: null,
      serviceNames: limitlessMenu,
      isInteractiveReply: false,
    }),
    "פילאטיס מכשירים (כסא)"
  );
  assert.equal(
    resolveMidFlowCatalogSwitchTarget({
      inboundText: "יום שני ב18:30",
      lastPickedServiceName: "Power&HIIT",
      serviceNames: limitlessMenu,
      isInteractiveReply: true,
    }),
    null
  );
  assert.equal(
    resolveMidFlowCatalogSwitchTarget({
      inboundText: "בחירת אימון אחר",
      lastPickedServiceName: "Power&HIIT",
      serviceNames: limitlessMenu,
      isInteractiveReply: true,
    }),
    null
  );
  assert.equal(
    resolveMidFlowCatalogSwitchTarget({
      inboundText: "Power&HIIT",
      lastPickedServiceName: "Power&HIIT",
      serviceNames: limitlessMenu,
      isInteractiveReply: true,
    }),
    null,
    "re-tapping the current service is not a switch"
  );
}

console.log("wa-cta-service-repick.test.ts: ok");
