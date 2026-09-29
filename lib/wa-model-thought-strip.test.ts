import assert from "node:assert/strict";
import { stripModelThoughtLeak } from "@/lib/wa-model-thought-strip";

const log = { businessSlug: "limitless", conversationId: "wa_test_session" };

assert.equal(
  stripModelThoughtLeak("THOUGHT: The user asked about a class.\nיש שיעור מחר בבוקר", log),
  "יש שיעור מחר בבוקר"
);

assert.equal(
  stripModelThoughtLeak("יש שיעור מחר.\nTHOUGHT: keep this internal.\nנתראה שם", log),
  "יש שיעור מחר.\nנתראה שם"
);

assert.equal(
  stripModelThoughtLeak("יש שיעור מחר בבוקר.\nThought: internal note", log),
  "יש שיעור מחר בבוקר."
);

assert.equal(
  stripModelThoughtLeak(
    "THOUGHT:\nThe user has sent a short note.\nAnswer in Hebrew only.\n\nיש לנו מקום בשיעור.",
    log
  ),
  "יש לנו מקום בשיעור."
);

assert.equal(stripModelThoughtLeak("[THOUGHT] internal only", log), "");
assert.equal(stripModelThoughtLeak("<thought>hidden</thought>\nשלום", log), "שלום");

assert.equal(stripModelThoughtLeak("THOUGHT: The user has sent a message and nothing else.", log), "");

assert.equal(stripModelThoughtLeak("יש שיעור מחר בבוקר, נשמח לראות אותך.", log), "יש שיעור מחר בבוקר, נשמח לראות אותך.");

assert.equal(
  stripModelThoughtLeak("We wanted to let you know. I thought you might like the morning class.", log),
  "We wanted to let you know. I thought you might like the morning class."
);

console.log("wa-model-thought-strip.test.ts ok");
