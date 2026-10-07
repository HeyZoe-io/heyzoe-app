import assert from "node:assert/strict";
import {
  buildLostLeadRecentCheckInIndex,
  distinctLostLeadDailyDelays,
  isLostLeadImmediateDue,
  LOST_LEAD_LOOKBACK_DAYS,
  LOST_LEAD_RECENT_CHECKIN_DAYS,
  LOST_LEAD_SEED_SPAN_DAYS,
  lostLeadImmediateWindow,
  lostLeadNeedsSoftSeed,
  lostLeadRecentCheckInYmd,
  lostLeadReportDateRange,
  lostLeadRulesForLane,
  lostLeadShouldFetchRecentCheckIns,
  lostLeadTargetYmd,
  normalizeLostDatePk,
  parseLostEventDate,
  parseLostLeadId,
  seedLostLeadReportDateRange,
  syncArboxLostLeadForBusiness,
} from "@/lib/leads/arbox-lost-lead";
import {
  isExactDaysAfterEvent,
  lookbackDaysForSequenceDelays,
  shouldRetryCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import { eventBeforeRuleActivation } from "@/lib/rule-activation";
import { SALES_FLOW_START_TRIGGERS } from "@/lib/sales-flow-start-triggers";
import { buildLostLeadScheduledDedupKey } from "@/lib/scheduled-template-sends";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  resolveTemplateBodyParamValues,
  triggerTypeFromScheduledDedupKey,
} from "@/lib/template-send-params";
import {
  defaultDelayDays,
  formatDelayLabel,
  isUniquePerBusinessTriggerType,
  minDelayDaysForTrigger,
  uniqueCreateModeFor,
} from "@/lib/trigger-catalog";

{
  assert.equal(normalizeLostDatePk("  2026-08-15 14:30:00  "), "2026-08-15 14:30:00");
  assert.equal(normalizeLostDatePk(""), null);
  assert.equal(normalizeLostDatePk(null), null);
  assert.equal(parseLostLeadId({ lead_id: 44123 }), 44123);
  assert.equal(parseLostLeadId({ user_id: 44123 }), 44123);
  assert.equal(parseLostLeadId({ lead_id: "9", user_id: 1 }), 9);
  assert.equal(parseLostLeadId({ lead_id: "0" }), null);
}

{
  assert.equal(LOST_LEAD_SEED_SPAN_DAYS, 30);
  assert.equal(LOST_LEAD_LOOKBACK_DAYS, 3);

  const now = new Date("2026-09-07T10:00:00.000Z");
  const seed = seedLostLeadReportDateRange(now);
  assert.equal(seed.toDate, "2026-09-07");
  assert.equal(seed.fromDate, "2026-08-08");

  const forward = lostLeadReportDateRange({ seeded: true, now });
  assert.equal(forward.toDate, "2026-09-07");
  assert.equal(forward.fromDate, "2026-09-04");

  const seq = lostLeadReportDateRange({ seeded: true, now, lookbackDays: 21 });
  assert.equal(seq.toDate, "2026-09-07");
  assert.equal(seq.fromDate, "2026-08-17");

  const first = lostLeadReportDateRange({ seeded: false, now });
  assert.deepEqual(first, seed);

  const soft = lostLeadReportDateRange({ seeded: false, now });
  assert.deepEqual(soft, seed);
}

{
  assert.equal(lostLeadNeedsSoftSeed({ lostLeadSeeded: true, logCount: 0 }), true);
  assert.equal(lostLeadNeedsSoftSeed({ lostLeadSeeded: true, logCount: 1 }), false);
  assert.equal(lostLeadNeedsSoftSeed({ lostLeadSeeded: false, logCount: 0 }), false);
}

{
  const event = parseLostEventDate("2026-08-15 14:30:00", new Date("2026-09-07T00:00:00Z"));
  assert.equal(event.toISOString().startsWith("2026-08-15T12:00:00"), true);
}

{
  const key = buildLostLeadScheduledDedupKey(1, "rule-uuid", 44123, "2026-08-15 14:30:00");
  assert.equal(key, "lost_lead:1:rule-uuid:44123:2026-08-15_14_30_00");
  assert.equal(triggerTypeFromScheduledDedupKey(key), "lost_lead");
}

{
  assert.equal(TEMPLATE_PRESETS.lost_lead.category, "MARKETING");
  assert.equal(TEMPLATE_PRESETS.lost_lead.button_text, "אשמח לפרטים");
  assert.equal(
    TEMPLATE_PRESETS.lost_lead.body,
    "היי {{1}}, יש הרבה החלטות שאנחנו נאלצים לקבל ביום-יום, אבל יש כאלה שיכולות לשדרג את החיים שלנו משמעותית 💪 בא לנו לפרגן לך באימון ניסיון במחיר הנחה - רק דרך השיחה הזו. לוחצים על הכפתור ומתחילים!"
  );
  assert.ok(SALES_FLOW_START_TRIGGERS.has("אשמח לפרטים"));
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "lost_lead",
      storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.lost_lead.body }],
      firstName: "דנה כהן",
    }),
    ["דנה"]
  );
}

{
  assert.equal(minDelayDaysForTrigger("lost_lead"), 0);
  assert.equal(defaultDelayDays("lost_lead"), 1);
  assert.equal(formatDelayLabel("lost_lead", 0, "after"), "מיידי");
  assert.equal(formatDelayLabel("lost_lead", 1, "after"), "1 ימים אחרי אובדן הליד");
  assert.equal(isUniquePerBusinessTriggerType("lost_lead"), false);
  assert.equal(uniqueCreateModeFor("lost_lead"), undefined);
}

{
  assert.equal(lookbackDaysForSequenceDelays([1], 3), 3);
  assert.equal(lookbackDaysForSequenceDelays([1, 7, 21], 3), 21);
  assert.equal(lookbackDaysForSequenceDelays([40], 3), 30);
  assert.equal(
    isExactDaysAfterEvent({ eventYmd: "2026-09-06", todayYmd: "2026-09-07", delayDays: 1 }),
    true
  );
  assert.equal(
    isExactDaysAfterEvent({ eventYmd: "2026-09-06", todayYmd: "2026-09-07", delayDays: 7 }),
    false
  );
  assert.equal(
    isExactDaysAfterEvent({ eventYmd: "2026-09-07", todayYmd: "2026-09-07", delayDays: 0 }),
    true
  );
}

{
  assert.equal(LOST_LEAD_RECENT_CHECKIN_DAYS, 30);
  const todayYmd = "2026-09-28";
  const index = buildLostLeadRecentCheckInIndex({
    todayYmd,
    rows: [
      { user_id: 11448880, phone: "058-423-9185", date: "2026-09-14", check_in: "Yes" },
      { user_id: 11448880, phone: "0584239185", date: "2026-09-01", check_in: "No" },
      { user_id: 20, phone: "0501111111", date: "2026-08-29", check_in: "Yes" },
      { user_id: 21, phone: "0502222222", date: "2026-08-28", check_in: "Yes" },
      { user_id: 22, phone: "+972503333333", date: "2026-09-28", check_in: "yes" },
      { user_id: 23, date: "2026-09-20", check_in: "Yes" },
    ],
  });
  assert.equal(
    lostLeadRecentCheckInYmd({ index, userId: 11448880, phone: "972584239185" }),
    "2026-09-14"
  );
  assert.equal(
    lostLeadRecentCheckInYmd({ index, userId: 999, phone: "972584239185" }),
    "2026-09-14"
  );
  assert.equal(lostLeadRecentCheckInYmd({ index, userId: 20, phone: null }), "2026-08-29");
  assert.equal(lostLeadRecentCheckInYmd({ index, userId: 21, phone: "972502222222" }), null);
  assert.equal(lostLeadRecentCheckInYmd({ index, userId: 22, phone: null }), "2026-09-28");
  assert.equal(lostLeadRecentCheckInYmd({ index, userId: 23, phone: null }), "2026-09-20");
  assert.equal(lostLeadRecentCheckInYmd({ index: null, userId: 11448880, phone: "972584239185" }), null);
}

{
  const today = "2026-10-07";
  assert.equal(isLostLeadImmediateDue(today, today), true);
  assert.equal(isLostLeadImmediateDue("2026-10-06", today), true);
  assert.equal(isLostLeadImmediateDue("2026-10-05", today), false);
  assert.deepEqual(lostLeadImmediateWindow(new Date("2026-10-07T06:00:00.000Z")), {
    fromDate: "2026-10-06",
    toDate: "2026-10-07",
  });
  assert.deepEqual(distinctLostLeadDailyDelays([0, 1, 45, 1]), [1, 45]);
  assert.equal(lostLeadTargetYmd(today, 45), "2026-08-23");
  assert.equal(lostLeadTargetYmd(today, 30), "2026-09-07");
  assert.deepEqual(
    lostLeadRulesForLane([{ delay_days: 0 }, { delay_days: 1 }, { delay_days: 45 }], "daily").map(
      (rule) => rule.delay_days
    ),
    [1, 45]
  );
  assert.deepEqual(
    lostLeadRulesForLane([{ delay_days: 0 }, { delay_days: 30 }], "immediate").map((rule) => rule.delay_days),
    [0]
  );
  assert.equal(
    lostLeadShouldFetchRecentCheckIns({
      lane: "immediate",
      openDueCandidates: 0,
      bookingsAlreadyProvided: false,
    }),
    false
  );
  assert.equal(
    lostLeadShouldFetchRecentCheckIns({
      lane: "immediate",
      openDueCandidates: 1,
      bookingsAlreadyProvided: false,
    }),
    true
  );
  assert.equal(shouldRetryCancellationSyncLog("sent"), false);
  assert.equal(shouldRetryCancellationSyncLog("pending"), true);
  assert.equal(
    eventBeforeRuleActivation(new Date("2026-10-06T00:00:00+03:00"), {
      id: "rule",
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-07T07:00:00.000Z",
    }),
    true
  );
  assert.equal(
    eventBeforeRuleActivation(new Date("2026-10-08T00:00:00+03:00"), {
      id: "rule",
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-07T07:00:00.000Z",
    }),
    false
  );
}

function lostLeadRule(id: string, delayDays: number) {
  return {
    id,
    business_id: 1,
    trigger_type: "lost_lead",
    delay_days: delayDays,
    delay_direction: "after",
    template_name: "lost_lead",
    enabled: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

function lostLeadAdmin(rules: ReturnType<typeof lostLeadRule>[]) {
  const writes: string[] = [];
  const admin = {
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        gte() {
          return builder;
        },
        in() {
          return builder;
        },
        limit() {
          return Promise.resolve(payload(table));
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        insert() {
          writes.push(`${table}:insert`);
          return Promise.resolve({ error: null, data: null });
        },
        upsert() {
          writes.push(`${table}:upsert`);
          return Promise.resolve({ error: null });
        },
        update() {
          writes.push(`${table}:update`);
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(payload(table)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  function payload(table: string) {
    if (table === "template_triggers") return { data: rules, error: null };
    if (table === "arbox_lost_lead_sync_log") return { data: null, error: null, count: 1 };
    return { data: [], error: null };
  }
  return { admin, writes };
}

async function runLaneCases() {
  const now = new Date("2026-10-07T06:00:00.000Z");
  const base = {
    businessId: 1,
    businessSlug: "studio",
    apiKey: "key",
    boxId: "9",
    lostLeadSeeded: true,
    now,
  };

  const empty = lostLeadAdmin([lostLeadRule("delay-0", 0)]);
  let bookingsCalls = 0;
  const emptySummary = await syncArboxLostLeadForBusiness({
    ...base,
    admin: empty.admin as never,
    lane: "immediate",
    fetchLostLeads: async () => ({ ok: true, rows: [], pagesFetched: 1, hitPageCap: false }),
    fetchBookings: async () => {
      bookingsCalls += 1;
      return { ok: true, rows: [], pagesFetched: 1 };
    },
  });
  assert.equal(bookingsCalls, 0);
  assert.equal(emptySummary.notified, 0);
  assert.equal(empty.writes.length, 0);

  const failed = lostLeadAdmin([lostLeadRule("delay-0", 0)]);
  let failedBookings = 0;
  const failedSummary = await syncArboxLostLeadForBusiness({
    ...base,
    admin: failed.admin as never,
    lane: "immediate",
    fetchLostLeads: async () => ({
      ok: true,
      rows: [{ lead_id: 44, lost_date: "2026-10-07", phone: "0501234567", full_name: "דנה" }],
      pagesFetched: 1,
      hitPageCap: false,
    }),
    fetchBookings: async () => {
      failedBookings += 1;
      return { ok: false, error: "bookings_down", pagesFetched: 0 };
    },
  });
  assert.equal(failedBookings, 1);
  assert.equal(failedSummary.notified, 0);
  assert.equal(failedSummary.fetch_error, "bookings_down");
  assert.equal(failed.writes.length, 0);

  const dailyOnly = lostLeadAdmin([lostLeadRule("delay-0", 0)]);
  let dailyFetches = 0;
  const dailySkip = await syncArboxLostLeadForBusiness({
    ...base,
    admin: dailyOnly.admin as never,
    lane: "daily",
    fetchLostLeads: async () => {
      dailyFetches += 1;
      return { ok: true, rows: [], pagesFetched: 1, hitPageCap: false };
    },
  });
  assert.equal(dailyFetches, 0);
  assert.equal(dailySkip.skip_reason, "no_rule");

  const targets: string[] = [];
  const daily = lostLeadAdmin([lostLeadRule("d1", 1), lostLeadRule("d45", 45)]);
  const dailySummary = await syncArboxLostLeadForBusiness({
    ...base,
    admin: daily.admin as never,
    lane: "daily",
    fetchLostLeads: async (input) => {
      targets.push(`${input.fromDate}=${input.toDate}`);
      return { ok: true, rows: [], pagesFetched: 1, hitPageCap: false };
    },
  });
  assert.deepEqual(targets.sort(), ["2026-08-23=2026-08-23", "2026-10-06=2026-10-06"]);
  assert.equal(dailySummary.notified, 0);
  assert.equal(daily.writes.length, 0);
}

runLaneCases().then(
  () => console.log("arbox-lost-lead.test.ts: ok"),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
