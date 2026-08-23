import assert from "node:assert/strict";
import {
  isKnowledgeGapAssistantText,
  looksLikeScheduleRequest,
  parseMessageUuid,
  pickKnowledgeGapQuestion,
  resolveKnowledgeGapKind,
} from "@/lib/analytics-knowledge-gaps";
import { WA_UNCLEAR_CLARIFY_HE } from "@/lib/wa-unclear-intent";
import { UNKNOWN_CLASS_SLOT_HANDOFF_MODEL } from "@/lib/wa-unknown-class-slot";
import { UNKNOWN_OFFER_POLICY_HANDOFF_MODEL } from "@/lib/wa-unknown-offer-policy";

assert.equal(parseMessageUuid("73149a89-228e-4e53-b0b7-1a806e4cf3a0"), "73149a89-228e-4e53-b0b7-1a806e4cf3a0");
assert.equal(parseMessageUuid("73149A89-228E-4E53-B0B7-1A806E4CF3A0"), "73149a89-228e-4e53-b0b7-1a806e4cf3a0");
assert.equal(parseMessageUuid(12345), "");
assert.equal(parseMessageUuid("not-a-uuid"), "");
assert.equal(Number("73149a89-228e-4e53-b0b7-1a806e4cf3a0"), NaN);

assert.equal(isKnowledgeGapAssistantText("אין לי את הפרטים על מדיניות הביטול."), true);
assert.equal(
  isKnowledgeGapAssistantText("אין לי כרגע את המידע על מחירי המנויים. מוזמנים לפנות לשירות הלקוחות."),
  true
);
assert.equal(
  isKnowledgeGapAssistantText("I don't have the membership pricing details right now."),
  true
);
assert.equal(isKnowledgeGapAssistantText("אין בעיה אני מעבירה את הבקשה לצוות"), false);
assert.equal(
  isKnowledgeGapAssistantText("אין בעיה אני מעבירה את הבקשה לצוות", UNKNOWN_CLASS_SLOT_HANDOFF_MODEL),
  false
);
assert.equal(
  isKnowledgeGapAssistantText(
    "אני לא בטוחה לגבי זה, אני מעבירה את הבקשה לצוות",
    UNKNOWN_OFFER_POLICY_HANDOFF_MODEL
  ),
  true
);
assert.equal(
  isKnowledgeGapAssistantText("אין לי את הפרטים", "claude_limit_24h"),
  false
);
assert.equal(isKnowledgeGapAssistantText("שלום! אימון ניסיון עולה 30 שח"), false);
assert.equal(
  isKnowledgeGapAssistantText(
    "מצטערת לשמוע! זה משהו שצריך לברר מול הצוות. אני מעבירה את הפנייה שלך ויצרו איתך קשר בקרוב 💜"
  ),
  true
);
assert.equal(
  isKnowledgeGapAssistantText(
    "תודה על הבהרה! 💜 אני מעבירה את הפנייה לצוות ויצרו איתך קשר בקרוב."
  ),
  false
);
assert.equal(
  isKnowledgeGapAssistantText(
    "מצטערת לשמוע שיש בלבול עם ההקפאה! אני מעבירה את זה לבדיקה מול הצוות."
  ),
  false
);
assert.equal(
  isKnowledgeGapAssistantText(
    "היי! 👋 הבנתי שיש בלבול עם החיוב על הכרטיס. זה משהו שצריך לברר מול הצוות - אני מעבירה את הבקשה שלך אליהם ויצרו איתך קשר בקרוב."
  ),
  false
);
assert.equal(
  isKnowledgeGapAssistantText(
    "תודה על הבהרה! 💜 לצערי, אני לא יכולה לגשת לפרטי המנוי או ללוח האימונים שלך. זה משהו שצריך לברר מול הצוות ישירות. אתה יכול ליצור קשר בטלפון: **0524617053** והם יעזרו לך להוסיף את האימון ליומן."
  ),
  false
);

const billingThenShavuaTov = [
  {
    role: "user",
    content:
      "בוביק היי.אני מנסה לחייב את הדיינרס שלי על חיוב שלא בוצע כי ביטלתי את הכרטיס",
    createdAt: "2026-08-22T15:12:12.000Z",
  },
  {
    role: "user",
    content: "ושבוע טוב",
    createdAt: "2026-08-22T15:12:17.000Z",
  },
  {
    role: "assistant",
    content: "זה משהו שצריך לברר מול הצוות",
    createdAt: "2026-08-22T15:12:18.000Z",
  },
];
assert.equal(
  pickKnowledgeGapQuestion(billingThenShavuaTov, "2026-08-22T15:12:18.000Z").includes("דיינרס"),
  true
);

const membershipClarifyThenHandoff = [
  {
    role: "user",
    content: "היי ממצב? יכולה לשלוח לי למתי קבענו שאכניס לי ליומן",
    createdAt: "2026-08-20T07:42:46.000Z",
  },
  {
    role: "assistant",
    content:
      "היי! 👋 כדי שאוכל לעזור לך עם זה, אני צריכה קצת יותר פרטים. אתה מתכוון לאימון ניסיון שרשמת עכשיו, או שיש לך כבר מנוי קיים איתנו?",
    createdAt: "2026-08-20T07:42:53.000Z",
  },
  {
    role: "user",
    content: "מנוי קיים",
    createdAt: "2026-08-20T07:43:25.000Z",
  },
  {
    role: "assistant",
    content: "אין לי את הפרטים על כך.",
    createdAt: "2026-08-20T07:43:32.000Z",
  },
];
assert.notEqual(
  pickKnowledgeGapQuestion(membershipClarifyThenHandoff, "2026-08-20T07:43:32.000Z"),
  "מנוי קיים"
);

const limitlessLessonTransfer = [
  {
    role: "user",
    content: "הי, יש מצב שאני אעביר קצת שיעורים מחודש הבא לחודש הזה?",
    createdAt: "2026-08-23T13:49:34.900Z",
  },
  {
    role: "assistant",
    content: WA_UNCLEAR_CLARIFY_HE,
    createdAt: "2026-08-23T13:49:40.440Z",
  },
  {
    role: "user",
    content: "נגמרו לי השיעורים החודש",
    createdAt: "2026-08-23T13:49:53.903Z",
  },
  {
    role: "assistant",
    content:
      "מצטערת לשמוע! זה משהו שצריך לברר מול הצוות. אני מעבירה את הפנייה שלך ויצרו איתך קשר בקרוב 💜",
    createdAt: "2026-08-23T13:49:58.991Z",
  },
];
assert.equal(
  pickKnowledgeGapQuestion(limitlessLessonTransfer, "2026-08-23T13:49:58.991Z"),
  "הי, יש מצב שאני אעביר קצת שיעורים מחודש הבא לחודש הזה?"
);
assert.equal(
  pickKnowledgeGapQuestion(
    [
      {
        role: "user",
        content: "יש מזגן בסטודיו?",
        createdAt: "2026-08-23T10:00:00.000Z",
      },
      {
        role: "assistant",
        content: "אין לי את הפרטים על כך.",
        createdAt: "2026-08-23T10:00:05.000Z",
      },
    ],
    "2026-08-23T10:00:05.000Z"
  ),
  "יש מזגן בסטודיו?"
);

assert.equal(
  isKnowledgeGapAssistantText(
    "אוקיי, תודה על ההודעה! זה משהו שצריך לברר מול הצוות בגלל שהשעות האלה לא מופיעות בלוח השיעורים הרגיל שלנו. אני מעבירה את הבקשה שלך ויוקשרו אליך בקרוב 💜"
  ),
  false
);
assert.equal(looksLikeScheduleRequest("ראשון 14 וחצי חמישי 16:00"), true);
assert.equal(
  pickKnowledgeGapQuestion(
    [
      {
        role: "user",
        content: "רוצה להחליף שיעור",
        createdAt: "2026-08-18T12:33:01.000Z",
      },
      {
        role: "assistant",
        content: "אין בעיה אני מעבירה את הבקשה לצוות",
        createdAt: "2026-08-18T12:33:06.000Z",
      },
    ],
    "2026-08-18T12:33:06.000Z"
  ),
  ""
);

assert.equal(looksLikeScheduleRequest("פילאטיס מכשירים בשעה 1800"), true);
assert.equal(looksLikeScheduleRequest("פילאטיס מכשירים בשעה 18:00"), true);
assert.equal(looksLikeScheduleRequest("יש מזגן בסטודיו?"), false);
assert.equal(looksLikeScheduleRequest("אפשר להביא אוכל לסטודיו?"), false);
assert.equal(looksLikeScheduleRequest("מתי יש שיעורים בבקרים?"), false);
assert.equal(looksLikeScheduleRequest("יש פילאטיס בשעה 18"), false);

assert.equal(
  resolveKnowledgeGapKind({
    question: "פילאטיס מכשירים בשעה 1800",
    modelUsed: UNKNOWN_CLASS_SLOT_HANDOFF_MODEL,
  }),
  "schedule_request"
);
assert.equal(
  resolveKnowledgeGapKind({ question: "יש מזגן בסטודיו?", modelUsed: "claude-haiku-4-5" }),
  "question"
);

console.log("analytics-knowledge-gaps.test.ts: ok");
