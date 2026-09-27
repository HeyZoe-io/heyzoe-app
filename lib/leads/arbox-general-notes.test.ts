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

console.log("arbox-general-notes.test.ts: ok");
