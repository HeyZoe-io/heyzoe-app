import assert from "node:assert/strict";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import { nextBlockedWhatsAppSendTimeIsrael, WA_FOLLOWUP_QUIET_END_MINUTES } from "@/lib/israel-time";
import {
  decideFollowupStep,
  followupCancelModelUsed,
  followupStepWasHeld,
  parseFollowupCancelModelUsed,
  rebasedNextFollowupDueAt,
} from "@/lib/followup-hold-policy";
import { pickMarketingFollowupStage, type MarketingFlowSessionFollowupRow } from "@/lib/marketing-followups";

const at = (ymd: string, hm: string) => israelWallTimeToUtc(ymd, hm);
const H = 60 * 60 * 1000;
const WA = WA_FOLLOWUP_QUIET_END_MINUTES;

// Hold boundaries.
assert.equal(nextBlockedWhatsAppSendTimeIsrael(at("2026-10-09", "10:00")).toISOString(), at("2026-10-09", "16:00").toISOString());
assert.equal(nextBlockedWhatsAppSendTimeIsrael(at("2026-10-10", "19:05")).toISOString(), at("2026-10-10", "23:00").toISOString());
assert.equal(nextBlockedWhatsAppSendTimeIsrael(at("2026-10-12", "09:00")).toISOString(), at("2026-10-12", "23:00").toISOString());

// Shabbat delay: step 1 due Saturday 08:27, first allowed tick 19:05.
{
  const lastUserAt = at("2026-10-10", "08:07");
  const dueAt = at("2026-10-10", "08:27");
  const now = at("2026-10-10", "19:05");
  assert.equal(followupStepWasHeld(dueAt, now, WA), true);
  assert.deepEqual(decideFollowupStep({ finalStep: false, dueAt, now, lastUserAt, quietEndMinutes: WA }), {
    action: "cancel",
    reason: "delayed_step_cancelled",
  });
  // Due Friday 15:58, the 16:00 block starts before the next tick.
  assert.equal(followupStepWasHeld(at("2026-10-09", "15:58"), at("2026-10-10", "19:00"), WA), true);
}

// Night delay: due 22:57, the 23:00 tick is blocked, first allowed tick 08:00.
{
  const dueAt = at("2026-10-12", "22:57");
  const now = at("2026-10-13", "08:00");
  assert.equal(followupStepWasHeld(dueAt, now, WA), true);
  assert.deepEqual(
    decideFollowupStep({ finalStep: false, dueAt, now, lastUserAt: at("2026-10-12", "20:57"), quietEndMinutes: WA }),
    { action: "cancel", reason: "delayed_step_cancelled" }
  );
  // Inside the night (07:30 < 08:00 quiet end for Zoe follow-ups).
  assert.equal(followupStepWasHeld(at("2026-10-13", "07:30"), now, WA), true);
  // Not held: due 22:30, sent 22:35.
  assert.equal(followupStepWasHeld(at("2026-10-12", "22:30"), at("2026-10-12", "22:35"), WA), false);
  assert.deepEqual(
    decideFollowupStep({
      finalStep: false,
      dueAt: at("2026-10-12", "22:30"),
      now: at("2026-10-12", "22:35"),
      lastUserAt: at("2026-10-12", "22:10"),
      quietEndMinutes: WA,
    }),
    { action: "send" }
  );
  // Due 08:01, tick 08:05: same allowed stretch.
  assert.equal(followupStepWasHeld(at("2026-10-13", "08:01"), at("2026-10-13", "08:05"), WA), false);
}

// Step 3: held by the night but still sent once while under 24h; closed at 24.1h.
{
  const lastUserAt = at("2026-10-10", "08:07");
  const dueAt = new Date(lastUserAt.getTime() + 23 * H);
  const at239 = new Date(lastUserAt.getTime() + 23.9 * H);
  const at241 = new Date(lastUserAt.getTime() + 24.1 * H);
  assert.equal(followupStepWasHeld(dueAt, at239, WA), true);
  assert.deepEqual(decideFollowupStep({ finalStep: true, dueAt, now: at239, lastUserAt, quietEndMinutes: WA }), {
    action: "send",
  });
  assert.deepEqual(decideFollowupStep({ finalStep: true, dueAt, now: at241, lastUserAt, quietEndMinutes: WA }), {
    action: "cancel",
    reason: "outside_24h_window",
  });
  assert.deepEqual(decideFollowupStep({ finalStep: true, dueAt, now: at239, lastUserAt: null }), {
    action: "cancel",
    reason: "outside_24h_window",
  });
}

// Conversation chain: the box after a cancelled one keeps the original schedule.
{
  const cancelledDue = at("2026-10-10", "10:00");
  const now = at("2026-10-10", "19:05");
  const next = rebasedNextFollowupDueAt(cancelledDue, 60);
  assert.equal(next.toISOString(), at("2026-10-10", "11:00").toISOString());
  assert.equal(followupStepWasHeld(next, now, WA), true);
  const final = rebasedNextFollowupDueAt(next, 22 * 60);
  assert.equal(final.toISOString(), at("2026-10-11", "09:00").toISOString());
  assert.equal(final.getTime() > now.getTime(), true);
  assert.equal(rebasedNextFollowupDueAt(cancelledDue, -5).toISOString(), cancelledDue.toISOString());
}

// Marketing: 24h check before every send, even for a step that was never held.
{
  const delays: [number, number, number] = [10 * 60_000, 2 * H, 23 * H];
  const lastUserAt = at("2026-10-12", "09:00");
  const row: MarketingFlowSessionFollowupRow = {
    id: "m1",
    phone: "972500000000",
    last_user_message_at: lastUserAt.toISOString(),
    followup_1_sent_at: lastUserAt.toISOString(),
    followup_2_sent_at: null,
    followup_3_sent_at: null,
    followup_opted_out: false,
    flow_completed: false,
  };
  const late = new Date(lastUserAt.getTime() + 24.5 * H);
  assert.equal(pickMarketingFollowupStage(row, late.getTime(), delays), 2);
  assert.deepEqual(
    decideFollowupStep({ finalStep: false, dueAt: new Date(lastUserAt.getTime() + delays[1]), now: late, lastUserAt }),
    { action: "cancel", reason: "outside_24h_window" }
  );
  const onTime = new Date(lastUserAt.getTime() + 2 * H + 3 * 60_000);
  assert.deepEqual(
    decideFollowupStep({ finalStep: false, dueAt: new Date(lastUserAt.getTime() + delays[1]), now: onTime, lastUserAt }),
    { action: "send" }
  );
  // A skipped step counts as done.
  assert.equal(
    pickMarketingFollowupStage({ ...row, followup_2_skipped_at: onTime.toISOString() }, onTime.getTime(), delays),
    0
  );
}

// Audit model_used round trip.
{
  const model = followupCancelModelUsed("delayed_step_cancelled", 3646, "wa_followups", 2);
  assert.equal(model, "followup_cancelled:delayed_step_cancelled:3646:wa_followups:2");
  assert.deepEqual(parseFollowupCancelModelUsed(model), {
    reason: "delayed_step_cancelled",
    businessId: 3646,
    path: "wa_followups",
    step: 2,
  });
  assert.equal(parseFollowupCancelModelUsed("cron_unexpected_caller"), null);
}

console.log("followup-hold-policy tests passed");
