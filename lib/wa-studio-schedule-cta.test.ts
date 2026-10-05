import assert from "node:assert/strict";
import {
  assistantReplyListsClassTimes,
  SCHEDULE_TIMES_IMAGE_REPLY,
  scheduleBoardHistoryNote,
  scheduleCtaImageFollowUpLinkText,
  scheduleCtaSendsImageAndLink,
  scheduleTimesReplyCaption,
  scheduleTimesReplyUsesImage,
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

assert.equal(scheduleTimesReplyUsesImage("tights"), true);
assert.equal(scheduleTimesReplyUsesImage(" Tights "), true);
assert.equal(scheduleTimesReplyUsesImage("apex"), false);
assert.equal(scheduleTimesReplyUsesImage(""), false);
assert.equal(scheduleTimesReplyCaption("tights"), SCHEDULE_TIMES_IMAGE_REPLY);
assert.equal(scheduleTimesReplyCaption("apex"), null);
assert.equal(
  SCHEDULE_TIMES_IMAGE_REPLY,
  "אפשר לראות במערכת שעות! זה עונה על השאלה שלך?"
);

assert.equal(
  assistantReplyListsClassTimes("פילאטיס | חמישי 19:30"),
  true
);
assert.equal(
  assistantReplyListsClassTimes("יוגה מתקיים פעמיים בשבוע:\nביום שני ב-18:00\nביום חמישי ב-19:30"),
  true
);
assert.equal(assistantReplyListsClassTimes("מה יש מחר? יש יוגה ב-18:00"), true);
assert.equal(assistantReplyListsClassTimes("18:00, BODY PUMP\n19:30, יוגה"), true);
assert.equal(assistantReplyListsClassTimes("נרשמת לשיעור מחר ב-18:00, נתראה!"), false);
assert.equal(assistantReplyListsClassTimes("שעות פעילות: ראשון 08:00-20:00"), false);
assert.equal(assistantReplyListsClassTimes("המחיר הוא 120 שקלים לחודש."), false);

assert.equal(
  scheduleBoardHistoryNote(
    "[media] https://example.com/board.jpeg\n\nכאן ניתן לראות את מערכת השעות שלנו"
  ),
  "שלחתי את תמונת מערכת השעות."
);
assert.equal(scheduleBoardHistoryNote("[media] https://example.com/logo.png"), null);
assert.equal(scheduleBoardHistoryNote("כאן ניתן לראות את מערכת השעות שלנו"), null);

console.log("wa-studio-schedule-cta: assertions passed");
