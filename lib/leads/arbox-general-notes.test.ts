import assert from "node:assert/strict";
import {
  formatArboxGeneralNotesForTemplate,
  newestGeneralNoteComments,
} from "@/lib/leads/arbox-general-notes";
import { TEMPLATE_GENERAL_NOTES_FALLBACK } from "@/lib/template-send-params";

assert.equal(formatArboxGeneralNotesForTemplate([]), TEMPLATE_GENERAL_NOTES_FALLBACK);
assert.equal(
  formatArboxGeneralNotesForTemplate(["פציעה בברך\nלהתחיל לאט", "  "]),
  "פציעה בברך להתחיל לאט"
);
assert.equal(
  formatArboxGeneralNotesForTemplate(["הערה ראשונה", "הערה שנייה"]),
  "הערה ראשונה · הערה שנייה"
);

const long = "א".repeat(500);
const formatted = formatArboxGeneralNotesForTemplate([long]);
assert.ok(formatted.length <= 400);
assert.ok(formatted.endsWith("…"));

assert.deepEqual(
  newestGeneralNoteComments({
    data: [
      { comment: "ישן", created_at: "2026-01-01 00:00:00" },
      { comment: "  " },
      { comment: null },
      { comment: "טסט", created_at: "2026-09-27 12:22:29" },
      { action_by: "מאמן" },
    ],
  }),
  ["טסט", "ישן"]
);

const eliaZoe =
  "זואי — ללא מענה 24 שעות\n\nעברו 24 שעות והליד לא נרשם - יש ליצור קשר טלפוני";
const eliaHuman = "המספר של אמא שלו אאיילה. אליה בן 11 בכיתה ה'";
const eliaStaff = "מתאמנת במקום אחר";
const eliaOlder =
  "הייתה קצרה בזמן. עניין אותה מחיר. רק מחיר. חתרה לשם כל השיחה. הוסבר מנוי בוקר כי המחיר זה הפאקטור המרכזי. אמרה שתהיה איתנו בקשר כי נכנסת לפגישה.";
const eliaPayload = {
  data: [
    { comment: eliaHuman, action_by: "רוני שרם", created_at: "2026-10-06 13:24:46" },
    { comment: eliaZoe, action_by: "דוד כהן", created_at: "2026-09-15 14:05:11" },
    { comment: eliaStaff, action_by: "רוני שרם", created_at: "2025-11-24 16:10:49" },
    { comment: eliaOlder, action_by: "לאה ויצמן", created_at: "2025-01-09 13:47:23" },
  ],
};
assert.equal(
  formatArboxGeneralNotesForTemplate(newestGeneralNoteComments(eliaPayload)),
  `${eliaHuman} · ${eliaStaff} · ${eliaOlder}`
);
assert.equal(formatArboxGeneralNotesForTemplate([eliaZoe]), TEMPLATE_GENERAL_NOTES_FALLBACK);
assert.equal(formatArboxGeneralNotesForTemplate([]), TEMPLATE_GENERAL_NOTES_FALLBACK);
assert.equal(
  formatArboxGeneralNotesForTemplate(["הערה    עם רווחים", eliaZoe]),
  "הערה עם רווחים"
);

console.log("arbox-general-notes.test.ts: ok");
