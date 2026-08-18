import assert from "node:assert/strict";
import {
  STANDALONE_OPEN_QUESTION_HELP_CLOSING,
  ensureStandaloneOpenQuestionClosing,
  isStandaloneWhatsAppOpenQuestion,
  looksLikeLeadQuestion,
  stripSalesFlowCtaHookFromAnswer,
} from "@/lib/wa-split-answer";

assert.equal(
  isStandaloneWhatsAppOpenQuestion({
    sessionPhase: "opening",
    salesFlowStarted: false,
    registered: false,
  }),
  true
);

assert.equal(
  isStandaloneWhatsAppOpenQuestion({
    sessionPhase: "opening",
    salesFlowStarted: true,
    registered: false,
  }),
  false
);

assert.equal(
  isStandaloneWhatsAppOpenQuestion({
    sessionPhase: "warmup",
    salesFlowStarted: false,
    registered: false,
  }),
  true
);

assert.equal(
  isStandaloneWhatsAppOpenQuestion({
    sessionPhase: "warmup",
    salesFlowStarted: true,
    registered: false,
  }),
  false
);

assert.equal(
  ensureStandaloneOpenQuestionClosing(
    "אני ממליצה ליצור קשר עם שירות הלקוחות שלנו בטלפון 0524617053."
  ),
  `אני ממליצה ליצור קשר עם שירות הלקוחות שלנו בטלפון 0524617053.\n\n${STANDALONE_OPEN_QUESTION_HELP_CLOSING}`
);

assert.equal(
  ensureStandaloneOpenQuestionClosing(
    "אין לי את הפרטים על מדיניות הביטול. יש עוד משהו שאני יכולה לעזור לך איתו?"
  ),
  "אין לי את הפרטים על מדיניות הביטול. יש עוד משהו שאני יכולה לעזור לך איתו?"
);

assert.equal(looksLikeLeadQuestion("מה מדיניות הביטול?"), true);
assert.equal(looksLikeLeadQuestion("איך מגיעים לסטודיו"), true);
assert.equal(looksLikeLeadQuestion("What time is the class?"), true);
assert.equal(
  looksLikeLeadQuestion(
    "לא לכעוס אבל דחיתי לחמישי כי שכחתי שיש לי תור לרופא אבל כבר נרשמתי לחמישי"
  ),
  false
);
assert.equal(looksLikeLeadQuestion("כבר נרשמתי"), false);

{
  const pilatesLeak =
    "איזה כיף! 🙂 שיעורי פילאטיס מכשירים הם תרגול המתמקד בהתארכות. השיעור עולה 99 ₪ לשני אימוני היכרות ונמשך כ-45 דקות 🙂 עכשיו רק נותר לשריין את מקומך באמצעות תשלום מאובטח - 99 ₪ בלבד, הטבה דרך השיחה שלנו כאן :)\nלשמור לך מקום? 💜";
  const stripped = stripSalesFlowCtaHookFromAnswer(pilatesLeak);
  assert.equal(stripped.includes("עכשיו רק נותר לשריין"), false);
  assert.equal(stripped.includes("לשמור לך מקום"), false);
  assert.match(stripped, /פילאטיס מכשירים/);
  assert.match(stripped, /99 ₪ לשני אימוני היכרות/);
}

assert.match(
  stripSalesFlowCtaHookFromAnswer("כן, יש שיעור מחר.\nמה דעתך שנבדוק מתי האימון ניסיון הבא?"),
  /יש שיעור מחר/
);

console.log("wa-split-answer.test.ts: ok");
