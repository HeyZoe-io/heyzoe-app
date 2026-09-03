import assert from "node:assert/strict";
import {
  ARBOX_SYNC_SEND_ATTEMPT_CAP,
  isCancellationSyncLogTerminal,
  membershipCancelledReportDateRange,
  nextCancellationSyncLogAfterDispatch,
  normalizeCancelledTimePk,
  parseCancellationUserId,
  parseCancelledEventDate,
  seedMembershipCancelledReportDateRange,
  shouldRetryCancellationSyncLog,
  warnAbandonedCancellationSyncLog,
} from "@/lib/leads/arbox-membership-cancelled";
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
    delay_days: 0,
    delay_direction: "after",
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
    "ביטול המנוי {{1}} עודכן במערכת בהצלחה✔️ תוקף המנוי הינו עד תאריך {{2}}."
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

console.log("arbox-membership-cancelled.test.ts: ok");
