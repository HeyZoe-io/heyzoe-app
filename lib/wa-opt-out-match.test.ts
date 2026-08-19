import assert from "node:assert/strict";
import { matchesOptOutKeyword } from "@/lib/wa-opt-out-match";

assert.equal(matchesOptOutKeyword("הסר"), true);
assert.equal(matchesOptOutKeyword("  הסר.  "), true);
assert.equal(matchesOptOutKeyword("להסיר אותי"), true);
assert.equal(matchesOptOutKeyword("לא לשלוח לי יותר הודעות"), true);
assert.equal(matchesOptOutKeyword("לא לשלוח לי יותר הודעות!"), true);

assert.equal(matchesOptOutKeyword("בטל"), false);
assert.equal(matchesOptOutKeyword("stop"), false);
assert.equal(matchesOptOutKeyword("הסרה"), false);
assert.equal(matchesOptOutKeyword("לא רוצה"), false);
assert.equal(matchesOptOutKeyword("איך מבטלים מנוי"), false);
assert.equal(matchesOptOutKeyword("אפשר לבטל מנוי"), false);
assert.equal(matchesOptOutKeyword("מה מדיניות הביטול"), false);
assert.equal(matchesOptOutKeyword("הסר אותי מהרשימה"), false);
assert.equal(matchesOptOutKeyword("cancellation policy"), false);

console.log("wa-opt-out-match.test.ts: ok");
