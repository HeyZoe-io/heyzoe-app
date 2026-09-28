import assert from "node:assert/strict";
import { finalizeStandaloneHelpReply } from "@/lib/wa-split-answer";
import { sanitizeZoeOutboundLanguage } from "@/lib/zoe-text";
import {
  OUT_OF_FLOW_MEMBER_OR_TRIAL_INVITE,
  rewriteOutOfFlowWarmupTextDump,
} from "@/lib/wa-out-of-flow-warmup-dump";

const limitlessWarmup = {
  experience_question: "",
  experience_options: ["", "", ""],
  opening_extra_steps: [
    {
      question: "מה מעניין אותך?",
      options: ["לחזק ולחטב את הגוף", "הפחתת כאבים", "טווחי תנועה ויציבה"],
    },
  ],
};

const dumped =
  "היי מיכל! 💜 מעולה, שמחה לשמוע ממך! 🙂 אני כאן כדי לעזור לך למצוא את האימון המושלם בשבילך. בואי נתחילי! מה מעניין אותך? לחזק ולחטב את הגוף | הפחתת כאבים | טווחי תנועה ויציבה";

const inbound = "היי זאת מיכל, שולחת את הקול שלי בהמשך לשיחה שלנו :)";
const prepared = finalizeStandaloneHelpReply(sanitizeZoeOutboundLanguage(dumped), inbound);
const rewritten = rewriteOutOfFlowWarmupTextDump(prepared, limitlessWarmup);
assert.ok(rewritten);
assert.doesNotMatch(rewritten!, /מה מעניין אותך|לחזק ולחטב|נתחילי|\|/);
assert.match(rewritten!, /היי מיכל/);
assert.match(rewritten!, /שמחה לשמוע ממך/);
assert.match(rewritten!, /יש לך מנוי קיים אצלנו/);
assert.match(rewritten!, /רוצה שנתאים עבורך אימון ניסיון\? אם כן נא לכתוב לי ״בואו נתחיל״ ונעשה זאת יחד!/);
assert.equal(rewritten!.includes(OUT_OF_FLOW_MEMBER_OR_TRIAL_INVITE), true);

assert.equal(
  rewriteOutOfFlowWarmupTextDump("המחיר לאימון ניסיון הוא 70 ש״ח.", limitlessWarmup),
  null
);
assert.equal(
  rewriteOutOfFlowWarmupTextDump("יש לנו אימונים להפחתת כאבים.", limitlessWarmup),
  null
);

console.log("wa-out-of-flow-warmup-dump.test.ts: ok");
