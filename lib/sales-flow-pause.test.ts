import assert from "node:assert/strict";
import {
  assistantReplyIndicatesSalesFlowPause,
  leadPausesSalesFlowNow,
  shouldPauseSalesFlowPromptResend,
} from "@/lib/sales-flow-pause";

const sangaInbound = "אהיה בקשר לקבוע שיעור ניסיון תודה 🙏🏻";
const sangaReply =
  "מושלם! אנחנו כאן כשתהיה מוכן/ה 🙂 אם תהיו שאלות או תרצה לשריין שיעור ניסיון - פשוט כתוב לי או התקשר לשירות הלקוחות: **0587572594** מוזמן/מוזמנת חזרה בכל עת 💜";

assert.equal(leadPausesSalesFlowNow(sangaInbound), true);
assert.equal(assistantReplyIndicatesSalesFlowPause(sangaReply), true);
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

console.log("sales-flow-pause.test.ts: ok");
