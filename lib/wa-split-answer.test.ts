import assert from "node:assert/strict";
import {
  REGISTERED_OPEN_QUESTION_HELP_CLOSING,
  STANDALONE_OPEN_QUESTION_HELP_CLOSING,
  ensureRegisteredOpenQuestionClosing,
  ensureStandaloneOpenQuestionClosing,
  ensureStudioOverviewClosing,
  finalizeStandaloneHelpReply,
  isStandaloneWhatsAppOpenQuestion,
  looksLikeLeadQuestion,
  replyAlreadyEndsWithQuestion,
  replyAlreadyHasHelpOffer,
  stripSalesFlowCtaHookFromAnswer,
  stripTrailingFollowUpQuestion,
} from "@/lib/wa-split-answer";
import { STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE } from "@/lib/wa-studio-overview-intent";

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

{
  const exactCloser =
    "אין לי את הפרטים על מדיניות הביטול.\n\nיש עוד משהו שאני יכולה לעזור לך איתו?";
  assert.equal(ensureStandaloneOpenQuestionClosing(exactCloser), exactCloser);
  assert.equal((exactCloser.match(/יש עוד משהו/g) ?? []).length, 1);
}

assert.equal(
  ensureStandaloneOpenQuestionClosing("השיעור בבוקר. אוכל לעזור בעוד משהו?"),
  "השיעור בבוקר. אוכל לעזור בעוד משהו?"
);

assert.equal(
  ensureStandaloneOpenQuestionClosing("מעדיפים בוקר או ערב?"),
  "מעדיפים בוקר או ערב?"
);

assert.equal(
  ensureStandaloneOpenQuestionClosing("ניתן להקפיא את המנוי עד 14 ימים."),
  `ניתן להקפיא את המנוי עד 14 ימים.\n\n${STANDALONE_OPEN_QUESTION_HELP_CLOSING}`
);

assert.equal(
  ensureStandaloneOpenQuestionClosing("יש חניה במקום?\nהחניה בחצר האחורית."),
  `יש חניה במקום?\nהחניה בחצר האחורית.\n\n${STANDALONE_OPEN_QUESTION_HELP_CLOSING}`
);

assert.equal(
  ensureStandaloneOpenQuestionClosing("הציוד אצלנו. יש עוד משהו שאני יכולה לעזור איתו? 🙂"),
  "הציוד אצלנו. יש עוד משהו שאני יכולה לעזור איתו? 🙂"
);

assert.equal(
  ensureRegisteredOpenQuestionClosing("הכתובת היא דם המכבים 36."),
  `הכתובת היא דם המכבים 36.\n\n${REGISTERED_OPEN_QUESTION_HELP_CLOSING}`
);
assert.equal(
  ensureRegisteredOpenQuestionClosing("מעדיפים בוקר או ערב?"),
  "מעדיפים בוקר או ערב?"
);

assert.equal(replyAlreadyEndsWithQuestion("הציוד אצלנו."), false);
assert.equal(replyAlreadyEndsWithQuestion("הציוד אצלנו?"), true);

{
  const botAlreadyAsked =
    "היי! 😊 אני בוט, אז לא דרך טלפון, אבל אני כאן לעזור בווטסאפ! מה אפשר לעזור לך איתו?";
  assert.equal(replyAlreadyHasHelpOffer(botAlreadyAsked), true);
  assert.equal(ensureStandaloneOpenQuestionClosing(botAlreadyAsked), botAlreadyAsked);
  assert.equal(
    ensureStandaloneOpenQuestionClosing("אני כאן אם יש משהו שאפשר לעזור"),
    "אני כאן אם יש משהו שאפשר לעזור"
  );
  assert.equal(replyAlreadyHasHelpOffer("ניתן להקפיא את המנוי עד 14 ימים."), false);
}

assert.equal(
  finalizeStandaloneHelpReply("בסדר גמור, נתראה בשיעור.", "כבר נרשמתי"),
  "בסדר גמור, נתראה בשיעור."
);
assert.equal(
  stripTrailingFollowUpQuestion("בסדר גמור, נתראה בשיעור."),
  "בסדר גמור, נתראה בשיעור."
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

assert.equal(
  ensureStudioOverviewClosing(
    "אנחנו סטודיו פילאטיס באווירה חמה. אצלנו תמצאו מכשירים ומזרן.",
    "ספרו לי על הסטודיו"
  ),
  `אנחנו סטודיו פילאטיס באווירה חמה. אצלנו תמצאו מכשירים ומזרן.\n\n${STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE}`
);
assert.equal(
  ensureStudioOverviewClosing(
    `אנחנו סטודיו פילאטיס.\n\n${STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE}`,
    "ספרו לי על הסטודיו"
  ),
  `אנחנו סטודיו פילאטיס.\n\n${STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE}`
);
assert.equal(
  finalizeStandaloneHelpReply("אנחנו סטודיו פילאטיס. יש עוד משהו שאני יכולה לעזור לך איתו?", "מה יש אצלכם"),
  `אנחנו סטודיו פילאטיס.\n\n${STUDIO_OVERVIEW_COMMUNITY_CLOSING_HE}`
);
assert.equal(
  finalizeStandaloneHelpReply("ניתן להקפיא את המנוי עד 14 ימים.", "מה מדיניות הביטול?"),
  `ניתן להקפיא את המנוי עד 14 ימים.\n\n${STANDALONE_OPEN_QUESTION_HELP_CLOSING}`
);

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
