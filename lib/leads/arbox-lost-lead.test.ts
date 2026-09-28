import assert from "node:assert/strict";
import {
  buildLostLeadRecentCheckInIndex,
  LOST_LEAD_LOOKBACK_DAYS,
  LOST_LEAD_RECENT_CHECKIN_DAYS,
  LOST_LEAD_SEED_SPAN_DAYS,
  lostLeadNeedsSoftSeed,
  lostLeadRecentCheckInYmd,
  lostLeadReportDateRange,
  normalizeLostDatePk,
  parseLostEventDate,
  parseLostLeadId,
  seedLostLeadReportDateRange,
} from "@/lib/leads/arbox-lost-lead";
import {
  isExactDaysAfterEvent,
  lookbackDaysForSequenceDelays,
} from "@/lib/leads/arbox-membership-cancelled";
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
  assert.equal(minDelayDaysForTrigger("lost_lead"), 1);
  assert.equal(defaultDelayDays("lost_lead"), 1);
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

console.log("arbox-lost-lead.test.ts: ok");
