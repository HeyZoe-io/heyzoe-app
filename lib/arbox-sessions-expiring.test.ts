import assert from "node:assert/strict";
import { arboxFlagYes } from "@/lib/leads/arbox-membership-expiring";
import {
  buildExpiringSessionsReportPath,
  computeSessionsExpiringDueAt,
  isSessionsEndDateWithinHorizon,
  rowHasSessionRenewal,
  type ArboxExpiringSessionRow,
} from "@/lib/leads/arbox-sessions-expiring";
import { buildSessionsExpiringScheduledDedupKey } from "@/lib/scheduled-template-sends";
import { pickSessionsExpiringTemplateTriggerRule } from "@/lib/template-triggers-match";

/** renewed → skipped (has_another_session / has_another_plan; string "yes"). */
{
  const renewedSession: ArboxExpiringSessionRow = {
    user_id: 1,
    has_another_session: "yes",
    has_another_plan: "no",
  };
  assert.equal(rowHasSessionRenewal(renewedSession), true);

  const renewedPlan: ArboxExpiringSessionRow = {
    user_id: 1,
    has_another_session: "no",
    has_another_plan: "yes",
  };
  assert.equal(rowHasSessionRenewal(renewedPlan), true);

  const renewedPackAlias: ArboxExpiringSessionRow = {
    user_id: 1,
    has_another_session: "no",
    has_another_plan: "no",
    has_another_session_pack: "yes",
  };
  assert.equal(rowHasSessionRenewal(renewedPackAlias), true);

  const notRenewed: ArboxExpiringSessionRow = {
    user_id: 1,
    has_another_session: "no",
    has_another_plan: "no",
  };
  assert.equal(rowHasSessionRenewal(notRenewed), false);
}

/** string-flag "no" must not skip as renewed; arboxFlagYes("no") is false. */
{
  assert.equal(arboxFlagYes("no"), false);
  assert.equal(arboxFlagYes("yes"), true);
  assert.equal(
    rowHasSessionRenewal({
      user_id: 9,
      has_another_session: "no",
      has_another_plan: "no",
      cancelled: "no",
    }),
    false
  );
  assert.equal(arboxFlagYes("no"), false); // cancelled "no" → do not skip
}

/** before-direction due_at: end_date - delay_days; delay=0 → end_date itself. */
{
  const due0 = computeSessionsExpiringDueAt("2026-08-20", {
    delay_days: 0,
    delay_direction: "before",
  });
  assert.equal(due0.toISOString().slice(0, 10), "2026-08-20");

  const due7 = computeSessionsExpiringDueAt("2026-08-20", {
    delay_days: 7,
    delay_direction: "before",
  });
  assert.equal(due7.toISOString().slice(0, 10), "2026-08-13");

  const dueDefault = computeSessionsExpiringDueAt("2026-08-20", { delay_days: 3 });
  assert.equal(dueDefault.toISOString().slice(0, 10), "2026-08-17");
}

/** Dedup per (user_id, start_date, end_date) — renewed later expiry is new. */
{
  const k1 = buildSessionsExpiringScheduledDedupKey(1, "trig-a", 99, "2026-01-01", "2026-08-20");
  const k2 = buildSessionsExpiringScheduledDedupKey(1, "trig-a", 99, "2026-01-01", "2026-08-20");
  const k3 = buildSessionsExpiringScheduledDedupKey(1, "trig-a", 99, "2026-06-01", "2026-11-20");
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);

  const seen = new Set<string>();
  function tryProcess(userId: number, start: string, end: string): "ok" | "dedup" {
    const key = `1:${userId}:${start}:${end}`;
    if (seen.has(key)) return "dedup";
    seen.add(key);
    return "ok";
  }
  assert.equal(tryProcess(99, "2026-01-01", "2026-08-20"), "ok");
  assert.equal(tryProcess(99, "2026-01-01", "2026-08-20"), "dedup");
  assert.equal(tryProcess(99, "2026-06-01", "2026-11-20"), "ok");
}

/** no_rule: empty / missing template → null. */
{
  assert.equal(pickSessionsExpiringTemplateTriggerRule([]), null);
  assert.equal(
    pickSessionsExpiringTemplateTriggerRule([
      {
        id: "s1",
        business_id: 1,
        trigger_type: "sessions_expiring",
        product_filter: null,
        delay_days: 7,
        delay_direction: "before",
        template_name: "",
        enabled: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: null,
      },
    ]),
    null
  );
  const picked = pickSessionsExpiringTemplateTriggerRule([
    {
      id: "s2",
      business_id: 1,
      trigger_type: "sessions_expiring",
      product_filter: null,
      delay_days: 7,
      delay_direction: "before",
      template_name: "T_sessions_expiring",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ]);
  assert.equal(picked?.template_name, "T_sessions_expiring");
}

/** path + horizon filter. */
{
  const path = buildExpiringSessionsReportPath({
    fromDate: "2026-08-03",
    toDate: "2026-09-02",
    locationId: "3068",
  });
  assert.match(path, /expiringSessionsReport/);
  assert.match(path, /fromDate=2026-08-03/);
  assert.match(path, /toDate=2026-09-02/);

  const window = { fromDate: "2026-08-03", toDate: "2026-09-02" };
  assert.equal(isSessionsEndDateWithinHorizon("2026-08-20", window), true);
  assert.equal(isSessionsEndDateWithinHorizon("2028-06-16", window), false);
  assert.equal(isSessionsEndDateWithinHorizon("2026-08-02", window), false);
}

console.log("arbox-sessions-expiring.test.ts: ok");
