import assert from "node:assert/strict";
import {
  arboxFlagYes,
  buildExpiringMembershipsReportPath,
  computeMembershipExpiringDueAt,
  formatDateYmdIsrael,
  isMembershipEndDateInPast,
  isMembershipExpiringPastDue,
  MEMBERSHIP_EXPIRING_PAST_DUE_GRACE_MS,
  parseEndDateYmd,
  rowHasRenewal,
  type ArboxExpiringMembershipRow,
} from "@/lib/leads/arbox-membership-expiring";
import { buildMembershipExpiringScheduledDedupKey } from "@/lib/scheduled-template-sends";
import { pickMembershipExpiringTemplateTriggerRule } from "@/lib/template-triggers-match";

/** Arbox yes/no flags. */
{
  assert.equal(arboxFlagYes("yes"), true);
  assert.equal(arboxFlagYes("no"), false);
  assert.equal(arboxFlagYes(true), true);
  assert.equal(arboxFlagYes(null), false);
}

/** renewed → skipped (has_another_plan / has_another_session / alias). */
{
  const renewedPlan: ArboxExpiringMembershipRow = {
    membership_user_id: 1,
    user_id: 2,
    has_another_plan: "yes",
    has_another_session: "no",
  };
  assert.equal(rowHasRenewal(renewedPlan), true);

  const renewedSession: ArboxExpiringMembershipRow = {
    membership_user_id: 1,
    user_id: 2,
    has_another_plan: "no",
    has_another_session: "yes",
  };
  assert.equal(rowHasRenewal(renewedSession), true);

  const renewedPackAlias: ArboxExpiringMembershipRow = {
    membership_user_id: 1,
    user_id: 2,
    has_another_plan: "no",
    has_another_session_pack: "yes",
  };
  assert.equal(rowHasRenewal(renewedPackAlias), true);

  const notRenewed: ArboxExpiringMembershipRow = {
    membership_user_id: 1,
    user_id: 2,
    has_another_plan: "no",
    has_another_session: "no",
  };
  assert.equal(rowHasRenewal(notRenewed), false);
}

/** before-direction due_at: end_date - delay_days; delay=0 → end_date itself. */
{
  const due0 = computeMembershipExpiringDueAt("2026-08-20", {
    delay_days: 0,
    delay_direction: "before",
  });
  assert.equal(due0.toISOString().slice(0, 10), "2026-08-20");

  const due7 = computeMembershipExpiringDueAt("2026-08-20", {
    delay_days: 7,
    delay_direction: "before",
  });
  assert.equal(due7.toISOString().slice(0, 10), "2026-08-13");

  // missing direction defaults to before
  const dueDefault = computeMembershipExpiringDueAt("2026-08-20", { delay_days: 3 });
  assert.equal(dueDefault.toISOString().slice(0, 10), "2026-08-17");
}

/** past-due → skipped (beyond grace). */
{
  const now = new Date("2026-08-10T15:00:00.000Z");
  const dueYesterday = new Date("2026-08-09T12:00:00.000Z");
  assert.equal(isMembershipExpiringPastDue(dueYesterday, now), true);

  const dueJustNow = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
  assert.equal(
    isMembershipExpiringPastDue(dueJustNow, now, MEMBERSHIP_EXPIRING_PAST_DUE_GRACE_MS),
    false
  );

  const dueFuture = new Date("2026-08-13T12:00:00.000Z");
  assert.equal(isMembershipExpiringPastDue(dueFuture, now), false);
}

/** Guard: end_date already before today Israel. */
{
  const now = new Date("2026-08-10T12:00:00+03:00");
  assert.equal(formatDateYmdIsrael(now), "2026-08-10");
  assert.equal(isMembershipEndDateInPast("2026-08-09", now), true);
  assert.equal(isMembershipEndDateInPast("2026-08-10", now), false);
  assert.equal(isMembershipEndDateInPast("2026-08-11", now), false);
}

/** Dedup key per (membership_user_id, end_date) — renewed later expiry is new. */
{
  const k1 = buildMembershipExpiringScheduledDedupKey(1, "trig-a", 99, "2026-08-20");
  const k2 = buildMembershipExpiringScheduledDedupKey(1, "trig-a", 99, "2026-08-20");
  const k3 = buildMembershipExpiringScheduledDedupKey(1, "trig-a", 99, "2026-11-20");
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);

  const seen = new Set<string>();
  function tryProcess(membershipUserId: number, endDate: string): "ok" | "dedup" {
    const key = `1:${membershipUserId}:${endDate}`;
    if (seen.has(key)) return "dedup";
    seen.add(key);
    return "ok";
  }
  assert.equal(tryProcess(99, "2026-08-20"), "ok");
  assert.equal(tryProcess(99, "2026-08-20"), "dedup");
  assert.equal(tryProcess(99, "2026-11-20"), "ok");
}

/** no_rule: empty / missing template → null. */
{
  assert.equal(pickMembershipExpiringTemplateTriggerRule([]), null);
  assert.equal(
    pickMembershipExpiringTemplateTriggerRule([
      {
        id: "e1",
        business_id: 1,
        trigger_type: "membership_expiring",
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
  const picked = pickMembershipExpiringTemplateTriggerRule([
    {
      id: "e2",
      business_id: 1,
      trigger_type: "membership_expiring",
      product_filter: null,
      delay_days: 7,
      delay_direction: "before",
      template_name: "T_expiring",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ]);
  assert.equal(picked?.template_name, "T_expiring");
}

/** parse + path. */
{
  assert.equal(parseEndDateYmd("2026-08-20"), "2026-08-20");
  assert.equal(parseEndDateYmd("bad"), null);
  const path = buildExpiringMembershipsReportPath({
    fromDate: "2026-08-02",
    toDate: "2026-09-01",
    locationId: "3068",
  });
  assert.match(path, /expiringMembershipsReport/);
  assert.match(path, /fromDate=2026-08-02/);
  assert.match(path, /toDate=2026-09-01/);
}

console.log("arbox-membership-expiring.test.ts: ok");
