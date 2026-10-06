import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { collectPreClaudeHint } from "@/lib/wa-pre-claude-hint";
import {
  allowPreClaudeSends,
  enterPreClaudeZone,
  exitPreClaudeZone,
  guardPreClaudeOutbound,
  isWholeMessageTimetableRequest,
  PreClaudeSendBlocked,
  resolveSendBeforeClaudeReason,
  SEND_BEFORE_CLAUDE_REASONS,
} from "@/lib/wa-send-before-claude";
import { isWholeMessageSalesFlowStart } from "@/lib/sales-flow-start-triggers";

const INCIDENT_MOVE = "היי יש סיכוי להחליף שעה היום אני רשומה לחמש וחצי ואני רוצה לבוא בשש וחצי";
const INCIDENT_MOVE_2 = "אני רשומה אני רוצה להחליף";
const INCIDENT_WAITLIST =
  "ביום שישי נרשמתי לרשימת המתנה לשני אימונים, התפנו לשניהם אז ביטלתי אימון אחד נרשם לי ביטול מאוחר שצריך לבטל אותו כדי שאוכל לנצל את המנוי שלי";

function reasonFor(text: string) {
  return resolveSendBeforeClaudeReason({
    text,
    openingTrigger: isWholeMessageSalesFlowStart(text),
    matchesMenuLabel: false,
    warmupOption: false,
  });
}

assert.equal(isWholeMessageTimetableRequest("שלחי לי את מערכת השעות"), true);
assert.equal(isWholeMessageTimetableRequest("מערכת שעות?"), true);
assert.equal(isWholeMessageTimetableRequest("אפשר את הלוח?"), true);
assert.equal(isWholeMessageTimetableRequest("היי מערכת שעות"), true);
assert.equal(isWholeMessageTimetableRequest("מה יש ביום שישי במערכת השעות"), false);
assert.equal(isWholeMessageTimetableRequest(INCIDENT_MOVE), false);
assert.equal(isWholeMessageTimetableRequest(INCIDENT_WAITLIST), false);

assert.equal(isWholeMessageSalesFlowStart("אשמח לפרטים"), true);
assert.equal(isWholeMessageSalesFlowStart("היי אשמח לפרטים"), true);
assert.equal(isWholeMessageSalesFlowStart("אשמח לפרטים על המחיר של הכרטיסייה"), false);

assert.equal(reasonFor("שלחי לי את מערכת השעות"), "explicit_timetable_request");
assert.equal(reasonFor("אשמח לפרטים"), "configured_opening_trigger");
assert.equal(reasonFor(INCIDENT_MOVE), null);
assert.equal(reasonFor(INCIDENT_MOVE_2), null);
assert.equal(reasonFor(INCIDENT_WAITLIST), null);
assert.equal(reasonFor("ת"), null);
assert.equal(reasonFor("אני רשומה לשיעור של מחר?"), null);

assert.equal(collectPreClaudeHint(INCIDENT_MOVE)?.category, "registration_verify");
assert.notEqual(collectPreClaudeHint(INCIDENT_WAITLIST)?.category, "registration_verify");
assert.ok(collectPreClaudeHint("אני רשומה לשיעור של מחר?"));

const FREE_TEXT = [
  INCIDENT_MOVE,
  INCIDENT_MOVE_2,
  "החלפה",
  "?",
  "ת",
  INCIDENT_WAITLIST,
  "אני רשומה לשיעור של מחר?",
  "נרשמתי אתמול ולא הצלחתי להיכנס",
  "אני רשומה כבר חודשיים",
  "לשני אימונים בשבוע יש מקום?",
  "ביום שני אני עובדת אז רק בערב",
  "שני ילדים באים איתי",
  "נרשמתי לרשימת המתנה",
  "אני רשומה לחמישי בבוקר",
  "תמחקו אותי מהשיעור ותעבירו אותי ליום שני",
  "כמה עולה כרטיסייה?",
  "צריך להביא מזרן?",
  "תודה רבה",
  "איפה אתם נמצאים?",
  "יש חניה?",
  "אני רוצה לדבר עם המנהלת",
  "כואב לי הברך",
  "מה נשמע?",
  "לא אגיע מחר, אפשר לבטל?",
  "יש לי מנוי ואני רוצה להקפיא",
  "אפשר החזר על השיעור?",
  "חברה שלי ביטלה ואני רוצה להצטרף במקומה",
  "מתי האימון שלי?",
  "מה יש ביום שני בבוקר?",
  "יש שיעורים אחרי 18:00?",
  "מתי יש פילאטיס השבוע?",
  "איזה אימונים יש ביום שלישי?",
  "נרשמתי בטעות ל-18:00 ורציתי 19:30",
  "השעה שקבעתי לא מסתדרת",
  "אפשר להזיז אותי מחמישי לשני ב-8:30?",
  "ביטלתי בטעות, תחזירו אותי",
  "נרשם לי ביטול מאוחר",
  "יש לי שני כרטיסים",
  "שנינו רוצים להגיע",
  "אני רשומה אבל האפליקציה לא נפתחת",
  "רק רציתי לוודא שקיבלתם",
  "היום לא מתאים לי",
  "מחר אני מגיעה כמו שקבענו",
  "תעבירי אותי לנציג",
  "מה המדיניות על ביטול מאוחר?",
  "אפשר שני שיעורים באותו יום?",
  "נרשמתי לשישי ולשני",
  "אני לא מנויה, רק שואלת",
  "שישי זה היום החופשי שלי",
  "תשלחי לי פרטים על האימונים",
];
assert.equal(FREE_TEXT.length, 50);
for (const text of FREE_TEXT) {
  assert.equal(reasonFor(text), null, text);
}

enterPreClaudeZone();
assert.throws(() => guardPreClaudeOutbound("sendWhatsAppMessage"), PreClaudeSendBlocked);
const release = allowPreClaudeSends("explicit_timetable_request");
assert.doesNotThrow(() => guardPreClaudeOutbound("sendWhatsAppMessage"));
release();
assert.throws(() => guardPreClaudeOutbound("sendWhatsAppMessage"), PreClaudeSendBlocked);
exitPreClaudeZone();
assert.doesNotThrow(() => guardPreClaudeOutbound("sendWhatsAppMessage"));

const webhook = readFileSync("app/api/whatsapp/webhook/route.ts", "utf8");
const sf = ts.createSourceFile("route.ts", webhook, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let processIncoming: ts.FunctionDeclaration | undefined;
function findFn(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "processIncoming") processIncoming = node;
  ts.forEachChild(node, findFn);
}
findFn(sf);
assert.ok(processIncoming?.body);
let label: ts.LabeledStatement | undefined;
function findLabel(node: ts.Node) {
  if (ts.isLabeledStatement(node) && node.label.text === "customerPreClaude") label = node;
  ts.forEachChild(node, findLabel);
}
findLabel(processIncoming!);
assert.ok(label);
const block = label!.statement;
assert.ok(ts.isBlock(block));
const first = block.statements[0];
assert.ok(ts.isIfStatement(first));
const firstText = first.getText(sf);
assert.match(firstText, /break customerPreClaude/);
assert.match(firstText, /collectPreClaudeHint/);
assert.equal(firstText.includes("sendWhatsAppMessage"), false);

const bodyText = processIncoming!.body!.getText(sf);
for (const reason of SEND_BEFORE_CLAUDE_REASONS) {
  assert.ok(reason.length > 0);
}
assert.match(bodyText, /enterPreClaudeZone\(/);
assert.match(bodyText, /allowPreClaudeSends\(/);
assert.match(bodyText, /exitPreClaudeZone\(/);
assert.match(readFileSync("lib/whatsapp.ts", "utf8"), /guardPreClaudeOutbound\("sendWhatsAppMessage"\)/);

console.log("wa-send-before-claude.test.ts: ok");
