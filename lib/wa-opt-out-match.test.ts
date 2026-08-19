import assert from "node:assert/strict";
import {
  matchesOptOutKeyword,
  shouldBypassOptOutForClosedPlaybook,
} from "@/lib/wa-opt-out-match";

assert.equal(matchesOptOutKeyword("בטל"), true);
assert.equal(matchesOptOutKeyword("הסר"), true);
assert.equal(matchesOptOutKeyword("stop"), true);
assert.equal(matchesOptOutKeyword("STOP"), true);
assert.equal(matchesOptOutKeyword("לא רוצה"), true);
assert.equal(matchesOptOutKeyword("בטל אותי מהרשימה"), true);

assert.equal(matchesOptOutKeyword("איך מבטלים מנוי"), false, "מבטלים must not match בטל");
assert.equal(matchesOptOutKeyword("מה מדיניות הביטול"), false);
assert.equal(matchesOptOutKeyword("cancellation policy"), false, "cancel must not match inside cancellation");

assert.equal(shouldBypassOptOutForClosedPlaybook("איך מבטלים מנוי"), true);
assert.equal(shouldBypassOptOutForClosedPlaybook("אפשר לבטל מנוי?"), true);
assert.equal(shouldBypassOptOutForClosedPlaybook("בטל"), false);
assert.equal(shouldBypassOptOutForClosedPlaybook("stop"), false);
assert.equal(shouldBypassOptOutForClosedPlaybook("הסר"), false);

console.log("wa-opt-out-match.test.ts: ok");
