import assert from "node:assert/strict";
import { SCHEDULE_BOARD_CAPTION } from "@/lib/sales-flow";
import { UNKNOWN_CLASS_SLOT_HANDOFF_REPLY } from "@/lib/wa-unknown-class-slot";
import { resolveScheduleResponse } from "@/lib/wa-schedule-response";

const link = "https://example.com/board";

const tights = resolveScheduleResponse({
  slug: "tights",
  schedulePublicUrl: link,
  arboxLink: link,
  hasScheduleData: true,
  claudeBody: "יום ב 18:30",
});
assert.equal(tights.kind, "image");
assert.equal(tights.source, "image");

const omers = resolveScheduleResponse({
  slug: "omers-place",
  arboxLink: link,
  hasScheduleData: true,
  claudeBody: "הנה השעות שחשבתי",
});
assert.equal(omers.kind, "link");
if (omers.kind === "link") {
  assert.equal(omers.text, `${SCHEDULE_BOARD_CAPTION}: ${link}`);
  assert.equal(omers.text.includes("הנה השעות"), false);
}

const data = resolveScheduleResponse({
  slug: "master-yigal-arbiv-ikma-israel",
  hasScheduleData: true,
  claudeBody: "יום ראשון 16:45",
});
assert.equal(data.kind, "body");
if (data.kind === "body") assert.equal(data.text, "יום ראשון 16:45");

const none = resolveScheduleResponse({
  slug: "sportykef-1589",
  hasScheduleData: false,
  claudeBody: "יש מחר ב-10:00",
});
assert.equal(none.kind, "handoff");
if (none.kind === "handoff") assert.equal(none.text, UNKNOWN_CLASS_SLOT_HANDOFF_REPLY);

console.log("wa-schedule-response.test.ts: ok");
