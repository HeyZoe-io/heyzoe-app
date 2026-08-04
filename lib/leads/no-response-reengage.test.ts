import assert from "node:assert/strict";
import { waNoResponseEligible } from "@/lib/wa-no-response";
import {
  computeNoResponseDueAt,
  isBeyondSessionFollowupWindow,
  isNoResponseEpisodeAlreadyReengaged,
  isSilentLongEnough,
  isValidNoResponseDelayDays,
  silenceEpisodeKeyFromLastUserAt,
} from "@/lib/leads/no-response-reengage";
import { buildNoResponseScheduledDedupKey } from "@/lib/scheduled-template-sends";
import {
  isArboxDependentTriggerType,
  isTriggerType,
} from "@/lib/template-trigger-types";

/** Gate replication: each exclusion */
{
  assert.equal(waNoResponseEligible({}), true);
  assert.equal(waNoResponseEligible({ opted_out: true }), false);
  assert.equal(waNoResponseEligible({ not_relevant_at: "2026-01-01T00:00:00.000Z" }), false);
  assert.equal(waNoResponseEligible({ human_requested_at: "2026-01-01T00:00:00.000Z" }), false);
  assert.equal(waNoResponseEligible({ trial_registered: true }), false);
  assert.equal(waNoResponseEligible({ session_phase: "registered" }), false);
  assert.equal(waNoResponseEligible({ session_phase: "cta", trial_registered: false }), true);
}

/** Silence-episode dedup: re-arm after new user message */
{
  const episode1User = "2026-07-01T10:00:00.000Z";
  const reengaged = "2026-07-03T12:00:00.000Z";
  assert.equal(isNoResponseEpisodeAlreadyReengaged(reengaged, episode1User), true);

  const episode2User = "2026-07-10T09:00:00.000Z"; // talked again after reengage
  assert.equal(isNoResponseEpisodeAlreadyReengaged(reengaged, episode2User), false);
  assert.equal(isNoResponseEpisodeAlreadyReengaged(null, episode2User), false);

  const key1 = silenceEpisodeKeyFromLastUserAt(episode1User);
  const key2 = silenceEpisodeKeyFromLastUserAt(episode2User);
  assert.notEqual(key1, key2);

  const d1 = buildNoResponseScheduledDedupKey(1, "rule-a", "972501111111", key1);
  const d2 = buildNoResponseScheduledDedupKey(1, "rule-a", "972501111111", key2);
  assert.notEqual(d1, d2);
  assert.equal(
    d1,
    `no_response:1:rule-a:972501111111:${key1}`
  );
}

/** delay_days >= 2 enforcement helper */
{
  assert.equal(isValidNoResponseDelayDays(2), true);
  assert.equal(isValidNoResponseDelayDays(3), true);
  assert.equal(isValidNoResponseDelayDays(1), false);
  assert.equal(isValidNoResponseDelayDays(0), false);
  assert.equal(isValidNoResponseDelayDays(1.5), false);
}

/** due_at = last_user_at + delay_days */
{
  const lastUser = "2026-08-01T12:00:00.000Z";
  const due = computeNoResponseDueAt(lastUser, 3);
  assert.equal(due.toISOString(), "2026-08-04T12:00:00.000Z");
}

/** no overlap under 24h */
{
  const now = Date.parse("2026-08-04T12:00:00.000Z");
  const recent = "2026-08-04T00:00:00.000Z"; // 12h ago
  assert.equal(isBeyondSessionFollowupWindow(recent, now), false);
  assert.equal(isSilentLongEnough(recent, 2, now), false);

  const old = "2026-08-01T12:00:00.000Z"; // 3 days ago
  assert.equal(isBeyondSessionFollowupWindow(old, now), true);
  assert.equal(isSilentLongEnough(old, 2, now), true);
  assert.equal(isSilentLongEnough(old, 4, now), false);
}

/** no_response is non-Arbox */
{
  assert.equal(isTriggerType("no_response"), true);
  assert.equal(isArboxDependentTriggerType("no_response"), false);
}

console.log("no-response-reengage.test.ts: ok");
