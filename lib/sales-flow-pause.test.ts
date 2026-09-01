import assert from "node:assert/strict";
import {
  assistantReplyIndicatesSalesFlowPause,
  assistantReplyIndicatesTeamHandoff,
  leadPausesSalesFlowNow,
  shouldPauseSalesFlowPromptResend,
} from "@/lib/sales-flow-pause";

const sangaInbound = "אהיה בקשר לקבוע שיעור ניסיון תודה 🙏🏻";
const sangaReply =
  "מושלם! אנחנו כאן כשתהיה מוכן/ה 🙂 אם תהיו שאלות או תרצה לשריין שיעור ניסיון - פשוט כתוב לי או התקשר לשירות הלקוחות: **0587572594** מוזמן/מוזמנת חזרה בכל עת 💜";

assert.equal(leadPausesSalesFlowNow(sangaInbound), true);
assert.equal(assistantReplyIndicatesSalesFlowPause(sangaReply), true);
assert.equal(
  assistantReplyIndicatesSalesFlowPause(
    "מצטערת לשמוע שיש בעיה! זה משהו שצריך לברר מול הצוות. אני מעבירה את הפנייה שלך ויצרו איתך קשר בקרוב"
  ),
  true
);
assert.equal(
  shouldPauseSalesFlowPromptResend({ inboundText: sangaInbound, assistantReply: sangaReply }),
  true
);

assert.equal(leadPausesSalesFlowNow("אהיה בקשר תודה"), true);
assert.equal(leadPausesSalesFlowNow("אחזור אליכם בהמשך"), true);
assert.equal(leadPausesSalesFlowNow("לא עכשיו תודה"), true);
assert.equal(leadPausesSalesFlowNow("I'll be in touch, thanks"), true);
assert.equal(leadPausesSalesFlowNow("maybe later"), true);

assert.equal(leadPausesSalesFlowNow("אהיה שם ב-19:00"), false);
assert.equal(leadPausesSalesFlowNow("בקשר לשיעור מחר מה צריך להביא"), false);
assert.equal(leadPausesSalesFlowNow("רוצה לקבוע שיעור ניסיון"), false);
assert.equal(leadPausesSalesFlowNow("כמה עולה?"), false);

assert.equal(
  shouldPauseSalesFlowPromptResend({
    inboundText: "כמה עולה השיעור ניסיון?",
    assistantReply: sangaReply,
  }),
  false,
  "open question must still resend the flow step"
);

assert.equal(
  shouldPauseSalesFlowPromptResend({
    inboundText: "תודה 🙏🏻",
    assistantReply: sangaReply,
  }),
  true,
  "thanks + Zoe already closed softly → skip resend"
);

assert.equal(
  shouldPauseSalesFlowPromptResend({
    inboundText: "תודה",
    assistantReply: "בשמחה! אפשר לבחור מועד מהכפתורים.",
  }),
  false
);

const ageMismatchHandoff =
  "קרב מגע לילדים אצלנו הוא לגילאי 6-8. לילדים בגיל 4 עדיין לא יש מסלול מתאים. אני מעבירה את הבקשה לצוות ויצרו איתך קשר כדי לברר אפשרויות נוספות 💜";
assert.equal(assistantReplyIndicatesTeamHandoff(ageMismatchHandoff), true);
assert.equal(
  shouldPauseSalesFlowPromptResend({
    inboundText: "היי ולילדים בני 4?",
    assistantReply: ageMismatchHandoff,
  }),
  true,
  "team handoff after an open question must not resend the schedule menu"
);
assert.equal(
  assistantReplyIndicatesTeamHandoff("אין בעיה אני מעבירה את הבקשה לצוות"),
  true
);
assert.equal(assistantReplyIndicatesTeamHandoff("בשמחה! אפשר לבחור מועד מהכפתורים."), false);

assert.equal(
  shouldPauseSalesFlowPromptResend({
    inboundText: "אשמח לפרטים",
    assistantReply: ageMismatchHandoff,
  }),
  false,
  "flow-start phrase must reopen the sales flow even after a team-handoff reply"
);
assert.equal(
  shouldPauseSalesFlowPromptResend({
    inboundText: "בואו נתחיל",
    assistantReply: "אין בעיה אני מעבירה את הבקשה לצוות",
  }),
  false
);
assert.equal(
  shouldPauseSalesFlowPromptResend({
    inboundText: "היי",
    assistantReply: ageMismatchHandoff,
    salesFlowStartOpts: { slug: "info-2815" },
  }),
  false,
  "Sanga «היי» is a flow-start trigger"
);
assert.equal(
  shouldPauseSalesFlowPromptResend({
    inboundText: "היי",
    assistantReply: ageMismatchHandoff,
    salesFlowStartOpts: { slug: "master-yigal-arbiv-ikma-israel" },
  }),
  true,
  "IKMA «היי» is not a flow-start trigger — keep the handoff pause"
);

console.log("sales-flow-pause.test.ts: ok");
