import assert from "node:assert/strict";
import {
  addDaysYmd,
  endingVariantForUser,
  freezeCreatedReportWindows,
  freezeCreatedShouldNotify,
  freezeCreatedStartInSpan,
  freezeReportFetchWindow,
  freezeTablesNeedingSoftSeed,
  futureBookingUserIds,
  isFreezeCreatedQuietHours,
  isFreezeEndingDue,
  isHoldEndInFuture,
  parseHoldId,
} from "@/lib/leads/arbox-freeze";
import { ARBOX_DAILY_TRIGGER_TYPES } from "@/lib/leads/arbox-daily-triggers-dispatch";
import { ARBOX_TRIAL_SYNC_TRIGGER_TYPES } from "@/lib/leads/arbox-trial-sync-run";
import { freezeCreatedTemplateParamValues } from "@/lib/template-send-params";
import { buildMembersOnHoldReportPath } from "@/lib/leads/arbox-members-on-hold-report";
import {
  buildFreezeCreatedScheduledDedupKey,
  buildFreezeEndingScheduledDedupKey,
} from "@/lib/scheduled-template-sends";
import {
  classNameFromScheduledDedupKey,
  expiryYmdFromScheduledDedupKey,
  resolveTemplateBodyParamValues,
  startDateYmdFromScheduledDedupKey,
} from "@/lib/template-send-params";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  allowsDelayBefore,
  defaultDelayDays,
  defaultDelayDirection,
  formatDelayLabel,
  isFreezeEndingTriggerType,
  isImmediateDelayTrigger,
} from "@/lib/trigger-catalog";
import type { ArboxBookingReportRow } from "@/lib/leads/arbox-trial-attended";

assert.equal(parseHoldId(99101), 99101);
assert.equal(parseHoldId("0"), null);

{
  const path = buildMembersOnHoldReportPath({
    fromDate: "2026-09-01",
    toDate: "2026-09-20",
    locationId: "42",
  });
  assert.match(path, /membersOnHoldReport\?/);
  assert.match(path, /fromDate=2026-09-01/);
  assert.match(path, /location_id=42/);
  const p2 = buildMembersOnHoldReportPath({
    fromDate: "2026-09-01",
    toDate: "2026-09-20",
    locationId: "42",
    page: 2,
  });
  assert.match(p2, /page=2/);
}

{
  const w = freezeReportFetchWindow({
    now: new Date("2026-09-06T12:00:00.000Z"),
    maxEndingDelayDays: 7,
  });
  assert.equal(w.fromDate, "2026-08-30");
  assert.equal(w.toDate, "2026-09-20");
}

assert.equal(addDaysYmd("2026-09-10", -3), "2026-09-07");
assert.equal(isHoldEndInFuture("2026-09-10", "2026-09-06"), true);
assert.equal(isHoldEndInFuture("2026-09-06", "2026-09-06"), false);
assert.equal(isHoldEndInFuture("2026-09-05", "2026-09-06"), false);

/** Past end_suspend_time → no C14/C15 send. */
{
  assert.equal(
    isFreezeEndingDue({ endYmd: "2026-09-05", delayDays: 3, todayYmd: "2026-09-06" }),
    false,
    "ended hold must not be due"
  );
  assert.equal(
    isFreezeEndingDue({ endYmd: "2026-09-06", delayDays: 3, todayYmd: "2026-09-06" }),
    false,
    "end today is not future"
  );
  assert.equal(
    isFreezeEndingDue({ endYmd: "2026-09-10", delayDays: 3, todayYmd: "2026-09-06" }),
    false,
    "too early before window"
  );
  assert.equal(
    isFreezeEndingDue({ endYmd: "2026-09-10", delayDays: 3, todayYmd: "2026-09-07" }),
    true
  );
  assert.equal(
    isFreezeEndingDue({ endYmd: "2026-09-10", delayDays: 3, todayYmd: "2026-09-09" }),
    true
  );
}

/** Future booking split for C14 vs C15. */
{
  const future: ArboxBookingReportRow[] = [
    {
      user_id: 10,
      date: "2026-09-12",
      check_in: "",
      phone: "0501111111",
      full_name: "דנה",
      class_name: "HIIT",
      time: "18:00",
    },
  ];
  const byUser = futureBookingUserIds(future, "2026-09-06");
  assert.equal(endingVariantForUser(10, byUser), "booked");
  assert.equal(endingVariantForUser(99, byUser), "unbooked");
  assert.equal(byUser.get(10)?.className, "HIIT");
}

/**
 * A8 and C14 do not block each other — separate sync_log tables / key spaces.
 * Created key is hold-only; ending key is hold+end. Same hold_id can appear in both.
 */
{
  const created = buildFreezeCreatedScheduledDedupKey(
    1,
    "rule-a8",
    555,
    "2026-09-01",
    "2026-09-20"
  );
  const ending = buildFreezeEndingScheduledDedupKey(
    "unbooked",
    1,
    "rule-c14",
    555,
    "2026-09-20"
  );
  assert.match(created, /^freeze_created:1:rule-a8:555:2026-09-01:2026-09-20$/);
  assert.match(ending, /^freeze_ending_unbooked:1:rule-c14:555:2026-09-20$/);
  assert.notEqual(created.split(":")[0], ending.split(":")[0]);
  assert.equal(startDateYmdFromScheduledDedupKey(created), "2026-09-01");
  assert.equal(expiryYmdFromScheduledDedupKey(created), "2026-09-20");
  assert.equal(expiryYmdFromScheduledDedupKey(ending), "2026-09-20");
}

/**
 * C14/C15: one ending message per hold end even when booking state flips.
 * Dedup key / sync_log PK is hold+end (variant not in identity for blocking).
 * Variant only chooses which template fires on first successful attempt.
 */
{
  const holdId = 777;
  const endYmd = "2026-09-20";
  const unbookedKey = buildFreezeEndingScheduledDedupKey(
    "unbooked",
    1,
    "r14",
    holdId,
    endYmd
  );
  const bookedKey = buildFreezeEndingScheduledDedupKey(
    "booked",
    1,
    "r15",
    holdId,
    endYmd,
    "יוגה"
  );
  // Different template prefixes, but sync_log onConflict is hold+end only —
  // after first terminal status, second variant is skipped (handler `already`).
  assert.equal(unbookedKey.includes(String(holdId)), true);
  assert.equal(bookedKey.includes(endYmd), true);
  assert.equal(classNameFromScheduledDedupKey(bookedKey), "יוגה");
  assert.equal(classNameFromScheduledDedupKey(unbookedKey), null);

  const byUserEmpty = futureBookingUserIds([], "2026-09-06");
  const byUserBooked = futureBookingUserIds(
    [
      {
        user_id: 42,
        date: "2026-09-15",
        check_in: "",
        phone: "050",
        full_name: "x",
        class_name: "יוגה",
        time: "10:00",
      },
    ],
    "2026-09-06"
  );
  assert.equal(endingVariantForUser(42, byUserEmpty), "unbooked");
  assert.equal(endingVariantForUser(42, byUserBooked), "booked");
}

/** Seed without WhatsApp — soft-seed only after flag; full seed is separate path. */
{
  assert.deepEqual(
    freezeTablesNeedingSoftSeed({
      freezeSeeded: false,
      createdRuleEnabled: true,
      endingRuleEnabled: true,
      createdLogCount: 0,
      endingLogCount: 0,
    }),
    { softSeedCreated: false, softSeedEnding: false },
    "before flag: full seed path, not soft-seed"
  );
  assert.deepEqual(
    freezeTablesNeedingSoftSeed({
      freezeSeeded: true,
      createdRuleEnabled: true,
      endingRuleEnabled: false,
      createdLogCount: 0,
      endingLogCount: 0,
    }),
    { softSeedCreated: true, softSeedEnding: false },
    "empty created table soft-seeds without send"
  );
  assert.deepEqual(
    freezeTablesNeedingSoftSeed({
      freezeSeeded: true,
      createdRuleEnabled: true,
      endingRuleEnabled: true,
      createdLogCount: 5,
      endingLogCount: 0,
    }),
    { softSeedCreated: false, softSeedEnding: true },
    "A8 rows do not fill ending table — C14 soft-seed independent"
  );
}

{
  assert.equal(isImmediateDelayTrigger("freeze_created"), true);
  assert.equal(isFreezeEndingTriggerType("freeze_ending_unbooked"), true);
  assert.equal(isFreezeEndingTriggerType("freeze_ending_booked"), true);
  assert.equal(allowsDelayBefore("freeze_ending_unbooked"), true);
  assert.equal(defaultDelayDirection("freeze_ending_booked"), "before");
  assert.equal(defaultDelayDays("freeze_ending_unbooked"), 3);
  assert.equal(formatDelayLabel("freeze_created", 0, "after"), "נשלח מיד");
  assert.equal(
    formatDelayLabel("freeze_ending_unbooked", 3, "before"),
    "3 ימים לפני סיום ההקפאה"
  );
  assert.equal(
    formatDelayLabel("freeze_ending_booked", 0, "before"),
    "ביום סיום ההקפאה"
  );
}

{
  assert.equal(TEMPLATE_PRESETS.freeze_created.category, "UTILITY");
  assert.equal(TEMPLATE_PRESETS.freeze_ending_unbooked.category, "UTILITY");
  assert.equal(TEMPLATE_PRESETS.freeze_ending_booked.category, "UTILITY");
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "freeze_created",
      storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.freeze_created.body }],
      firstName: "דנה כהן",
      startDateYmd: "2026-09-01",
      expiryDateYmd: "2026-09-20",
    }),
    ["דנה", "01/09/2026", "20/09/2026"]
  );
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "freeze_ending_unbooked",
      storedComponents: [
        { type: "BODY", text: TEMPLATE_PRESETS.freeze_ending_unbooked.body },
      ],
      firstName: "דנה כהן",
      expiryDateYmd: "2026-09-20",
    }),
    ["דנה", "20.09.2026"]
  );
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "freeze_ending_booked",
      storedComponents: [
        { type: "BODY", text: TEMPLATE_PRESETS.freeze_ending_booked.body },
      ],
      firstName: "דנה כהן",
      className: "יוגה",
      expiryDateYmd: "2026-09-20",
    }),
    ["דנה", "יוגה", "20.09.2026"]
  );
}

{
  const daytime = new Date("2026-10-05T10:00:00+03:00");
  const windows = freezeCreatedReportWindows(daytime);
  assert.equal(windows.length, 2, "yesterday..today+60 is two calls under the 31-day cap");
  assert.equal(windows[0]?.fromDate, "2026-10-04");
  assert.equal(windows[1]?.toDate, "2026-12-04");
  for (const window of windows) {
    const from = Date.parse(`${window.fromDate}T00:00:00Z`);
    const to = Date.parse(`${window.toDate}T00:00:00Z`);
    assert.ok((to - from) / 86_400_000 <= 30);
  }
  assert.equal(freezeCreatedStartInSpan("2026-11-05", daytime), true, "start next month is in the window");
  assert.equal(
    freezeCreatedShouldNotify({ startYmd: "2026-11-05", now: daytime, priorStatus: null }),
    "send"
  );
  assert.equal(
    freezeCreatedShouldNotify({ startYmd: "2026-11-05", now: daytime, priorStatus: "sent" }),
    "skip_already"
  );
  const night = new Date("2026-10-05T23:30:00+03:00");
  assert.equal(isFreezeCreatedQuietHours(night), true);
  assert.equal(
    freezeCreatedShouldNotify({ startYmd: "2026-11-05", now: night, priorStatus: null }),
    "skip_quiet"
  );
  const afterEight = new Date("2026-10-06T08:00:00+03:00");
  assert.equal(isFreezeCreatedQuietHours(afterEight), false);
  assert.equal(
    freezeCreatedShouldNotify({ startYmd: "2026-11-05", now: afterEight, priorStatus: null }),
    "send"
  );
  assert.equal(
    (ARBOX_DAILY_TRIGGER_TYPES as readonly string[]).includes("freeze_created"),
    false
  );
  assert.equal(
    (ARBOX_TRIAL_SYNC_TRIGGER_TYPES as readonly string[]).includes("freeze_created"),
    true
  );
  assert.equal(
    (ARBOX_DAILY_TRIGGER_TYPES as readonly string[]).includes("freeze_ending_booked"),
    true
  );
}

{
  const components = (body: string) => [{ type: "BODY", text: body }];
  assert.deepEqual(
    freezeCreatedTemplateParamValues({
      storedComponents: components("ההקפאה נרשמה."),
      firstName: "דנה כהן",
      startYmd: "2026-11-05",
      endYmd: "2026-12-01",
    }),
    { ok: true, values: [] }
  );
  assert.deepEqual(
    freezeCreatedTemplateParamValues({
      storedComponents: components("היי {{1}}"),
      firstName: "דנה כהן",
      startYmd: "2026-11-05",
      endYmd: "2026-12-01",
    }),
    { ok: true, values: ["דנה"] }
  );
  assert.deepEqual(
    freezeCreatedTemplateParamValues({
      storedComponents: components(TEMPLATE_PRESETS.freeze_created.body),
      firstName: "דנה כהן",
      startYmd: "2026-11-05",
      endYmd: "2026-12-01",
    }),
    { ok: true, values: ["דנה", "05/11/2026", "01/12/2026"] }
  );
  assert.deepEqual(
    freezeCreatedTemplateParamValues({
      storedComponents: components("היי {{1}} עד {{2}}"),
      firstName: "דנה",
      startYmd: "2026-11-05",
      endYmd: "2026-12-01",
    }),
    { ok: false, varCount: 2 }
  );
}

console.log("arbox-freeze.test.ts: ok");
