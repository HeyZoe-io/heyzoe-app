import assert from "node:assert/strict";
import {
  MARKETING_NOTE_STATUSES,
  marketingNoteStatusRank,
  sortMarketingSessionsByStatusPriority,
} from "@/lib/marketing-conversation-notes";

assert.deepEqual([...MARKETING_NOTE_STATUSES], [
  "in_process",
  "requires_call",
  "no_response",
  "not_interested",
  "registered",
  "not_relevant",
]);

assert.equal(marketingNoteStatusRank("in_process"), 0);
assert.equal(marketingNoteStatusRank("requires_call"), 1);
assert.equal(marketingNoteStatusRank("no_response"), 2);
assert.equal(marketingNoteStatusRank("not_interested"), 3);
assert.equal(marketingNoteStatusRank("registered"), 4);
assert.equal(marketingNoteStatusRank("not_relevant"), 5);
assert.equal(marketingNoteStatusRank(null), 0);
assert.equal(marketingNoteStatusRank(undefined), 0);

const newer = "2026-08-24T12:00:00.000Z";
const older = "2026-08-20T12:00:00.000Z";

const sorted = sortMarketingSessionsByStatusPriority([
  { id: "not_relevant-new", noteStatus: "not_relevant" as const, lastAt: newer },
  { id: "registered", noteStatus: "registered" as const, lastAt: newer },
  { id: "not_interested", noteStatus: "not_interested" as const, lastAt: newer },
  { id: "no_response", noteStatus: "no_response" as const, lastAt: newer },
  { id: "requires_call", noteStatus: "requires_call" as const, lastAt: older },
  { id: "in_process-old", noteStatus: "in_process" as const, lastAt: older },
  { id: "in_process-new", noteStatus: "in_process" as const, lastAt: newer },
]);

assert.deepEqual(
  sorted.map((s) => s.id),
  [
    "in_process-new",
    "in_process-old",
    "requires_call",
    "no_response",
    "not_interested",
    "registered",
    "not_relevant-new",
  ]
);

console.log("marketing-conversation-notes.test.ts: ok");
