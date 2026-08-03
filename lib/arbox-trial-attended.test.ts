import assert from "node:assert/strict";
import {
  buildTrialClassesReportPath,
  formatDateYmdIsrael,
  isTrialClassAttended,
  trialAttendedClassDateForRule,
} from "@/lib/leads/arbox-trial-attended";
import { pickTrialAttendedTemplateTriggerRule } from "@/lib/template-triggers-match";

/** check_in="Yes" fires; "No" skipped (string equality — "No" is truthy). */
{
  assert.equal(isTrialClassAttended("Yes"), true);
  assert.equal(isTrialClassAttended("yes"), true);
  assert.equal(isTrialClassAttended("No"), false);
  assert.equal(isTrialClassAttended("no"), false);
  assert.equal(isTrialClassAttended(""), false);
  assert.equal(isTrialClassAttended(null), false);
}

/** delay maps the right class_date (after 1 = yesterday; 0 = today). */
{
  const now = new Date("2026-08-10T12:00:00+03:00");
  assert.equal(formatDateYmdIsrael(now), "2026-08-10");
  assert.equal(
    trialAttendedClassDateForRule({ delay_days: 1, delay_direction: "after" }, now),
    "2026-08-09"
  );
  assert.equal(
    trialAttendedClassDateForRule({ delay_days: 0, delay_direction: "after" }, now),
    "2026-08-10"
  );
  assert.equal(
    trialAttendedClassDateForRule({ delay_days: 3, delay_direction: "after" }, now),
    "2026-08-07"
  );
  assert.equal(trialAttendedClassDateForRule({ delay_days: 1 }, now), "2026-08-09");
}

/** Dedup key per (user_id, class_date). */
{
  const seen = new Set<string>();
  function tryProcess(userId: number, classDate: string): "ok" | "dedup" {
    const key = `1:${userId}:${classDate}`;
    if (seen.has(key)) return "dedup";
    seen.add(key);
    return "ok";
  }
  assert.equal(tryProcess(99, "2026-08-09"), "ok");
  assert.equal(tryProcess(99, "2026-08-09"), "dedup");
  assert.equal(tryProcess(99, "2026-08-10"), "ok");
  assert.equal(tryProcess(100, "2026-08-09"), "ok");
}

/** no_rule: empty / missing template → null. */
{
  assert.equal(pickTrialAttendedTemplateTriggerRule([]), null);
  assert.equal(
    pickTrialAttendedTemplateTriggerRule([
      {
        id: "t1",
        business_id: 1,
        trigger_type: "trial_attended",
        product_filter: [80601],
        delay_days: 1,
        delay_direction: "after",
        template_name: "",
        enabled: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: null,
      },
    ]),
    null
  );
  const picked = pickTrialAttendedTemplateTriggerRule([
    {
      id: "t2",
      business_id: 1,
      trigger_type: "trial_attended",
      product_filter: null,
      delay_days: 1,
      delay_direction: "after",
      template_name: "T_attended",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ]);
  assert.equal(picked?.template_name, "T_attended");
  const withFilter = pickTrialAttendedTemplateTriggerRule([
    {
      id: "t3",
      business_id: 1,
      trigger_type: "trial_attended",
      product_filter: [80601],
      delay_days: 1,
      delay_direction: "after",
      template_name: "T_any_attendee",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
  ]);
  assert.equal(withFilter?.template_name, "T_any_attendee");
}

/** Path uses trialClassesReport + single-day window. */
{
  const path = buildTrialClassesReportPath({
    fromDate: "2026-08-09",
    toDate: "2026-08-09",
    locationId: "3068",
  });
  assert.match(path, /trialClassesReport/);
  assert.match(path, /fromDate=2026-08-09/);
  assert.match(path, /toDate=2026-08-09/);
}

console.log("arbox-trial-attended.test.ts: ok");
