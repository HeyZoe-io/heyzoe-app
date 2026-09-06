import assert from "node:assert/strict";
import {
  addDaysYmd,
  isPostTrialConversionSale,
  isPostTrialDecisionDue,
  outcomeForTrialAttendance,
  postTrialDecisionYmd,
  triggerTypeForOutcome,
} from "@/lib/leads/arbox-post-trial-followup";
import type { ArboxSalesReportRow } from "@/lib/leads/arbox-trial-sale-registered";
import { buildPostTrialFollowupScheduledDedupKey } from "@/lib/scheduled-template-sends";
import {
  classNameFromScheduledDedupKey,
  resolveTemplateBodyParamValues,
} from "@/lib/template-send-params";
import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  defaultDelayDays,
  formatDelayLabel,
  isPostTrialFollowupTriggerType,
  minDelayDaysForTrigger,
} from "@/lib/trigger-catalog";

assert.equal(addDaysYmd("2026-09-01", 3), "2026-09-04");
assert.equal(postTrialDecisionYmd("2026-09-01", 3), "2026-09-04");
assert.equal(
  isPostTrialDecisionDue({ classDateYmd: "2026-09-01", delayDays: 3, todayYmd: "2026-09-03" }),
  false
);
assert.equal(
  isPostTrialDecisionDue({ classDateYmd: "2026-09-01", delayDays: 3, todayYmd: "2026-09-04" }),
  true
);

/** Trial product never counts as conversion — even if item_type looks like plan. */
{
  assert.equal(
    isPostTrialConversionSale({ item_type: "trial", membership_type_id: 99 }, []),
    false
  );
  assert.equal(
    isPostTrialConversionSale(
      { item_type: "plan", membership_type_id: 55, item_name: "מנוי חודשי" },
      [55]
    ),
    false,
    "trial membership_type_id must not count"
  );
  assert.equal(
    isPostTrialConversionSale(
      { item_type: "session", membership_type_id: 9, item_name: "כרטיסיית ניסיון" },
      []
    ),
    false,
    "trial-like item_name must not count"
  );
}

/** plan and session (non-trial) are real conversions → C5. */
{
  assert.equal(
    isPostTrialConversionSale(
      { item_type: "plan", membership_type_id: 10, item_name: "מנוי חודשי" },
      [55]
    ),
    true
  );
  assert.equal(
    isPostTrialConversionSale(
      { item_type: "session", membership_type_id: 11, item_name: "כרטיסייה 10" },
      [55]
    ),
    true
  );
  assert.equal(
    isPostTrialConversionSale(
      { item_type: "service", membership_type_id: 12, item_name: "עיסוי" },
      []
    ),
    false
  );
}

/** Session punch-card after trial → registered (C5), not C6. */
{
  const sales: ArboxSalesReportRow[] = [
    {
      sale_id: 1,
      user_id: 100,
      date: "2026-09-03",
      membership_type_id: 11,
      item_type: "session",
      item_name: "כרטיסייה 10 כניסות",
    },
  ];
  assert.equal(
    outcomeForTrialAttendance({
      userId: 100,
      classDateYmd: "2026-09-01",
      salesRows: sales,
      trialMembershipTypeIds: [55],
    }),
    "registered"
  );
}

/** Buying the trial product itself → still not_registered (C6). */
{
  const sales: ArboxSalesReportRow[] = [
    {
      sale_id: 2,
      user_id: 100,
      date: "2026-09-01",
      membership_type_id: 55,
      item_type: "trial",
      item_name: "שיעור ניסיון",
    },
    {
      sale_id: 3,
      user_id: 100,
      date: "2026-09-02",
      membership_type_id: 55,
      item_type: "plan",
      item_name: "מנוי ניסיון",
    },
  ];
  assert.equal(
    outcomeForTrialAttendance({
      userId: 100,
      classDateYmd: "2026-09-01",
      salesRows: sales,
      trialMembershipTypeIds: [55],
    }),
    "not_registered"
  );
}

/** No post-trial purchase → C6. */
{
  assert.equal(
    outcomeForTrialAttendance({
      userId: 100,
      classDateYmd: "2026-09-01",
      salesRows: [],
      trialMembershipTypeIds: [55],
    }),
    "not_registered"
  );
}

assert.equal(triggerTypeForOutcome("registered"), "registered_after_trial");
assert.equal(triggerTypeForOutcome("not_registered"), "not_registered_after_trial");
assert.equal(isPostTrialFollowupTriggerType("registered_after_trial"), true);
assert.equal(isPostTrialFollowupTriggerType("trial_attended"), false);
assert.equal(minDelayDaysForTrigger("registered_after_trial"), 2);
assert.equal(defaultDelayDays("not_registered_after_trial"), 3);
assert.equal(formatDelayLabel("registered_after_trial", 3, "after"), "3 ימים אחרי הניסיון");

{
  const key = buildPostTrialFollowupScheduledDedupKey(
    "registered",
    1,
    "rule",
    100,
    "2026-09-01",
    "יוגה"
  );
  assert.match(key, /^registered_after_trial:1:rule:100:2026-09-01#/);
  assert.equal(classNameFromScheduledDedupKey(key), "יוגה");
}

{
  assert.equal(TEMPLATE_PRESETS.registered_after_trial.category, "MARKETING");
  assert.equal(TEMPLATE_PRESETS.not_registered_after_trial.category, "MARKETING");
  assert.deepEqual(
    resolveTemplateBodyParamValues({
      triggerType: "registered_after_trial",
      storedComponents: [{ type: "BODY", text: TEMPLATE_PRESETS.registered_after_trial.body }],
      firstName: "דנה כהן",
      className: "HIIT",
    }),
    ["דנה", "HIIT"]
  );
}

console.log("arbox-post-trial-followup.test.ts: ok");
