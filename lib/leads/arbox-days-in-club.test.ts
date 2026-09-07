import assert from "node:assert/strict";
import {
  collectDaysInClubMembers,
  daysInClubDedupKey,
  daysInClubDelayDays,
  daysInClubNeedsSoftSeed,
  isDaysInClubDueToday,
  memberSinceFromMembershipRow,
  parseMemberSinceYmd,
  shouldSeedDaysInClubMember,
} from "@/lib/leads/arbox-days-in-club";
import {
  nextCancellationSyncLogAfterDispatch,
} from "@/lib/leads/arbox-membership-cancelled";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import { resolveTemplateBodyParamValues } from "@/lib/template-send-params";
import {
  defaultDelayDays,
  formatDelayLabel,
  isTriggerType,
  isUniquePerBusinessTriggerType,
  minDelayDaysForTrigger,
  triggerTypeLabel,
} from "@/lib/trigger-catalog";

{
  assert.equal(parseMemberSinceYmd("2026-06-09"), "2026-06-09");
  assert.equal(parseMemberSinceYmd("2026-06-09 14:30:00"), "2026-06-09");
  assert.equal(parseMemberSinceYmd("  2026-06-09  "), "2026-06-09");
  assert.equal(parseMemberSinceYmd(""), null);
  assert.equal(parseMemberSinceYmd(null), null);
  assert.equal(parseMemberSinceYmd("06-09"), null);
}

{
  assert.equal(
    memberSinceFromMembershipRow({
      member_since: "2026-06-09",
      start_date: "2026-08-01",
    }),
    "2026-06-09"
  );
  assert.equal(
    memberSinceFromMembershipRow({
      start_date: "2026-06-09",
    }),
    null,
    "start_date is ignored — renewals move it"
  );
}

{
  const today = "2026-09-07";
  assert.equal(
    isDaysInClubDueToday({ memberSinceYmd: "2026-06-09", todayYmd: today, delayDays: 90 }),
    true
  );
  assert.equal(
    isDaysInClubDueToday({ memberSinceYmd: "2026-06-08", todayYmd: today, delayDays: 90 }),
    false,
    "day 91 — no catch-up"
  );
  assert.equal(
    isDaysInClubDueToday({ memberSinceYmd: "2026-06-10", todayYmd: today, delayDays: 90 }),
    false,
    "day 89 — wait"
  );
  assert.equal(
    isDaysInClubDueToday({ memberSinceYmd: "2026-08-08", todayYmd: today, delayDays: 30 }),
    true
  );
  assert.equal(
    isDaysInClubDueToday({ memberSinceYmd: "2026-08-08", todayYmd: today, delayDays: 90 }),
    false,
    "30-day grain does not fire the 90-day rule"
  );
}

{
  const today = "2026-09-07";
  assert.equal(
    shouldSeedDaysInClubMember({
      memberSinceYmd: "2026-06-09",
      todayYmd: today,
      delayDays: 90,
    }),
    true,
    "exactly X on first enable is seeded (no blast)"
  );
  assert.equal(
    shouldSeedDaysInClubMember({
      memberSinceYmd: "2026-01-01",
      todayYmd: today,
      delayDays: 90,
    }),
    true,
    "already past X → seed"
  );
  assert.equal(
    shouldSeedDaysInClubMember({
      memberSinceYmd: "2026-08-01",
      todayYmd: today,
      delayDays: 90,
    }),
    false,
    "not yet at X → wait for exact day"
  );
}

{
  assert.equal(daysInClubDelayDays(90), 90);
  assert.equal(daysInClubDelayDays(1), 1);
  assert.equal(daysInClubDelayDays(0), 1);
  assert.equal(daysInClubDelayDays(null), 1);
}

{
  const rows = collectDaysInClubMembers([
    {
      user_id: 11,
      status: "active",
      member_since: "2026-06-09",
      start_date: "2026-08-01",
      phone: "0501111111",
    },
    {
      user_id: 11,
      status: "active",
      member_since: "2026-06-09",
      start_date: "2026-09-01",
    },
    {
      user_id: 12,
      status: "activeMemberWithFutureCancel",
      member_since: "2026-03-01",
    },
    {
      user_id: 13,
      status: "inactive",
      member_since: "2026-06-09",
    },
    {
      user_id: 14,
      status: "active",
      start_date: "2026-06-09",
    },
    {
      user_id: 15,
      status: "active",
    },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((m) => ({ userId: m.userId, memberSinceYmd: m.memberSinceYmd })),
    [
      { userId: 11, memberSinceYmd: "2026-06-09" },
      { userId: 12, memberSinceYmd: "2026-03-01" },
    ]
  );
}

{
  const punchCardOnly = collectDaysInClubMembers([]);
  assert.equal(punchCardOnly.length, 0, "sessionsReport punch-cards never reach this collector");
}

{
  const rule30 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const rule90 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  assert.notEqual(
    daysInClubDedupKey(rule30, 11, "2026-06-09"),
    daysInClubDedupKey(rule90, 11, "2026-06-09")
  );
  assert.equal(
    daysInClubDedupKey(rule30, 11, "2026-06-09"),
    "milestones:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:11:2026-06-09"
  );
}

{
  assert.equal(daysInClubNeedsSoftSeed({ daysInClubSeeded: true, logCount: 0 }), true);
  assert.equal(daysInClubNeedsSoftSeed({ daysInClubSeeded: true, logCount: 1 }), false);
  assert.equal(daysInClubNeedsSoftSeed({ daysInClubSeeded: false, logCount: 0 }), false);
}

{
  const gated = nextCancellationSyncLogAfterDispatch({
    dispatch: "gated",
    attemptsSoFar: 0,
  });
  assert.equal(gated.status, "pending");
  assert.equal(gated.attempts, 0);
  assert.equal(gated.hitCap, false);

  const fail1 = nextCancellationSyncLogAfterDispatch({
    dispatch: "send_failed",
    attemptsSoFar: 0,
  });
  assert.equal(fail1.status, "pending");
  assert.equal(fail1.attempts, 1);

  const fail3 = nextCancellationSyncLogAfterDispatch({
    dispatch: "send_failed",
    attemptsSoFar: 2,
  });
  assert.equal(fail3.status, "abandoned");
  assert.equal(fail3.hitCap, true);
}

{
  assert.equal(isTriggerType("milestones"), true);
  assert.equal(triggerTypeLabel("milestones"), "ימים במועדון");
  assert.equal(isUniquePerBusinessTriggerType("milestones"), false);
  assert.equal(minDelayDaysForTrigger("milestones"), 1);
  assert.equal(defaultDelayDays("milestones"), 90);
  assert.equal(formatDelayLabel("milestones", 90, "after"), "90 ימים מההצטרפות");
  assert.equal(formatDelayLabel("milestones", 30, "after"), "30 ימים מההצטרפות");
}

{
  assert.equal(TEMPLATE_PRESETS.milestones.category, "MARKETING");
  assert.equal(TEMPLATE_PRESETS.milestones.name, "milestones");
  assert.equal(TEMPLATE_PRESETS.milestones.button_text, undefined);
  assert.equal(
    TEMPLATE_PRESETS.milestones.body,
    "היי {{1}}, היחס האישי ורמת האימון חשובים לנו, נשמח לשמוע איך הולך."
  );
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "milestones",
      storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.milestones.body }],
      firstName: "דנה כהן",
    }),
    ["דנה"]
  );
}

console.log("arbox-days-in-club.test.ts: ok");
