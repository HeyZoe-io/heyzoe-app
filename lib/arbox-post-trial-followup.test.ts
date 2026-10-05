import assert from "node:assert/strict";
import {
  addDaysYmd,
  combinePostTrialTemplateDispatches,
  effectivePostTrialDelayDays,
  isPostTrialConversionSale,
  isPostTrialDecisionDue,
  orderSameTriggerTemplateRules,
  outcomeForTrialAttendance,
  postTrialDecisionYmd,
  SAME_TRIGGER_TEMPLATE_GAP_MS,
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

{
  const ordered = orderSameTriggerTemplateRules([
    {
      id: "newer",
      template_name: "registered_after_trial1",
      created_at: "2026-09-28T12:37:18.000Z",
    },
    {
      id: "base",
      template_name: "registered_after_trial",
      created_at: "2026-09-28T12:35:16.000Z",
    },
    { id: "", template_name: "ignored", created_at: "2026-01-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(
    ordered.map((rule) => rule.template_name),
    ["registered_after_trial", "registered_after_trial1"]
  );
  assert.equal(SAME_TRIGGER_TEMPLATE_GAP_MS, 5_000);
  assert.equal(combinePostTrialTemplateDispatches(["immediate", "immediate"]), "immediate");
  assert.equal(combinePostTrialTemplateDispatches(["immediate", "send_failed"]), "send_failed");
  assert.equal(combinePostTrialTemplateDispatches(["gated"]), "gated");
}

assert.equal(triggerTypeForOutcome("registered"), "registered_after_trial");
assert.equal(triggerTypeForOutcome("not_registered"), "not_registered_after_trial");
assert.equal(isPostTrialFollowupTriggerType("registered_after_trial"), true);
assert.equal(isPostTrialFollowupTriggerType("trial_attended"), false);
assert.equal(minDelayDaysForTrigger("registered_after_trial"), 2);
assert.equal(minDelayDaysForTrigger("not_registered_after_trial"), 1);
assert.equal(defaultDelayDays("not_registered_after_trial"), 3);
assert.equal(formatDelayLabel("registered_after_trial", 3, "after"), "3 ימים אחרי הניסיון");
assert.equal(formatDelayLabel("not_registered_after_trial", 1, "after"), "1 ימים אחרי הניסיון");
assert.equal(effectivePostTrialDelayDays("not_registered_after_trial", 1), 1);
assert.equal(effectivePostTrialDelayDays("registered_after_trial", 1), 2);
assert.equal(postTrialDecisionYmd("2026-09-01", 1), "2026-09-02");
assert.equal(
  isPostTrialDecisionDue({
    classDateYmd: "2026-09-01",
    delayDays: 1,
    todayYmd: "2026-09-02",
  }),
  true
);

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
  assert.equal(TEMPLATE_PRESETS.registered_after_trial.category, "UTILITY");
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
