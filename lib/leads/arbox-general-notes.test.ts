import assert from "node:assert/strict";
import {
  commentsFromGeneralNotesPayload,
  formatArboxGeneralNotesForTemplate,
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
  commentsFromGeneralNotesPayload({
    data: [{ comment: "אחת" }, { comment: "  " }, { comment: null }, { action_by: "מאמן" }],
  }),
  ["אחת"]
);

console.log("arbox-general-notes.test.ts: ok");
