import assert from "node:assert/strict";
import {
  STANDALONE_OPEN_QUESTION_HELP_CLOSING,
  ensureStandaloneOpenQuestionClosing,
  isStandaloneWhatsAppOpenQuestion,
  looksLikeLeadQuestion,
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

console.log("wa-split-answer.test.ts: ok");
