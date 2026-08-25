import assert from "node:assert/strict";
import {
  isCasualHiGreeting,
  isCasualHowAreYouGreeting,
  isSalesFlowStartTrigger,
  matchesSalesFlowRestartIntent,
  buildCasualHiGreetingReply,
  CASUAL_HOW_ARE_YOU_REPLY_HE,
  isOpeningServicePickMenuModel,
  salesFlowGreetingMarkerCountsAsStarted,
  sessionCountsAsSalesFlowStarted,
} from "@/lib/sales-flow-start-triggers";

assert.equal(isSalesFlowStartTrigger("היי"), false);
assert.equal(isSalesFlowStartTrigger("היי", { slug: "info-2815" }), true);
assert.equal(isSalesFlowStartTrigger("היי!", { slug: "info-2815" }), true);
assert.equal(isSalesFlowStartTrigger("היי", { businessName: "סאנגה יוגה" }), true);
assert.equal(isSalesFlowStartTrigger("היי", { slug: "limitless" }), false);
assert.equal(isSalesFlowStartTrigger("שלום"), false);
assert.equal(isSalesFlowStartTrigger("hi"), false);
assert.equal(isSalesFlowStartTrigger("אשמח לפרטים"), true);
assert.equal(isSalesFlowStartTrigger("הצטרפות למנוי"), true);
assert.equal(isSalesFlowStartTrigger("אשמח לשמוע פרטים"), true);
assert.equal(isSalesFlowStartTrigger("אפשר פרטים?"), true);
assert.equal(isSalesFlowStartTrigger("אשמח למידע"), true);
assert.equal(isSalesFlowStartTrigger("פרטים"), true);
assert.equal(isSalesFlowStartTrigger("רוצה פרטים"), true);
assert.equal(isSalesFlowStartTrigger("מהתחלה"), true);
assert.equal(isSalesFlowStartTrigger("התחלה"), true);
assert.equal(isSalesFlowStartTrigger("להתחיל מהתחלה"), true);
assert.equal(isSalesFlowStartTrigger("היי אפשר להתחיל את התפריט מהתחלה"), true);
assert.equal(isSalesFlowStartTrigger("אפשר מהתחלה?"), true);
assert.equal(isSalesFlowStartTrigger("להתחיל מחדש"), true);
assert.equal(isSalesFlowStartTrigger("אפשר להתחיל מהתחלה"), true);
assert.equal(isSalesFlowStartTrigger("אפשר להתחיל מחדש"), true);
assert.equal(isSalesFlowStartTrigger("נתחיל מחדש"), true);
assert.equal(isSalesFlowStartTrigger("בוא נתחיל מהתחלה"), true);
assert.equal(matchesSalesFlowRestartIntent("היי אפשר להתחיל את התפריט מהתחלה"), true);
assert.equal(matchesSalesFlowRestartIntent("אפשר מהתחלה?"), true);
assert.equal(matchesSalesFlowRestartIntent("להתחיל מחדש"), true);
assert.equal(matchesSalesFlowRestartIntent("להתחיל מהתחלה"), true);
assert.equal(matchesSalesFlowRestartIntent("מהתחלה זה היה קשה לי"), false);
assert.equal(matchesSalesFlowRestartIntent("רוצה להתחיל אימון"), false);
assert.equal(isSalesFlowStartTrigger("רוצה להתחיל אימון"), false);
assert.equal(isSalesFlowStartTrigger("בואו נתחיל"), true);
assert.equal(isSalesFlowStartTrigger("בואו נתחיל!"), true);
assert.equal(isSalesFlowStartTrigger("היי אשמח לפרטים"), true);
assert.equal(isSalesFlowStartTrigger("היי פרטים"), true);
assert.equal(isSalesFlowStartTrigger("תודה"), false);
assert.equal(isSalesFlowStartTrigger("תודה רבה"), false);
assert.equal(isSalesFlowStartTrigger("ok"), false);

assert.equal(isCasualHiGreeting("היי"), true);
assert.equal(isCasualHiGreeting("היי!"), true);
assert.equal(isCasualHiGreeting("  היי  "), true);
assert.equal(isCasualHiGreeting("היי אשמח לפרטים"), false);
assert.equal(isCasualHiGreeting("שלום"), false);
assert.equal(isCasualHowAreYouGreeting("היי מה קורה"), true);
assert.equal(isCasualHowAreYouGreeting("היי מה קורה?"), true);
assert.equal(isCasualHowAreYouGreeting("מה נשמע"), true);
assert.equal(isCasualHowAreYouGreeting("מה המצב"), true);
assert.equal(isCasualHowAreYouGreeting("מה הולך"), true);
assert.equal(isCasualHowAreYouGreeting("מה העניינים"), true);
assert.equal(isCasualHowAreYouGreeting("אהלן מה נשמע"), true);
assert.equal(isCasualHowAreYouGreeting("מה קורה אצלך"), true);
assert.equal(isCasualHiGreeting("היי מה קורה"), true);
assert.equal(isCasualHowAreYouGreeting("היי"), false);
assert.equal(isCasualHowAreYouGreeting("היי מה קורה עם השיעור"), false);
assert.equal(isCasualHowAreYouGreeting("מה המצב עם ההרשמה"), false);
assert.equal(isSalesFlowStartTrigger("היי מה קורה"), false);
assert.equal(
  buildCasualHiGreetingReply("אלין", "Limitless"),
  "היי! כאן אלין, הבוטית של Limitless איך אפשר לעזור?"
);
assert.equal(
  buildCasualHiGreetingReply("", ""),
  "היי! כאן זואי, הבוטית של העסק איך אפשר לעזור?"
);
assert.equal(
  buildCasualHiGreetingReply("אלין", "Limitless", "היי מה קורה"),
  CASUAL_HOW_ARE_YOU_REPLY_HE
);
assert.equal(CASUAL_HOW_ARE_YOU_REPLY_HE, "היי! מעולה, איך אפשר לעזור?");

assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({ modelUsed: "greeting", precedingUserText: "תודה" }),
  true
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "default_opening",
    precedingUserText: "היי",
  }),
  false
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "default_opening",
    precedingUserText: "אשמח לפרטים",
  }),
  true
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "default_opening",
    precedingUserText: "יש איפה לשים אופניים?",
  }),
  false
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "registration_intent_no_member",
    precedingUserText: "רוצה להצטרף בשבת לפוואר אנד הייט",
  }),
  true
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "signup_intent_flow_entry",
    precedingUserText: "היי, איך אני יכולה להירשם לשיעור ניסיון?",
  }),
  true
);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "trial_topic_flow_entry",
    precedingUserText: "היי! רציתי לברר אם אפשר להצטרף לשיעור נסיון",
  }),
  true
);
assert.equal(isOpeningServicePickMenuModel("flow_continuation_opening_service_pick"), true);
assert.equal(isOpeningServicePickMenuModel("sales_flow_opening_service_pick_resend"), true);
assert.equal(isOpeningServicePickMenuModel("sales_flow_cs_redirect_service_pick"), true);
assert.equal(isOpeningServicePickMenuModel("greeting"), false);
assert.equal(
  salesFlowGreetingMarkerCountsAsStarted({
    modelUsed: "flow_continuation_opening_service_pick",
    precedingUserText: "אפשר לנסות שיעור יוגה היום?",
  }),
  true
);
assert.equal(
  sessionCountsAsSalesFlowStarted({
    greetingMarkerModel: null,
    precedingUserText: null,
    lastAssistantModel: "flow_continuation_opening_service_pick",
  }),
  true
);
assert.equal(
  sessionCountsAsSalesFlowStarted({
    greetingMarkerModel: null,
    precedingUserText: null,
    lastAssistantModel: "claude-haiku-4-5",
  }),
  false
);

console.log("sales-flow-start-triggers.test.ts: ok");
