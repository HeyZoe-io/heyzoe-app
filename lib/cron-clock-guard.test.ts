import assert from "node:assert/strict";
import { syncArboxPostTrialFollowupForBusiness } from "@/lib/leads/arbox-post-trial-followup";
import { syncArboxTrialReminderForBusiness } from "@/lib/leads/arbox-trial-reminder";

const admin = new Proxy(
  {},
  {
    get() {
      throw new Error("db touched");
    },
  }
);

const thursday = new Date("2026-10-08T06:00:00.000Z");

async function main() {
  const trial = await syncArboxTrialReminderForBusiness({
    admin: admin as never,
    businessId: 3646,
    businessSlug: "or-ia-wellness-vlub",
    apiKey: "k",
    boxId: "b",
    trialReminderSeeded: true,
    now: thursday,
  });
  assert.equal(trial.skip_reason, "time_override_requires_dry_run");
  assert.equal(trial.notified, 0);

  const post = await syncArboxPostTrialFollowupForBusiness({
    admin: admin as never,
    businessId: 3646,
    businessSlug: "or-ia-wellness-vlub",
    apiKey: "k",
    boxId: "b",
    postTrialFollowupSeeded: true,
    now: thursday,
  });
  assert.equal(post.skip_reason, "time_override_requires_dry_run");
  assert.equal(post.notified, 0);
  console.log("cron-clock-guard.test.ts: ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
