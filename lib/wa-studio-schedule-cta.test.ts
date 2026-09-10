import assert from "node:assert/strict";
import {
  scheduleCtaSendsImageAndLink,
  scheduleCtaImageFollowUpLinkText,
} from "@/lib/wa-studio-schedule-cta";

// רק Apex
assert.equal(scheduleCtaSendsImageAndLink("apex"), true);
assert.equal(scheduleCtaSendsImageAndLink("APEX"), true);
assert.equal(scheduleCtaSendsImageAndLink(" Apex "), true);
assert.equal(scheduleCtaSendsImageAndLink("other-studio"), false);
assert.equal(scheduleCtaSendsImageAndLink(""), false);
assert.equal(scheduleCtaSendsImageAndLink(null), false);
assert.equal(scheduleCtaSendsImageAndLink(undefined), false);

// נוסח הודעת הלינק
assert.equal(
  scheduleCtaImageFollowUpLinkText("https://arbox.example/schedule"),
  "וגם הקישור הישיר למערכת השעות:\nhttps://arbox.example/schedule"
);
assert.equal(scheduleCtaImageFollowUpLinkText("  "), "");
assert.equal(scheduleCtaImageFollowUpLinkText(""), "");

console.log("wa-studio-schedule-cta: assertions passed");
