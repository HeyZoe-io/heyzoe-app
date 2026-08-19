import assert from "node:assert/strict";
import { matchesClassRescheduleUpdate } from "@/lib/wa-class-reschedule";
import { isFreezeBillingAccountDispute } from "@/lib/wa-freeze-billing-handoff";
import { matchesOutOfScopeTeamHandoff } from "@/lib/wa-out-of-scope-handoff";
import { matchesRunningLateStatusUpdate } from "@/lib/wa-running-late";
import {
  CLOSED_PLAYBOOK_CANCELLATION_REPLY,
  CLOSED_PLAYBOOK_COACH_OWNER_REPLY,
  CLOSED_PLAYBOOK_COMPLAINT_REPLY,
  CLOSED_PLAYBOOK_DISCOUNT_NO_PROMO_REPLY,
  CLOSED_PLAYBOOK_FREEZE_REPLY,
  CLOSED_PLAYBOOK_GROUP_REPLY,
  CLOSED_PLAYBOOK_MEDICAL_REPLY,
  CLOSED_PLAYBOOK_REFUND_REPLY,
  detectClosedPlaybookIntent,
  resolveClosedPlaybook,
} from "@/lib/wa-closed-playbook";
import { findMatchingGroupCatalogProduct, findRelevantActivePromo, leadFacingFactText, lookupPlaybookFact } from "@/lib/wa-closed-playbook-facts";
import { userRequestedHumanAgent } from "@/lib/notifications/detect-human-request";

function cat(raw: string) {
  return detectClosedPlaybookIntent(raw);
}

// --- must not steal ---
const nearMisses = [
  "נרשמתי",
  "נרשמתי לשיעור ניסיון",
  "אשמח לפרטים על שיעור ניסיון",
  "היי, איך אני יכולה להירשם לשיעור ניסיון?",
  "רוצה להירשם לשיעור ניסיון",
  "איך נרשמים",
  "אני רוצה להירשם",
  "כמה עולה",
  "כמה עולה מנוי",
  "לא מרגיש טוב",
  "לא מרגישה טוב",
  "חולה",
  "לא בטוב",
  "מתי יש אימון ברביעי",
];
for (const m of nearMisses) {
  assert.equal(cat(m), null, `must not steal: ${m}`);
}
assert.equal(cat("איחרתי, אני בדרך"), null);
assert.equal(matchesRunningLateStatusUpdate("איחרתי, אני בדרך"), true);

// --- 1 reschedule ---
assert.equal(cat("החלפתי לשיעור של חמישי")?.category, "reschedule");
assert.equal(cat("החלפתי לשיעור של חמישי")?.shape, "action");
assert.equal(matchesClassRescheduleUpdate("החלפתי לשיעור של חמישי"), true);
assert.equal(cat("אפשר לדחות שיעור?")?.category, "reschedule");
assert.equal(cat("אפשר לדחות שיעור?")?.shape, "policy");
assert.equal(matchesClassRescheduleUpdate("אפשר לדחות שיעור?"), false);
assert.equal(cat("איך משנים מועד לשיעור?")?.shape, "policy");

// --- 2 cancellation (split out of reschedule) ---
assert.equal(matchesClassRescheduleUpdate("אני רוצה לבטל את ההרשמה שלי"), false);
assert.equal(cat("אני רוצה לבטל את ההרשמה שלי")?.category, "cancellation");
assert.equal(cat("אני רוצה לבטל את ההרשמה שלי")?.shape, "action");
assert.equal(cat("תבטלי לי את ההרשמה")?.shape, "action");
assert.equal(cat("אני רוצה לבטל את המנוי")?.category, "cancellation");
assert.equal(cat("אני רוצה לבטל את המנוי")?.shape, "action");
assert.equal(cat("מה מדיניות הביטול")?.category, "cancellation");
assert.equal(cat("מה מדיניות הביטול")?.shape, "policy");
assert.equal(cat("איך מבטלים מנוי")?.category, "cancellation");
assert.equal(cat("איך מבטלים מנוי")?.shape, "policy");
assert.equal(cat("אפשר לבטל מנוי?")?.shape, "policy");
assert.equal(cat("אפשר לבטל לי את המנוי?")?.shape, "action");

// --- 3 freeze (not billing dispute) ---
assert.equal(isFreezeBillingAccountDispute("אפשר להקפיא את המנוי?"), false);
assert.equal(cat("אפשר להקפיא את המנוי?")?.category, "freeze");
assert.equal(cat("אפשר להקפיא את המנוי?")?.shape, "policy");
assert.equal(cat("תקפיאי לי את המנוי")?.shape, "action");
assert.equal(cat("מה מדיניות ההקפאה")?.shape, "policy");
assert.equal(isFreezeBillingAccountDispute("לא הקפאתם לי את המנוי"), true);

// --- 4 refund ---
assert.equal(cat("אני רוצה החזר")?.category, "refund");
assert.equal(cat("אני רוצה החזר")?.shape, "action");
assert.equal(cat("תחזיר לי כסף")?.shape, "action");
assert.equal(cat("מה מדיניות ההחזרים")?.shape, "policy");
assert.equal(cat("אפשר לקבל החזר?")?.shape, "policy");

// --- 5 medical ---
assert.equal(cat("יש לי פציעה בברך, אפשר להתאמן?")?.category, "medical");
assert.equal(cat("יש לי פציעה בברך, אפשר להתאמן?")?.shape, "policy");
assert.equal(cat("אני אחרי שיקום ורוצה שהצוות ידעו")?.category, "medical");
assert.equal(cat("לא מרגיש טוב"), null);

// --- 6 complaint ---
assert.equal(cat("יש לי תלונה על המאמנת")?.category, "complaint");
assert.equal(cat("יש לי תלונה על המאמנת")?.shape, "action");
assert.equal(cat("החוויה הייתה גרועה")?.category, "complaint");
assert.equal(cat("המקום מלוכלך")?.category, "complaint");

// --- 7 group ---
assert.equal(cat("רוצים סדנה פרטית לחברה")?.category, "group");
assert.equal(cat("יום גיבוש לצוות מהעבודה")?.category, "group");
assert.equal(cat("יש לכם private workshop for our team?")?.category, "group");
assert.equal(cat("אירוע לחברה")?.category, "group");
assert.equal(cat("אירוע לחברה")?.shape, "action");

const joeCatalog = [
  { name: "קורס אקרויוגה אונליין" },
  { name: "סדנאות ואירועים מיוחדים" },
  { name: "עמידות ידיים / גמישות" },
  { name: "אקרו יוגה - ליחיד" },
  { name: "אקרו יוגה - לזוג" },
  { name: "שיעור אקרו אישי (1 - 1)" },
];
assert.equal(findMatchingGroupCatalogProduct("אירוע לחברה", joeCatalog), "סדנאות ואירועים מיוחדים");
assert.equal(
  findMatchingGroupCatalogProduct("אירוע לחברה", [{ name: "אקרו יוגה - סדנת היכרות" }, { name: "אקרו יוגה - לזוג" }]),
  null,
  "intro workshop is not an org-event product"
);

const joeGroup = resolveClosedPlaybook({
  inbound: "אירוע לחברה",
  knowledge: {
    botName: "זואי",
    salesFlowServices: joeCatalog,
    knowledgeQa: [{ question: "אירוע חברה", answer: "עובדת גיבוש מה-FAQ" }],
  },
});
assert.equal(joeGroup?.source, "catalog");
assert.equal(joeGroup?.catalogServiceName, "סדנאות ואירועים מיוחדים");
assert.equal(joeGroup?.notifyHumanRequested, false);
assert.equal(joeGroup?.modelUsed, "closed_playbook_catalog_group");

const groupFactOnly = resolveClosedPlaybook({
  inbound: "אירוע לחברה",
  knowledge: {
    knowledgeQa: [{ question: "אירוע חברה", answer: "סדנאות גיבוש בתיאום עם הצוות" }],
  },
});
assert.equal(groupFactOnly?.source, "fact");
assert.match(groupFactOnly?.reply ?? "", /גיבוש/);
assert.equal(groupFactOnly?.notifyHumanRequested, true);

const groupDefault = resolveClosedPlaybook({
  inbound: "אירוע לחברה",
  knowledge: { botName: "זואי", salesFlowServices: [{ name: "אקרו יוגה - ליחיד" }] },
});
assert.equal(groupDefault?.source, "default");
assert.equal(groupDefault?.reply, CLOSED_PLAYBOOK_GROUP_REPLY);
assert.equal(groupDefault?.notifyHumanRequested, true);

// --- promo / discount ---
assert.equal(cat("תעשי לי הנחה")?.category, "discount");
assert.equal(cat("אפשר מחיר יותר זול?")?.category, "discount");
assert.equal(cat("כמה עולה"), null);

// --- 8 coach/owner before generic human ---
assert.equal(cat("אפשר לדבר עם המאמנת?")?.category, "coach_owner");
assert.equal(cat("תעבירי לבעלים")?.category, "coach_owner");
assert.equal(cat("רוצה לדבר עם בעל העסק")?.category, "coach_owner");
assert.equal(userRequestedHumanAgent("אפשר לדבר עם המאמנת?"), true);
assert.equal(cat("אני רוצה נציג"), null);
assert.equal(userRequestedHumanAgent("אני רוצה נציג"), true);
assert.equal(cat("אפשר לדבר עם נציג"), null);
assert.equal(userRequestedHumanAgent("אפשר לדבר עם נציג"), true);
assert.equal(cat("מענה אנושי"), null);
assert.equal(userRequestedHumanAgent("מענה אנושי"), true);

// --- 9 off-topic stays outside dispatcher ---
assert.equal(cat("אשלח לך קבלה מעודכנת"), null);
assert.equal(matchesOutOfScopeTeamHandoff("אשלח לך קבלה מעודכנת"), true);

// --- facts: policy + fact = no notify; action + fact = notify ---
const freezeFactKnowledge = {
  botName: "זואי",
  knowledgeQa: [
    {
      question: "הקפאת מנוי",
      answer: 'ניתן להקפיא את המנוי עד 14 ימים על כל חצי שנה',
    },
  ],
};
const freezePolicy = resolveClosedPlaybook({
  inbound: "אפשר להקפיא את המנוי?",
  knowledge: freezeFactKnowledge,
});
assert.equal(freezePolicy?.source, "fact");
assert.equal(freezePolicy?.notifyHumanRequested, false);
assert.match(freezePolicy?.reply ?? "", /14 ימים/);

const freezeAction = resolveClosedPlaybook({
  inbound: "תקפיאי לי את המנוי",
  knowledge: freezeFactKnowledge,
});
assert.equal(freezeAction?.notifyHumanRequested, true);
assert.match(freezeAction?.reply ?? "", /14 ימים/);

const freezeNoFact = resolveClosedPlaybook({
  inbound: "אפשר להקפיא את המנוי?",
  knowledge: { botName: "זואי", knowledgeQa: [] },
});
assert.equal(freezeNoFact?.source, "default");
assert.equal(freezeNoFact?.notifyHumanRequested, true);
assert.equal(freezeNoFact?.reply, CLOSED_PLAYBOOK_FREEZE_REPLY);

const cancelNoFact = resolveClosedPlaybook({
  inbound: "תבטלי לי את ההרשמה",
  knowledge: { botName: "לימי" },
});
assert.equal(cancelNoFact?.reply, CLOSED_PLAYBOOK_CANCELLATION_REPLY);
assert.equal(cancelNoFact?.notifyHumanRequested, true);

const rescheduleNoFact = resolveClosedPlaybook({
  inbound: "החלפתי לשיעור של חמישי",
  knowledge: { botName: "לימי" },
});
assert.equal(rescheduleNoFact?.reply, "היי! כאן לימי, אני אעביר את הפנייה שלך לצוות!");
assert.equal(rescheduleNoFact?.notifyHumanRequested, true);
assert.equal(rescheduleNoFact?.modelUsed, "class_reschedule_team_handoff");

const reschedulePolicyFact = resolveClosedPlaybook({
  inbound: "אפשר לדחות שיעור?",
  knowledge: {
    botName: "זואי",
    knowledgeQa: [{ question: "דחיית שיעור", answer: "ניתן לדחות עד 12 שעות מראש" }],
  },
});
assert.equal(reschedulePolicyFact?.notifyHumanRequested, false);
assert.match(reschedulePolicyFact?.reply ?? "", /12 שעות/);

// quoted fact → inner text only
assert.equal(leadFacingFactText('פנימי: ״שלום לליד״'), "שלום לליד");
const quoted = resolveClosedPlaybook({
  inbound: "מה מדיניות הביטול",
  knowledge: {
    knowledgeQa: [{ question: "ביטול מנוי", answer: 'הוראה פנימית ״מבטלים עד 24 שעות לפני״' }],
  },
});
assert.equal(quoted?.reply, "מבטלים עד 24 שעות לפני");
assert.equal(quoted?.notifyHumanRequested, false);

assert.equal(lookupPlaybookFact("freeze", freezeFactKnowledge)?.includes("14"), true);
assert.equal(lookupPlaybookFact("cancellation", freezeFactKnowledge), null);

// --- promo relevance ---
assert.equal(
  findRelevantActivePromo("תעשי לי הנחה על המנוי", "20% הנחה על מנוי שנתי"),
  "20% הנחה על מנוי שנתי"
);
assert.equal(findRelevantActivePromo("תעשי לי הנחה על המנוי", "ניסיון ב-50 שח"), null);
assert.equal(findRelevantActivePromo("תעשי לי הנחה", "20% הנחה על מנוי שנתי"), null);

const discountWithPromo = resolveClosedPlaybook({
  inbound: "תעשי לי הנחה על המנוי",
  knowledge: { promotionsText: "20% הנחה על מנוי שנתי" },
});
assert.equal(discountWithPromo?.source, "promo");
assert.equal(discountWithPromo?.notifyHumanRequested, false);

const discountNoPromo = resolveClosedPlaybook({
  inbound: "תעשי לי הנחה",
  knowledge: { promotionsText: "20% הנחה על מנוי שנתי" },
});
assert.equal(discountNoPromo?.reply, CLOSED_PLAYBOOK_DISCOUNT_NO_PROMO_REPLY);
assert.equal(discountNoPromo?.notifyHumanRequested, true);

const coach = resolveClosedPlaybook({
  inbound: "אפשר לדבר עם המאמנת?",
  knowledge: { botName: "זואי" },
});
assert.equal(coach?.reply, CLOSED_PLAYBOOK_COACH_OWNER_REPLY);
assert.equal(coach?.notifyHumanRequested, true);

assert.equal(
  resolveClosedPlaybook({ inbound: "יש לי תלונה על המאמנת", knowledge: {} })?.reply,
  CLOSED_PLAYBOOK_COMPLAINT_REPLY
);
assert.equal(
  resolveClosedPlaybook({ inbound: "רוצים סדנה פרטית לחברה", knowledge: {} })?.reply,
  CLOSED_PLAYBOOK_GROUP_REPLY
);
assert.equal(
  resolveClosedPlaybook({ inbound: "יש לי פציעה בברך, אפשר להתאמן?", knowledge: {} })?.reply,
  CLOSED_PLAYBOOK_MEDICAL_REPLY
);
assert.equal(
  resolveClosedPlaybook({ inbound: "אני רוצה החזר", knowledge: {} })?.reply,
  CLOSED_PLAYBOOK_REFUND_REPLY
);

console.log("wa-closed-playbook.test.ts: ok");
