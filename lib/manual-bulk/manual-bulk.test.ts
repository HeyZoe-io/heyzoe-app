import assert from "node:assert/strict";
import { phoneFromWaMessageSessionId } from "@/lib/manual-bulk/session-phone";
import {
  clampManualBulkWeeks,
  estimateManualBulkSendDurationMinutes,
  membershipRecipientKey,
  talkedRecipientKey,
  MANUAL_BULK_DRAIN_INTERVAL_MINUTES,
  MANUAL_BULK_FLUSH_LIMIT,
} from "@/lib/manual-bulk/constants";
import { membershipTypeMatchesFilter } from "@/lib/manual-bulk/audience";
import { isApprovedMarketingTemplate } from "@/lib/manual-bulk/preview";
import { flushDueManualBulkSends } from "@/lib/manual-bulk/dispatch";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import { decideScheduledDrainDispatch, isDuePendingScheduledSend } from "@/lib/scheduled-template-sends";
import {
  estimateManualBulkFinishAt,
  resolveManualBulkSchedule,
} from "@/lib/manual-bulk/schedule";

{
  assert.deepEqual(phoneFromWaMessageSessionId("wa_123456789_972501234567"), {
    ok: true,
    phone: "972501234567",
  });
  assert.deepEqual(phoneFromWaMessageSessionId("wa_123456789_+972501234567"), {
    ok: true,
    phone: "972501234567",
  });
  assert.equal(phoneFromWaMessageSessionId("dashboard-session").ok, false);
  assert.equal(phoneFromWaMessageSessionId("").ok, false);
  assert.equal(phoneFromWaMessageSessionId("wa_only").ok, false);
}

{
  assert.equal(estimateManualBulkSendDurationMinutes(0), 0);
  assert.equal(estimateManualBulkSendDurationMinutes(1), MANUAL_BULK_DRAIN_INTERVAL_MINUTES);
  assert.equal(
    estimateManualBulkSendDurationMinutes(MANUAL_BULK_FLUSH_LIMIT),
    MANUAL_BULK_DRAIN_INTERVAL_MINUTES
  );
  assert.equal(
    estimateManualBulkSendDurationMinutes(MANUAL_BULK_FLUSH_LIMIT + 1),
    MANUAL_BULK_DRAIN_INTERVAL_MINUTES * 2
  );
}

{
  assert.equal(clampManualBulkWeeks(4), 4);
  assert.equal(clampManualBulkWeeks(0), 1);
  assert.equal(clampManualBulkWeeks(99), 12);
}

{
  assert.equal(membershipTypeMatchesFilter("מנוי שנתי", []), true);
  assert.equal(membershipTypeMatchesFilter("מנוי שנתי", ["מנוי שנתי"]), true);
  assert.equal(membershipTypeMatchesFilter("כרטיסייה", ["מנוי שנתי"]), false);
}

{
  assert.equal(membershipRecipientKey(111), "arbox_user:111");
  assert.equal(talkedRecipientKey("abc", "972501234567"), "contact:abc");
  assert.equal(talkedRecipientKey(null, "972501234567"), "phone:972501234567");
}

{
  assert.equal(
    isApprovedMarketingTemplate({
      name: "winback",
      status: "APPROVED",
      category: "MARKETING",
      disabled: false,
    }),
    true
  );
  assert.equal(
    isApprovedMarketingTemplate({
      name: "winback",
      status: "APPROVED",
      category: "UTILITY",
      disabled: false,
    }),
    false
  );
  assert.equal(
    isApprovedMarketingTemplate({
      name: "winback",
      status: "PENDING",
      category: "MARKETING",
      disabled: false,
    }),
    false
  );
  assert.equal(
    isApprovedMarketingTemplate({
      name: "winback",
      status: "APPROVED",
      category: "MARKETING",
      disabled: true,
    }),
    false
  );
}

/** no schedule → due_at = now; dispatches next allowed tick */
{
  const now = israelWallTimeToUtc("2026-09-03", "14:00");
  const r = resolveManualBulkSchedule({ now });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.scheduled, false);
    assert.equal(r.dueAt.toISOString(), now.toISOString());
    assert.equal(r.dispatchAt.toISOString(), now.toISOString());
    assert.equal(r.windowAdjusted, false);
    assert.equal(
      isDuePendingScheduledSend({ status: "pending", due_at: r.dueAt.toISOString() }, now),
      true
    );
    assert.equal(decideScheduledDrainDispatch(now).action, "dispatch");
  }

  const nightNow = israelWallTimeToUtc("2026-09-03", "02:00");
  const night = resolveManualBulkSchedule({ now: nightNow });
  assert.equal(night.ok, true);
  if (night.ok) {
    assert.equal(night.dueAt.toISOString(), nightNow.toISOString());
    assert.equal(night.dispatchAt.toISOString(), israelWallTimeToUtc("2026-09-03", "06:30").toISOString());
    assert.equal(night.windowAdjusted, true);
    assert.equal(decideScheduledDrainDispatch(nightNow).action, "hold");
    assert.equal(decideScheduledDrainDispatch(night.dispatchAt).action, "dispatch");
  }
}

/** weekday future → holds until due_at, then dispatches */
{
  const now = israelWallTimeToUtc("2026-09-03", "11:00");
  const r = resolveManualBulkSchedule({ scheduledAtRaw: "2026-09-03T14:00", now });
  assert.equal(r.ok, true);
  if (r.ok) {
    const due = israelWallTimeToUtc("2026-09-03", "14:00");
    assert.equal(r.dueAt.toISOString(), due.toISOString());
    assert.equal(r.dispatchAt.toISOString(), due.toISOString());
    assert.equal(r.windowAdjusted, false);
    assert.equal(
      isDuePendingScheduledSend({ status: "pending", due_at: r.dueAt.toISOString() }, now),
      false
    );
    assert.equal(
      isDuePendingScheduledSend({ status: "pending", due_at: r.dueAt.toISOString() }, due),
      true
    );
    assert.equal(decideScheduledDrainDispatch(due).action, "dispatch");
    const finish = estimateManualBulkFinishAt(81, r.dispatchAt);
    assert.equal(
      finish.getTime(),
      due.getTime() + 2 * MANUAL_BULK_DRAIN_INTERVAL_MINUTES * 60 * 1000
    );
  }
}

/** scheduled into night/Shabbat → due_at stays; guard holds to next allowed tick */
{
  const now = israelWallTimeToUtc("2026-09-03", "11:00");
  const night = resolveManualBulkSchedule({ scheduledAtRaw: "2026-09-04T02:00", now });
  assert.equal(night.ok, true);
  if (night.ok) {
    assert.equal(night.dueAt.toISOString(), israelWallTimeToUtc("2026-09-04", "02:00").toISOString());
    assert.equal(night.dispatchAt.toISOString(), israelWallTimeToUtc("2026-09-04", "06:30").toISOString());
    assert.equal(night.windowAdjusted, true);
    assert.equal(decideScheduledDrainDispatch(night.dueAt).action, "hold");
    assert.equal(decideScheduledDrainDispatch(night.dispatchAt).action, "dispatch");
  }

  const shabbat = resolveManualBulkSchedule({ scheduledAtRaw: "2026-09-05T10:00", now });
  assert.equal(shabbat.ok, true);
  if (shabbat.ok) {
    assert.equal(shabbat.dueAt.toISOString(), israelWallTimeToUtc("2026-09-05", "10:00").toISOString());
    assert.equal(shabbat.dispatchAt.toISOString(), israelWallTimeToUtc("2026-09-05", "19:00").toISOString());
    assert.equal(shabbat.windowAdjusted, true);
    assert.equal(decideScheduledDrainDispatch(shabbat.dueAt).action, "hold");
    assert.equal(decideScheduledDrainDispatch(shabbat.dispatchAt).action, "dispatch");
  }
}

/** past time → rejected */
{
  const now = israelWallTimeToUtc("2026-09-03", "14:00");
  const past = resolveManualBulkSchedule({ scheduledAtRaw: "2026-09-03T11:00", now });
  assert.equal(past.ok, false);
  if (!past.ok) assert.equal(past.error, "schedule_in_past");

  const bad = resolveManualBulkSchedule({ scheduledAtRaw: "not-a-date", now });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error, "invalid_schedule_time");
}

void (async () => {
  const night = israelWallTimeToUtc("2026-09-03", "02:00");
  const exploding = new Proxy(
    {},
    {
      get() {
        throw new Error("M1 drain must not query when the send window is closed");
      },
    }
  ) as never;
  const out = await flushDueManualBulkSends(exploding, night.toISOString(), night);
  assert.equal(out.held, true);
  assert.equal(out.sent, 0);
  assert.equal(out.fetched, 0);
  assert.equal(decideScheduledDrainDispatch(night).action, "hold");

  const afternoon = israelWallTimeToUtc("2026-09-03", "14:00");
  assert.equal(decideScheduledDrainDispatch(afternoon).action, "dispatch");

  console.log("manual-bulk.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
