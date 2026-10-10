import assert from "node:assert/strict";
import { knowledgeUpdateCardOutgoing } from "@/lib/knowledge-updates-run";
import {
  KNOWLEDGE_UPDATES_RECIPIENT_MODE,
  OWNER_REPLY_WINDOW_MS,
  acceptClassifiedPair,
  appendKnowledgeQa,
  coveredByKnowledge,
  deliverTargets,
  inboundAction,
  isoWeekKey,
  knowledgeUpdateDue,
  ownerReplyAddressesQuestion,
  pairHandoffWithOwnerReply,
  readGroundingVerdict,
  classifyOwnerFact,
  isTimeBoundFact,
  labelKnowledgePairs,
  mergeRuleStatements,
  ruleAgainstKnowledge,
  selectWeeklySuggestions,
  suggestionCardText,
  takeWeeklyCards,
  KNOWLEDGE_CARD_LIMIT,
  sendDecision,
  sessionActive,
  shouldWriteKnowledge,
  type ClassifiedPair,
} from "@/lib/knowledge-updates";

const hour = 60 * 60 * 1000;

assert.equal(
  pairHandoffWithOwnerReply({
    eventAt: 0,
    replies: [{ at: OWNER_REPLY_WINDOW_MS, text: "יש חניה ברחוב" }],
  }),
  "יש חניה ברחוב"
);
assert.equal(
  pairHandoffWithOwnerReply({
    eventAt: 0,
    replies: [{ at: OWNER_REPLY_WINDOW_MS + 1, text: "מאוחר" }],
  }),
  null
);
assert.equal(
  pairHandoffWithOwnerReply({
    eventAt: 1_000,
    replies: [{ at: 999, text: "לפני" }],
  }),
  null
);
assert.equal(
  pairHandoffWithOwnerReply({
    eventAt: 0,
    replies: [
      { at: hour, text: "יש חניה" },
      { at: hour + 10 * 60 * 1000, text: "מאחורי הבניין" },
    ],
  }),
  "יש חניה\nמאחורי הבניין"
);
assert.equal(
  pairHandoffWithOwnerReply({
    eventAt: 0,
    question: "יש חניה ליד הסטודיו?",
    replies: [
      { at: hour, text: "המנוי יסתיים בסוף החודש" },
      { at: hour + 30 * 60 * 1000, text: "יש חניה ברחוב" },
    ],
  }),
  null
);
assert.equal(ownerReplyAddressesQuestion("אימון ממוקד לנשים", "אימון ממוקד לנשים בא במסגרת אימון אישי"), true);
assert.equal(
  pairHandoffWithOwnerReply({
    eventAt: 0,
    question: "אשמח לפרטים לקרב מגע לנשים",
    replies: [
      { at: hour, text: "היי בוקר טוב אשמח שתחזור אליך" },
      { at: hour + 20 * 60 * 1000, text: "יש אצלנו קבוצת קרב מגע לנשים" },
    ],
  }),
  null
);
assert.equal(
  pairHandoffWithOwnerReply({
    eventAt: 0,
    question: "יש חניה ליד הסטודיו?",
    replies: [{ at: hour, text: "יש חניה ברחוב מאחורי הבניין" }],
  }),
  "יש חניה ברחוב מאחורי הבניין"
);

assert.equal(acceptClassifiedPair({ general: false, oneOff: false }), false);
assert.equal(acceptClassifiedPair({ general: true, oneOff: true }), false);
assert.equal(acceptClassifiedPair({ general: true, oneOff: false }), true);

const parking = (lead: string, cluster = "חניה"): ClassifiedPair => ({
  leadKey: lead,
  question: "יש חניה?",
  answer: "יש חניה חינם ברחוב",
  cluster,
  general: true,
  oneOff: false,
});

assert.equal(coveredByKnowledge("יש חניה חינם ברחוב", "חניה חינם ברחוב ליד הסטודיו"), true);
assert.equal(coveredByKnowledge("השיעור עולה שמונים שקל", "יש חניה חינם ברחוב"), false);

const oneLead = selectWeeklySuggestions([parking("a"), parking("a")], "");
assert.equal(oneLead.length, 1);

const covered = selectWeeklySuggestions(
  [parking("a"), parking("b")],
  "חניה חינם ברחוב ליד הסטודיו"
);
assert.equal(covered.length, 0);

const ranked = selectWeeklySuggestions(
  [
    parking("a", "חניה"),
    parking("b", "חניה"),
    parking("c", "חניה"),
    { ...parking("a", "מגבות"), question: "יש מגבות?", answer: "יש מגבות במלתחה" },
    { ...parking("b", "מגבות"), question: "יש מגבות?", answer: "יש מגבות במלתחה" },
    { ...parking("a", "מים"), question: "יש מים?", answer: "יש מים קרים בלובי" },
    { ...parking("b", "מים"), question: "יש מים?", answer: "יש מים קרים בלובי" },
    { ...parking("c", "מים"), question: "יש מים?", answer: "יש מים קרים בלובי" },
    { ...parking("d", "מים"), question: "יש מים?", answer: "יש מים קרים בלובי" },
    { ...parking("a", "נעליים"), question: "מה לנעול?", answer: "נעלי ספורט נקיות" },
    { ...parking("b", "נעליים"), question: "מה לנעול?", answer: "נעלי ספורט נקיות" },
  ],
  ""
);
assert.deepEqual(
  ranked.map((row) => row.question),
  ["יש מים?", "יש חניה?", "יש מגבות?"]
);
const labeled = labelKnowledgePairs(
  [
    parking("a"),
    { ...parking("b"), general: false, cluster: "אישי" },
    { ...parking("c"), general: true, oneOff: true, cluster: "טובה" },
    parking("d"),
    parking("e"),
  ],
  "חניה חינם ברחוב ליד הסטודיו"
);
assert.deepEqual(
  labeled.map((row) => row.reason),
  ["already covered", "personal", "one-off favor or private", "already covered", "already covered"]
);
const single = labelKnowledgePairs([parking("only")], "");
assert.equal(single[0]?.reason, "passed");
const mixed = selectWeeklySuggestions(
  [
    {
      leadKey: "a",
      question: "כמה עולה אימון אישי?",
      answer: "אימון אישי עולה מאתיים",
      cluster: "כללי",
      general: true,
      oneOff: false,
    },
    {
      leadKey: "b",
      question: "איך מבטלים הרשמה?",
      answer: "מבטלים באפליקציה עד שש שעות",
      cluster: "כללי",
      general: true,
      oneOff: false,
    },
    {
      leadKey: "c",
      question: "איך מבטלים הרשמה לאימון?",
      answer: "מבטלים באפליקציה עד שש שעות",
      cluster: "כללי",
      general: true,
      oneOff: false,
    },
  ],
  ""
);
const women = selectWeeklySuggestions(
  [
    {
      leadKey: "a",
      question: "אימון ממוקד לנשים",
      answer: "אימון ממוקד לנשים בא במסגרת אימון אישי",
      cluster: "נשים",
      general: true,
      oneOff: false,
    },
    {
      leadKey: "b",
      question: "אשמח לפרטים לקרב מגע לנשים",
      answer: "יש קבוצת קרב מגע מעורבת",
      cluster: "נשים",
      general: true,
      oneOff: false,
    },
  ],
  ""
);
assert.equal(women.length, 2);
assert.equal(women.some((row) => row.ownerAnswers.some((answer) => answer.includes("קרב") && answer.includes("אישי"))), false);
assert.equal(mixed.length, 2);
assert.match(mixed[0]!.question, /מבטלים/);
assert.equal(mixed[0]!.ownerAnswers.some((answer) => answer.includes("מאתיים")), false);
assert.equal(ranked.length, 3);
assert.equal(ranked[0]?.leadCount, 4);

assert.equal(knowledgeUpdateDue(new Date("2026-01-06T08:29:00.000Z")), false);
assert.equal(knowledgeUpdateDue(new Date("2026-01-06T08:30:00.000Z")), true);
assert.equal(knowledgeUpdateDue(new Date("2026-01-05T08:30:00.000Z")), false);
assert.equal(knowledgeUpdateDue(new Date("2026-07-07T07:29:00.000Z")), false);
assert.equal(knowledgeUpdateDue(new Date("2026-07-07T07:30:00.000Z")), true);
assert.equal(isoWeekKey(new Date("2026-01-06T08:30:00.000Z")), isoWeekKey(new Date("2026-01-06T20:00:00.000Z")));

const ready = {
  due: true,
  alreadySent: false,
  count: 2,
  templateApproved: true,
  mode: "admin" as const,
};
assert.equal(sendDecision({ ...ready, due: false }), "not_due");
assert.equal(sendDecision({ ...ready, alreadySent: true }), "already");
assert.equal(sendDecision({ ...ready, count: 0 }), "empty");
assert.equal(sendDecision({ ...ready, templateApproved: false }), "template");
assert.equal(sendDecision(ready), "send_admin");
assert.equal(sendDecision({ ...ready, mode: "owners" }), "send_owners");
assert.equal(KNOWLEDGE_UPDATES_RECIPIENT_MODE, "admin");
assert.deepEqual(
  deliverTargets({ decision: "send_admin", adminPhone: "972500000000", ownerPhones: ["972511111111"] }),
  ["972500000000"]
);
assert.deepEqual(
  deliverTargets({
    decision: "send_owners",
    adminPhone: "972500000000",
    ownerPhones: ["972511111111", "972511111111", "050"],
  }),
  ["972511111111"]
);
assert.deepEqual(
  deliverTargets({ decision: sendDecision(ready), adminPhone: "972500000000", ownerPhones: ["972511111111"] }),
  ["972500000000"]
);

const active = { active: true, awaitingCorrection: false, summarySent: false };
assert.deepEqual(
  inboundAction({
    text: "מתחילים",
    kind: "template_button",
    senderIsPilot: true,
    session: null,
  }),
  { handled: true, action: "open" }
);
assert.deepEqual(
  inboundAction({
    text: "מתחילים",
    kind: "template_button",
    senderIsPilot: false,
    session: null,
  }),
  { handled: false, action: "none" }
);
assert.deepEqual(
  inboundAction({
    text: "שלום",
    senderIsPilot: true,
    session: active,
  }),
  { handled: false, action: "none" }
);
assert.deepEqual(
  inboundAction({
    text: "להוסיף",
    kind: "button_reply",
    interactiveId: "kw_add",
    senderIsPilot: true,
    session: active,
  }),
  { handled: true, action: "add" }
);
assert.deepEqual(
  inboundAction({
    text: "הנוסח הנכון הוא שיש חניה ברחוב",
    senderIsPilot: true,
    session: { ...active, awaitingCorrection: true },
  }),
  { handled: true, action: "correct" }
);
assert.equal(sessionActive(new Date(Date.now() - 1000).toISOString(), new Date()), false);
assert.deepEqual(
  inboundAction({
    text: "להוסיף",
    kind: "button_reply",
    interactiveId: "kw_add",
    senderIsPilot: true,
    session: { active: false, awaitingCorrection: false, summarySent: false },
  }),
  { handled: true, action: "ignore" }
);
assert.equal(shouldWriteKnowledge("add", "sent"), true);
assert.equal(shouldWriteKnowledge("add", "added"), false);
assert.equal(shouldWriteKnowledge("skip", "sent"), false);
assert.deepEqual(readGroundingVerdict('{"answers":false,"grounded":true}'), { ok: false, reason: "not_answer" });
assert.deepEqual(
  readGroundingVerdict('{"answers":true,"grounded":false}'),
  { ok: false, reason: "not_grounded" }
);
assert.deepEqual(readGroundingVerdict('{"answers":true,"grounded":true}'), { ok: true, reason: "ok" });
assert.equal(readGroundingVerdict("פעם בשבוע 350").ok, false);

assert.equal(classifyOwnerFact("המנוי חודשי ואין מעבר של שיעורים מחודש לחודש"), "general_rule");
assert.equal(classifyOwnerFact("ביטול נכנס לתוקף תוך 30 יום"), "general_rule");
assert.equal(classifyOwnerFact("ביטול עד 6 שעות לאימון ערב ו-12 שעות לאימון בוקר"), "general_rule");
assert.equal(classifyOwnerFact("לנטוס 60 קומה 3 כניסה A במעלית"), "general_rule");
assert.equal(classifyOwnerFact("באופן חד פעמי אאפשר לך 4 שיעורים"), "personal_exception_or_favor");
assert.equal(classifyOwnerFact("באופן חריג אעביר לך"), "personal_exception_or_favor");
assert.equal(classifyOwnerFact("נתחשב בך"), "personal_exception_or_favor");
assert.equal(classifyOwnerFact("ההנחה הזו בשבילך"), "personal_exception_or_favor");
assert.equal(isTimeBoundFact("החדר כושר היה סגור לכבוד ראש השנה"), true);
assert.equal(isTimeBoundFact("אין אפשרות להחזר על החיוב של חודש ספטמבר"), true);
assert.equal(isTimeBoundFact("מאיזה גיל אפשר להתחיל"), false);
assert.equal(isTimeBoundFact("ימי ראשון ורביעי בשעה 17:30"), false);

const merged = mergeRuleStatements([
  { text: "ביטול נכנס לתוקף תוך 30 יום", excerpt: "הביטול תוך 30 יום" },
  { text: "ביטול המנוי נכנס לתוקף תוך 30 יום", excerpt: "תוך 30 יום" },
]);
assert.equal(merged.length, 1);
assert.equal(merged[0]?.times, 2);
assert.equal(merged[0]?.conflict, null);
const conflicted = mergeRuleStatements([
  { text: "ביטול עד 6 שעות לפני האימון", excerpt: "6 שעות" },
  { text: "ביטול עד 12 שעות לפני האימון", excerpt: "12 שעות" },
]);
assert.equal(conflicted[0]?.conflict != null, true);
const priceTiers = mergeRuleStatements([
  { text: "פעמיים בשבוע 400 ₪ עד 9 אימונים בחודש", excerpt: "400" },
  { text: "פעם בשבוע 300 ₪ עד 5 אימונים בחודש", excerpt: "300" },
]);
assert.equal(priceTiers.length, 2);
assert.equal(priceTiers.every((row) => row.conflict == null), true);
const windows = mergeRuleStatements([
  { text: "ביטול אימון ערב ניתן עד 6 שעות לפני האימון", excerpt: "6" },
  { text: "ביטול אימון בוקר ניתן עד 12 שעות לפני האימון", excerpt: "12" },
]);
assert.equal(windows.length, 2);
assert.equal(windows.every((row) => row.conflict == null), true);
assert.equal(ruleAgainstKnowledge("יש חניה חינם ברחוב", "חניה חינם ברחוב ליד הסטודיו"), "covered");
assert.notEqual(
  ruleAgainstKnowledge(
    "לנטוס 60 קומה 3 כניסה A במעלית",
    "איפה אתם נמצאים? Spider Academy, רחוב לנטוס 60, קומה 3, נתניה. מי המאמן? דאן 6"
  ),
  "conflicts"
);
assert.equal(
  ruleAgainstKnowledge("ביטול עד 12 שעות לפני האימון", "ביטול עד 6 שעות לפני האימון"),
  "conflicts"
);

const rankedCards = takeWeeklyCards({
  rules: [
    { text: "ביטול תוך 30 יום", times: 3, excerpt: "30 יום" },
    { text: "יש חניה ברחוב", times: 1, excerpt: "חניה" },
  ],
  qa: ranked,
});
assert.equal(rankedCards.length, 3);
assert.equal(rankedCards[0]?.kind, "rule");
assert.equal(rankedCards[1]?.kind, "rule");
assert.equal(rankedCards[2]?.kind, "qa");

const longCard = suggestionCardText({
  businessName: "סטודיו",
  question: "",
  knowledgeText: "ביטול נכנס לתוקף תוך 30 יום",
  kind: "rule",
  excerpt: "א".repeat(2000),
  timesStated: 4,
});
assert.ok(longCard.length <= KNOWLEDGE_CARD_LIMIT);
assert.match(longCard, /כלל שעלה מתשובות שלך/);
assert.match(longCard, /נאמר 4 פעמים/);

const written = appendKnowledgeQa([{ question: "יש חניה?", answer: "יש חניה ברחוב" }], {
  question: "יש מגבות?",
  answer: "יש מגבות במלתחה",
});
assert.equal(written.added, true);
assert.equal(written.pairs.length, 2);
const again = appendKnowledgeQa(written.pairs, { question: "יש מגבות?", answer: "יש מגבות במלתחה" });
assert.equal(again.added, false);
assert.equal(again.pairs.length, 2);

const card = knowledgeUpdateCardOutgoing("סטודיו\nהשאלה: יש חניה?\nהידע שיתווסף: יש חניה ברחוב");
assert.equal(card.type, "interactive");
const buttons =
  card.type === "interactive"
    ? ((card.interactive.action as { buttons?: Array<{ reply?: { id?: string; title?: string } }> }).buttons ?? [])
    : [];
assert.deepEqual(
  buttons.map((button) => button.reply?.title),
  ["להוסיף", "לדלג", "לתקן"]
);
assert.deepEqual(
  buttons.map((button) => button.reply?.id),
  ["kw_add", "kw_skip", "kw_fix"]
);

console.log("knowledge-updates.test.ts: ok");
