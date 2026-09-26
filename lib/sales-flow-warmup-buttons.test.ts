import assert from "node:assert/strict";
import {
  WARMUP_MIN_BUTTONS,
  emptyWarmupButtonPairs,
  isWarmupExperienceQuestion1Configured,
  normalizeWarmupButtonPairs,
} from "@/lib/sales-flow";

assert.equal(WARMUP_MIN_BUTTONS, 2);

const two = normalizeWarmupButtonPairs(["כן", "לא"], ["מעולה", "אין בעיה"]);
assert.deepEqual(two.options, ["כן", "לא"]);
assert.deepEqual(two.replies, ["מעולה", "אין בעיה"]);

const padded = normalizeWarmupButtonPairs(["רק אחד"], ["תשובה"]);
assert.equal(padded.options.length, 2);
assert.equal(padded.options[0], "רק אחד");
assert.equal(padded.options[1], "");

const empty = emptyWarmupButtonPairs();
assert.equal(empty.options.length, 2);
assert.equal(empty.replies.length, 2);

assert.equal(
  isWarmupExperienceQuestion1Configured({ question: "מה מתאים לך?", options: ["כן", "לא"] }),
  true
);
assert.equal(
  isWarmupExperienceQuestion1Configured({ question: "מה מתאים לך?", options: ["רק אחד"] }),
  false
);

console.log("sales-flow-warmup-buttons.test.ts: ok");
