import assert from "node:assert/strict";
import {
  ARBOX_SYNC_SEND_ATTEMPT_CAP,
  isCancellationSyncLogTerminal,
  cancellationEventInLiveWindow,
  isExactDaysAfterEvent,
  isMembershipCancelledQuietHours,
  isMembershipCancelledWinBackStep,
  lookbackDaysForSequenceDelays,
  membershipCancelledLiveWindow,
  membershipCancelledReportDateRange,
  syncArboxMembershipCancelledForBusiness,
  nextCancellationSyncLogAfterDispatch,
  normalizeCancelledTimePk,
  parseCancellationUserId,
  parseCancelledEventDate,
  seedMembershipCancelledReportDateRange,
  shouldRetryCancellationSyncLog,
  shouldSkipCancelledWinBackBecauseActive,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
import { ARBOX_DAILY_TRIGGER_TYPES } from "@/lib/leads/arbox-daily-triggers-dispatch";
import {
  buildMembershipCancelledScheduledDedupKey,
  encodeCancelledTimeDedupToken,
} from "@/lib/scheduled-template-sends";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  expiryYmdFromScheduledDedupKey,
  membershipTypeNameFromScheduledDedupKey,
  resolveTemplateBodyParamValues,
  TEMPLATE_MEMBERSHIP_TYPE_FALLBACK,
} from "@/lib/template-send-params";
import {
  cancellationRowMatchesProductFilter,
  matchingMembershipCancelledTemplateTriggerRules,
  pickMembershipCancelledTemplateTriggerRule,
  type PurchaseTemplateTriggerRule,
} from "@/lib/template-triggers-match";

function rule(
  partial: Partial<PurchaseTemplateTriggerRule> & { id: string }
): PurchaseTemplateTriggerRule {
  return {
    business_id: 1,
    trigger_type: "membership_cancelled",
    product_filter: null,
    item_type_filter: null,
    delay_days: 0,
    delay_direction: "after",
    lookback_days: null,
    template_name: "membership_cancelled",
    enabled: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

{
  assert.equal(normalizeCancelledTimePk("  2026-08-15 14:30:00  "), "2026-08-15 14:30:00");
  assert.equal(normalizeCancelledTimePk(""), null);
  assert.equal(normalizeCancelledTimePk(null), null);
  assert.equal(parseCancellationUserId(44123), 44123);
  assert.equal(parseCancellationUserId("0"), null);
}

{
  const now = new Date("2026-09-03T10:00:00.000Z");
  const seed = seedMembershipCancelledReportDateRange(now);
  assert.equal(seed.toDate, "2026-09-03");
  assert.equal(seed.fromDate, "2026-08-04");

  const forward = membershipCancelledReportDateRange({ seeded: true, now });
  assert.equal(forward.toDate, "2026-09-03");
  assert.equal(forward.fromDate, "2026-09-02");

  const seq = membershipCancelledReportDateRange({ seeded: true, now, lookbackDays: 21 });
  assert.equal(seq.toDate, "2026-09-03");
  assert.equal(seq.fromDate, "2026-09-02");

  const first = membershipCancelledReportDateRange({ seeded: false, now });
  assert.deepEqual(first, seed);
}

{
  const event = parseCancelledEventDate("2026-08-15 14:30:00", new Date("2026-09-03T00:00:00Z"));
  assert.equal(event.toISOString().startsWith("2026-08-15T12:00:00"), true);
}

{
  assert.equal(encodeCancelledTimeDedupToken("2026-08-15 14:30:00"), "2026-08-15_14_30_00");
  const key = buildMembershipCancelledScheduledDedupKey(
    1,
    "rule-uuid",
    44123,
    "2026-08-15 14:30:00",
    "2026-09-01",
    "מנוי חודשי"
  );
  assert.match(key, /^membership_cancelled:1:rule-uuid:44123:/);
  assert.equal(expiryYmdFromScheduledDedupKey(key), "2026-09-01");
  assert.equal(membershipTypeNameFromScheduledDedupKey(key), "מנוי חודשי");

  const noEnd = buildMembershipCancelledScheduledDedupKey(
    1,
    "rule-uuid",
    44123,
    "2026-08-15",
    null,
    "יוגה"
  );
  assert.equal(expiryYmdFromScheduledDedupKey(noEnd), null);
  assert.equal(membershipTypeNameFromScheduledDedupKey(noEnd), "יוגה");
}

{
  const nameById = new Map<number, string>([
    [10, "מנוי חודשי"],
    [20, "כרטיסייה"],
  ]);
  const catchAll = rule({ id: "catch", product_filter: null, updated_at: "2026-09-01T00:00:00Z" });
  const specific = rule({
    id: "spec",
    product_filter: [10],
    updated_at: "2026-09-02T00:00:00Z",
  });
  const other = rule({ id: "other", product_filter: [20] });

  assert.equal(cancellationRowMatchesProductFilter("מנוי חודשי", catchAll, nameById), true);
  assert.equal(cancellationRowMatchesProductFilter("מנוי חודשי", specific, nameById), true);
  assert.equal(cancellationRowMatchesProductFilter("מנוי חודשי", other, nameById), false);

  const picked = pickMembershipCancelledTemplateTriggerRule(
    [catchAll, specific, other],
    "מנוי חודשי",
    nameById
  );
  assert.equal(picked?.id, "spec");

  const unmatched = pickMembershipCancelledTemplateTriggerRule([other], "מנוי חודשי", nameById);
  assert.equal(unmatched, null);

  const onlyCatch = pickMembershipCancelledTemplateTriggerRule(
    [catchAll],
    "מנוי לא מוכר",
    nameById
  );
  assert.equal(onlyCatch?.id, "catch");

  const day0 = rule({ id: "d0", delay_days: 0, updated_at: "2026-09-01T00:00:00Z" });
  const day7 = rule({ id: "d7", delay_days: 7, updated_at: "2026-09-02T00:00:00Z" });
  const matchingAll = matchingMembershipCancelledTemplateTriggerRules(
    [day0, day7, other],
    "מנוי חודשי",
    nameById
  );
  assert.deepEqual(
    matchingAll.map((r) => r.id).sort(),
    ["d0", "d7"]
  );
  assert.equal(
    isExactDaysAfterEvent({ eventYmd: "2026-09-03", todayYmd: "2026-09-03", delayDays: 0 }),
    true
  );
  assert.equal(lookbackDaysForSequenceDelays([0, 7, 21], 1), 21);
}

{
  const active = new Set<number>([44123]);
  assert.equal(isMembershipCancelledWinBackStep(0), false);
  assert.equal(isMembershipCancelledWinBackStep(7), true);
  assert.equal(
    shouldSkipCancelledWinBackBecauseActive({
      delayDays: 0,
      userId: 44123,
      activeCustomerIds: active,
    }),
    false,
    "day-of confirmation still sends after rejoin"
  );
  assert.equal(
    shouldSkipCancelledWinBackBecauseActive({
      delayDays: 7,
      userId: 44123,
      activeCustomerIds: active,
    }),
    true
  );
  assert.equal(
    shouldSkipCancelledWinBackBecauseActive({
      delayDays: 21,
      userId: 99,
      activeCustomerIds: active,
    }),
    false
  );
}

{
  const values = resolveTemplateBodyParamValues({
    triggerType: "membership_cancelled",
    storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.membership_cancelled.body }],
    membershipTypeName: "מנוי אימון אישי",
    expiryDateYmd: "2026-09-01",
  });
  assert.deepEqual(values, ["מנוי אימון אישי", "01.09.2026"]);

  const fallbacks = resolveTemplateBodyParamValues({
    triggerType: "membership_cancelled",
    storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.membership_cancelled.body }],
  });
  assert.deepEqual(fallbacks, [TEMPLATE_MEMBERSHIP_TYPE_FALLBACK, "בקרוב"]);
}

{
  assert.equal(TEMPLATE_PRESETS.membership_cancelled.category, "UTILITY");
  assert.equal(
    TEMPLATE_PRESETS.membership_cancelled.body,
    "ביטול המנוי {{1}} עודכן במערכת בהצלחה✔️ תוקף המנוי הינו עד תאריך {{2}}. אין צורך בפעולה נוספת."
  );
  assert.doesNotMatch(TEMPLATE_PRESETS.membership_cancelled.body, /נשמח לראותך/);
  assert.equal(TEMPLATE_PRESETS.membership_cancelled.button_text, undefined);
}

{
  assert.equal(ARBOX_SYNC_SEND_ATTEMPT_CAP, 3);
  assert.equal(shouldRetryCancellationSyncLog(null), true);
  assert.equal(shouldRetryCancellationSyncLog("pending"), true);
  assert.equal(shouldRetryCancellationSyncLog("sent"), false);
  assert.equal(shouldRetryCancellationSyncLog("abandoned"), false);
  assert.equal(isCancellationSyncLogTerminal("abandoned"), true);
  assert.equal(isCancellationSyncLogTerminal("pending"), false);

  const nameSkip = nextCancellationSyncLogAfterDispatch({ dispatch: "skipped", attemptsSoFar: 0 });
  assert.deepEqual(nameSkip, { attempts: 0, status: "skipped", hitCap: false });
  assert.equal(shouldRetryCancellationSyncLog(nameSkip.status), false);
  const nameSkipAgain = nextCancellationSyncLogAfterDispatch({
    dispatch: "skipped",
    attemptsSoFar: 2,
  });
  assert.deepEqual(nameSkipAgain, { attempts: 2, status: "skipped", hitCap: false });

  const gated = nextCancellationSyncLogAfterDispatch({ dispatch: "gated", attemptsSoFar: 0 });
  assert.deepEqual(gated, { attempts: 0, status: "pending", hitCap: false });
  const gatedAgain = nextCancellationSyncLogAfterDispatch({
    dispatch: "gated",
    attemptsSoFar: gated.attempts,
  });
  assert.deepEqual(gatedAgain, { attempts: 0, status: "pending", hitCap: false });

  let row = nextCancellationSyncLogAfterDispatch({ dispatch: "gated", attemptsSoFar: 0 });
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(shouldRetryCancellationSyncLog(row.status), true);
    row = nextCancellationSyncLogAfterDispatch({
      dispatch: "send_failed",
      attemptsSoFar: row.attempts,
    });
  }
  assert.deepEqual(row, { attempts: 3, status: "abandoned", hitCap: true });
  assert.equal(shouldRetryCancellationSyncLog(row.status), false);

  let recovered = nextCancellationSyncLogAfterDispatch({
    dispatch: "send_failed",
    attemptsSoFar: 0,
  });
  assert.deepEqual(recovered, { attempts: 1, status: "pending", hitCap: false });
  recovered = nextCancellationSyncLogAfterDispatch({
    dispatch: "immediate",
    attemptsSoFar: recovered.attempts,
  });
  assert.deepEqual(recovered, { attempts: 1, status: "sent", hitCap: false });
  assert.equal(shouldRetryCancellationSyncLog(recovered.status), false);
}

{
  const warns: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args);
  };
  try {
    warnAbandonedCancellationSyncLog({ businessId: 7, abandoned: 0, reason: "send_failed_cap" });
    warnAbandonedCancellationSyncLog({ businessId: 7, abandoned: 4, reason: "send_failed_cap" });
    assert.equal(warns.length, 1);
    assert.equal(warns[0]![0], "[leads/arbox-membership-cancelled] abandoned send_failed rows");
    assert.deepEqual(warns[0]![1], {
      business_id: 7,
      abandoned: 4,
      reason: "send_failed_cap",
    });
  } finally {
    console.warn = originalWarn;
  }
}

{
  const quietNight = new Date("2026-10-05T21:05:00+03:00");
  const justAfterMidnight = new Date("2026-10-06T00:05:00+03:00");
  const twoAm = new Date("2026-10-06T02:00:00+03:00");
  const eightAm = new Date("2026-10-06T08:00:00+03:00");
  assert.equal(isMembershipCancelledQuietHours(quietNight), true);
  assert.equal(isMembershipCancelledQuietHours(justAfterMidnight), true);
  assert.equal(isMembershipCancelledQuietHours(twoAm), true);
  assert.equal(isMembershipCancelledQuietHours(eightAm), false);
  assert.equal(cancellationEventInLiveWindow("2026-10-05", justAfterMidnight), true);
  assert.deepEqual(membershipCancelledLiveWindow(eightAm), {
    fromDate: "2026-10-05",
    toDate: "2026-10-06",
  });
  assert.equal(cancellationEventInLiveWindow("2026-10-05", eightAm), true);
  assert.equal(cancellationEventInLiveWindow("2026-10-04", eightAm), false);
}

type LogRow = { status: string; user_id: number; cancelled_time: string };

function mockAdmin(input: { rules: Record<string, unknown>[]; logs: LogRow[] }) {
  const reportCalls = { n: 0 };
  return {
    reportCalls,
    admin: {
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const builder = {
          select() {
            return builder;
          },
          in() {
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return builder;
          },
          maybeSingle() {
            if (table !== "arbox_cancellation_sync_log") {
              return Promise.resolve({ data: null, error: null });
            }
            const match =
              input.logs.find(
                (row) =>
                  row.user_id === filters.user_id && row.cancelled_time === filters.cancelled_time
              ) ?? null;
            return Promise.resolve({ data: match, error: null });
          },
          upsert(row: LogRow) {
            input.logs.push(row);
            return Promise.resolve({ error: null });
          },
          update() {
            return { eq: () => Promise.resolve({ error: null }) };
          },
          then(
            onFulfilled: (value: { data: unknown; error: null; count: number }) => unknown
          ) {
            const data = table === "template_triggers" ? input.rules : table === "contacts" ? [] : input.logs;
            return Promise.resolve({
              data,
              error: null,
              count: table === "arbox_cancellation_sync_log" ? input.logs.length : 0,
            }).then(onFulfilled);
          },
        };
        return builder;
      },
    },
  };
}

const cancelRule = {
  id: "rule-1",
  business_id: 1,
  trigger_type: "membership_cancelled",
  product_filter: null,
  item_type_filter: null,
  delay_days: 7,
  delay_direction: "after",
  template_name: "membership_cancelled",
  enabled: true,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const cancelRow = {
  user_id: 9,
  cancelled_time: "2026-10-05 23:55:00",
  membership_type_name: "מנוי",
  end_date: "2026-11-01",
};

async function runCancel(input: {
  now: Date;
  rules: Record<string, unknown>[];
  logs: LogRow[];
  seeded: boolean;
}) {
  let reportCalls = 0;
  const mocked = mockAdmin({ rules: input.rules, logs: input.logs });
  const summary = await syncArboxMembershipCancelledForBusiness({
    admin: mocked.admin as never,
    businessId: 1,
    businessSlug: "apex",
    apiKey: "key",
    boxId: "box",
    cancellationSeeded: input.seeded,
    now: input.now,
    fetchReport: async () => {
      reportCalls += 1;
      return { ok: true, rows: [cancelRow], pagesFetched: 1, hitPageCap: false };
    },
  });
  return { summary, reportCalls };
}

async function windowCases() {
  const midnight = new Date("2026-10-06T00:05:00+03:00");
  const twoAm = new Date("2026-10-06T02:00:00+03:00");
  const eight = new Date("2026-10-06T08:05:00+03:00");

  const atMidnight = await runCancel({
    now: midnight,
    rules: [cancelRule],
    logs: [],
    seeded: true,
  });
  assert.equal(atMidnight.reportCalls, 0);
  assert.equal(atMidnight.summary.skip_reason, "quiet_hours");
  assert.equal(atMidnight.summary.notified, 0);

  const atTwo = await runCancel({
    now: twoAm,
    rules: [cancelRule],
    logs: [],
    seeded: true,
  });
  assert.equal(atTwo.reportCalls, 0);
  assert.equal(atTwo.summary.notified, 0);

  const logs: LogRow[] = [
    { status: "sent", user_id: 1, cancelled_time: "2026-01-01 00:00:00" },
  ];
  const firstMorning = await runCancel({
    now: eight,
    rules: [cancelRule],
    logs,
    seeded: true,
  });
  assert.equal(firstMorning.reportCalls, 1);
  assert.equal(firstMorning.summary.no_phone, 1);
  assert.equal(firstMorning.summary.notified, 0);
  assert.equal(logs.length, 2);

  const secondMorning = await runCancel({
    now: eight,
    rules: [cancelRule],
    logs,
    seeded: true,
  });
  assert.equal(secondMorning.summary.already, 1);
  assert.equal(secondMorning.summary.no_phone, 0);
  assert.equal(logs.length, 2);

  const noRule = await runCancel({
    now: eight,
    rules: [],
    logs: [],
    seeded: true,
  });
  assert.equal(noRule.reportCalls, 0);
  assert.equal(noRule.summary.skip_reason, "no_rule");

  const seeded = await runCancel({
    now: eight,
    rules: [cancelRule],
    logs: [],
    seeded: false,
  });
  assert.equal(seeded.reportCalls, 1);
  assert.equal(seeded.summary.notified, 0);
  assert.ok((seeded.summary.seeded ?? 0) >= 1);
  assert.equal(
    (ARBOX_DAILY_TRIGGER_TYPES as readonly string[]).includes("membership_cancelled"),
    false
  );
}

windowCases()
  .then(() => console.log("arbox-membership-cancelled.test.ts: ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
