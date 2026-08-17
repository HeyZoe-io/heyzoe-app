import assert from "node:assert/strict";
import {
  STANDALONE_OPEN_QUESTION_HELP_CLOSING,
  ensureStandaloneOpenQuestionClosing,
  isStandaloneWhatsAppOpenQuestion,
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

console.log("wa-split-answer.test.ts: ok");
