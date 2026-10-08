import assert from "node:assert/strict";
import { buildSystemPrompt } from "@/lib/business-context";
import {
  appendRouteToModelUsed,
  decideReplyRouteAction,
  extractReplyRoute,
  modelUsedBase,
  parseModelUsed,
  resolveRouteBookingChangeReply,
} from "@/lib/wa-reply-route";

const timeBody = "ביום שני ב-08:30 יש מקום, אם זה מתאים.";

assert.equal(extractReplyRoute("[[route:answer]]\nכמה עולה?").tagStatus, "ok");
assert.equal(extractReplyRoute("[[route:answer]]\nכמה עולה?").route, "answer");
assert.equal(extractReplyRoute("[[route:answer]]\nכמה עולה?").body, "כמה עולה?");

assert.equal(extractReplyRoute("שלום בלי תג").tagStatus, "missing");
assert.equal(extractReplyRoute("שלום בלי תג").route, null);
assert.equal(extractReplyRoute("שלום בלי תג").body, "שלום בלי תג");

assert.equal(extractReplyRoute("[[route:nope]]\nטקסט").tagStatus, "invalid");
assert.equal(extractReplyRoute("[[route:nope]]\nטקסט").body, "טקסט");

assert.equal(extractReplyRoute("[[route:schedule]]").tagStatus, "ok");
assert.equal(extractReplyRoute("[[route:schedule]]").route, "schedule");
assert.equal(extractReplyRoute("[[route:schedule]]").body, "");
assert.equal(extractReplyRoute("\u200f\u200e  [[route:schedule]]\nמה יש").tagStatus, "ok");
assert.equal(extractReplyRoute("\u200f\u200e  [[route:schedule]]\nמה יש").route, "schedule");
assert.equal(extractReplyRoute("\u200f\u200e  [[route:schedule]]\nמה יש").body, "מה יש");
assert.equal(
  extractReplyRoute("[[route:schedule]]\nלהלן לוח: יום ב בשעה 18:30").body,
  "להלן לוח: יום ב בשעה 18:30"
);

assert.equal(
  extractReplyRoute("[[route:answer]]\nמחיר 100\n[[route:schedule]]\nעוד").body,
  "מחיר 100\nעוד"
);

assert.equal(extractReplyRoute("[[route:interest]]").tagStatus, "ok");
assert.equal(extractReplyRoute("[[route:interest]]").route, "interest");
assert.equal(extractReplyRoute("[[route:interest]]").body, "");
assert.equal(extractReplyRoute("[[route:signup]]").tagStatus, "ok");
assert.equal(extractReplyRoute("[[route:personal]]").tagStatus, "ok");
assert.equal(extractReplyRoute("[[route:personal]]").route, "personal");
assert.equal(extractReplyRoute("[[route:personal]]").body, "");
assert.equal(extractReplyRoute("[[route:handoff]]").tagStatus, "missing");
assert.equal(extractReplyRoute("[[route:handoff]]").body, "");
assert.equal(extractReplyRoute("[[route:handoff]]\n   ").tagStatus, "missing");

function actionFor(raw: string, scheduleImageEnabled: boolean, suppressTimetable = false) {
  return decideReplyRouteAction({
    extracted: extractReplyRoute(raw),
    scheduleImageEnabled,
    suppressTimetable,
  }).kind;
}

assert.equal(actionFor(`[[route:schedule]]\n${timeBody}`, true), "timetable");
assert.equal(actionFor(`[[route:schedule]]\n${timeBody}`, false), "send_body");
assert.equal(actionFor(`[[route:schedule]]\n${timeBody}`, true, true), "send_body");
assert.equal(actionFor(`[[route:booking_change]]\n${timeBody}`, true), "booking_change");
assert.equal(actionFor("[[route:booking_change_trial]]\nמבטלת ניסיון", true), "booking_change");
assert.equal(extractReplyRoute("[[route:booking_change_trial]]").tagStatus, "ok");
assert.equal(extractReplyRoute("[[route:booking_change_trial]]").route, "booking_change_trial");
assert.equal(actionFor("[[route:class_move]]", true), "class_move");
assert.equal(actionFor("[[route:class_move_member]]\nמנוי", true), "class_move_member");
assert.equal(actionFor("[[route:class_move_trial]]", true), "class_move_trial");
assert.equal(actionFor(`[[route:answer]]\n${timeBody}`, true), "send_body");
assert.equal(extractReplyRoute("[[route:membership_purchase]]").tagStatus, "ok");
assert.equal(actionFor("[[route:membership_purchase]]", false), "membership_purchase");
assert.equal(actionFor("[[route:membership_purchase]]\nהנה", false), "membership_purchase");
assert.equal(actionFor(`[[route:handoff]]\n${timeBody}`, true), "handoff");
assert.equal(actionFor(timeBody, true), "send_body");
assert.equal(actionFor(`[[route:nope]]\n${timeBody}`, true), "send_body");

assert.deepEqual(parseModelUsed("claude-haiku-4-5#route=schedule;tag=ok"), {
  model: "claude-haiku-4-5",
  route: "schedule",
  tagStatus: "ok",
  hint: null,
});
assert.deepEqual(parseModelUsed("greeting"), { model: "greeting", route: null, tagStatus: null, hint: null });
assert.deepEqual(parseModelUsed("claude-haiku-4-5#route=nope;tag=ok"), {
  model: "claude-haiku-4-5",
  route: null,
  tagStatus: "invalid",
  hint: null,
});
assert.deepEqual(parseModelUsed("claude-haiku-4-5#route=handoff;tag=ok;hint=cancellation"), {
  model: "claude-haiku-4-5",
  route: "handoff",
  tagStatus: "ok",
  hint: "cancellation",
});
assert.equal(modelUsedBase("claude-haiku-4-5#route=schedule;tag=ok"), "claude-haiku-4-5");
assert.equal(
  appendRouteToModelUsed("claude-haiku-4-5", extractReplyRoute("[[route:schedule]]\nלוח")),
  "claude-haiku-4-5#route=schedule;tag=ok"
);
assert.match(
  appendRouteToModelUsed("claude-haiku-4-5", extractReplyRoute("בלי תג")),
  /#route=answer;tag=missing$/
);

assert.match(resolveRouteBookingChangeReply({ botName: "זואי" }), /צוות/);

const waPrompt = buildSystemPrompt(null, "tights", "whatsapp");
assert.match(waPrompt, /\[\[route:booking_change\]\]/);
assert.match(waPrompt, /\[\[route:booking_change_trial\]\]/);
assert.match(waPrompt, /יש אפשרות לבטל את השיעור נסיון/);
assert.match(waPrompt, /\[\[route:class_move\]\]/);
assert.match(waPrompt, /שעה שהיא מציינת בתוך בקשת הביטול/);
const webPrompt = buildSystemPrompt(null, "tights", "web");
assert.equal(webPrompt.includes("[[route:booking_change]]"), false);

console.log("wa-reply-route.test.ts: ok");
