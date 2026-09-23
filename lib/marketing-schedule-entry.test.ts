import assert from "node:assert/strict";
import {
  findMarketingScheduleDayNode,
  isMarketingScheduleCallButton,
  type ScheduleFlowNode,
} from "@/lib/marketing-schedule-entry";

const intro: ScheduleFlowNode = {
  id: "intro",
  type: "message",
  data: { text: "היי" },
};
const day: ScheduleFlowNode = {
  id: "day",
  type: "question",
  data: {
    text: "באיזה יום נוח לך לדבר?",
    buttons: ["ראשון", "שני", "שלישי"],
  },
};
const hour: ScheduleFlowNode = {
  id: "hour",
  type: "question",
  data: { text: "באיזו שעה?", buttons: ["10:00", "12:00"] },
};
const otherDay: ScheduleFlowNode = {
  id: "visit",
  type: "question",
  data: { text: "מתי נוח לך להגיע?", buttons: ["בוקר", "ערב"] },
};

assert.equal(isMarketingScheduleCallButton("קביעת שיחה"), true);
assert.equal(isMarketingScheduleCallButton("  קביעת שיחה "), true);
assert.equal(isMarketingScheduleCallButton("היי"), false);

assert.equal(findMarketingScheduleDayNode([intro, otherDay, hour, day])?.id, "day");
assert.equal(findMarketingScheduleDayNode([intro, hour]), null);

console.log("marketing-schedule-entry.test.ts: ok");
