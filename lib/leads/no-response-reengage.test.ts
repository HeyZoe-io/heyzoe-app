import assert from "node:assert/strict";
import { waNoResponseEligible } from "@/lib/wa-no-response";
import {
  computeNoResponseDueAt,
  isBeyondSessionFollowupWindow,
  isMissingNoResponseCandidatesRpc,
  isNoResponseCandidateOpen,
  isNoResponseEpisodeAlreadyReengaged,
  isSilentLongEnough,
  isValidNoResponseDelayDays,
  shouldCloseNoResponseEpisode,
  silenceEpisodeKeyFromLastUserAt,
  takeOpenNoResponseCandidates,
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
  assert.equal(
    waNoResponseEligible({ self_reported_registered_at: "2026-08-17T10:00:00.000Z" }),
    false
  );
  assert.equal(waNoResponseEligible({ session_phase: "registered" }), false);
  assert.equal(waNoResponseEligible({ trial_signup_notice: "zoe" }), false);
  assert.equal(waNoResponseEligible({ trial_signup_notice: "template" }), false);
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

/** Terminal skip closes the episode. Retryable skip leaves it open. */
{
  assert.equal(shouldCloseNoResponseEpisode("no_valid_name"), true);
  assert.equal(shouldCloseNoResponseEpisode("no_zoe_conversation"), true);
  assert.equal(shouldCloseNoResponseEpisode("arbox_member"), true);
  assert.equal(shouldCloseNoResponseEpisode("member_sync_log"), true);
  assert.equal(shouldCloseNoResponseEpisode("human_cooldown"), false);
  assert.equal(shouldCloseNoResponseEpisode("recent_template"), false);
  assert.equal(shouldCloseNoResponseEpisode("template_not_approved"), false);

  const lastUser = "2026-09-20T13:26:59.000Z";
  const closedAt = "2026-09-27T08:00:00.000Z";
  assert.equal(isNoResponseEpisodeAlreadyReengaged(closedAt, lastUser), true);
  assert.equal(isNoResponseEpisodeAlreadyReengaged(null, lastUser), false);

  const wroteAgain = "2026-09-28T09:00:00.000Z";
  assert.equal(isNoResponseEpisodeAlreadyReengaged(closedAt, wroteAgain), false);
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

/** Open-episode filter: closed rows stay out; older or null markers stay in. */
{
  const lastContact = "2026-09-23T14:29:25.975Z";
  const sentAfter = "2026-09-26T08:00:30.293Z";
  const olderMarker = "2026-09-01T08:00:00.000Z";
  assert.equal(isNoResponseCandidateOpen(sentAfter, lastContact), false);
  assert.equal(isNoResponseCandidateOpen(lastContact, lastContact), false);
  assert.equal(isNoResponseCandidateOpen(olderMarker, lastContact), true);
  assert.equal(isNoResponseCandidateOpen(null, lastContact), true);
  assert.equal(isNoResponseCandidateOpen(undefined, lastContact), true);

  const page = [
    { id: "closed", wa_last_reengaged_at: sentAfter, last_contact_at: lastContact },
    { id: "reopened", wa_last_reengaged_at: olderMarker, last_contact_at: lastContact },
    { id: "fresh", wa_last_reengaged_at: null, last_contact_at: lastContact },
  ];
  const kept = takeOpenNoResponseCandidates(page, 200);
  assert.deepEqual(
    kept.map((row) => row.id),
    ["reopened", "fresh"]
  );
  // A closed row in the page is skipped. Nothing past this page is read.
  assert.equal(kept.length, 2);
}

/** A newer inbound (last_contact_at after the marker) is a candidate again. */
{
  const marker = "2026-09-26T08:00:30.293Z";
  const nextInbound = "2026-09-28T09:00:00.000Z";
  assert.equal(isNoResponseCandidateOpen(marker, nextInbound), true);
}

/** Fallback when the RPC is not deployed yet: one page, in-code skip, no second page. */
{
  assert.equal(
    isMissingNoResponseCandidatesRpc({
      code: "PGRST202",
      message: "Could not find the function public.no_response_open_candidates in the schema cache",
    }),
    true
  );
  assert.equal(
    isMissingNoResponseCandidatesRpc({
      message: "function no_response_open_candidates does not exist",
    }),
    true
  );
  assert.equal(
    isMissingNoResponseCandidatesRpc({ message: "column arbox_is_member does not exist" }),
    false
  );

  const onlyPage = [
    { id: "closed", wa_last_reengaged_at: "2026-09-26T00:00:00.000Z", last_contact_at: "2026-09-20T00:00:00.000Z" },
    { id: "open", wa_last_reengaged_at: null, last_contact_at: "2026-09-20T00:00:00.000Z" },
  ];
  const fallback = takeOpenNoResponseCandidates(onlyPage, 200);
  assert.deepEqual(
    fallback.map((row) => row.id),
    ["open"]
  );
}

console.log("no-response-reengage.test.ts: ok");
