import assert from "node:assert/strict";
import {
  bookingMatchesTrialScope,
  buildBookingsReportPath,
  isBookingCheckedIn,
  isTrialClassAttended,
  membershipTypeNameLooksLikeTrial,
  normalizeMembershipTypeName,
  trialAttendedLookbackWindow,
  type ArboxBookingReportRow,
} from "@/lib/leads/arbox-trial-attended";
import { pickTrialAttendedTemplateTriggerRule } from "@/lib/template-triggers-match";

/** check_in="Yes" fires; "No" skipped (string equality — "No" is truthy). */
{
  assert.equal(isBookingCheckedIn("Yes"), true);
  assert.equal(isTrialClassAttended("Yes"), true);
  assert.equal(isBookingCheckedIn("No"), false);
  assert.equal(isBookingCheckedIn("no"), false);
  assert.equal(isBookingCheckedIn(null), false);
}

/** Trial name match (bookingsReport has name only, not membership_type_id on live API). */
{
  const names = new Set([
    normalizeMembershipTypeName("שיעור ניסיון"),
    normalizeMembershipTypeName("שיעור ניסיון- זוג"),
  ]);
  const scope = { trialTypeIds: [80601, 144543], trialTypeNamesNormalized: names };

  const trialYes: ArboxBookingReportRow = {
    user_id: 1,
    check_in: "Yes",
    membership_type_name: "שיעור ניסיון",
    date: "2026-08-02",
  };
  assert.equal(bookingMatchesTrialScope(trialYes, scope), true);
  assert.equal(isBookingCheckedIn(trialYes.check_in) && bookingMatchesTrialScope(trialYes, scope), true);

  const trialNo: ArboxBookingReportRow = {
    user_id: 2,
    check_in: "No",
    membership_type_name: "שיעור ניסיון",
    date: "2026-08-02",
  };
  assert.equal(isBookingCheckedIn(trialNo.check_in), false);

  const memberYes: ArboxBookingReportRow = {
    user_id: 3,
    check_in: "Yes",
    membership_type_name: "4 Classes/ Month | מנוי יחיד",
    date: "2026-08-02",
  };
  assert.equal(bookingMatchesTrialScope(memberYes, scope), false);

  // Defensive: if API ever adds membership_type_id
  assert.equal(
    bookingMatchesTrialScope(
      { user_id: 4, membership_type_id: 80601, membership_type_name: "other", check_in: "Yes" },
      scope
    ),
    true
  );

  assert.equal(membershipTypeNameLooksLikeTrial("שיעור ניסיון- זוג"), true);
  assert.equal(membershipTypeNameLooksLikeTrial("Unlimited | מנוי יחיד"), false);
  assert.equal(normalizeMembershipTypeName("Acroyoga pass (x10)\t- Couples"), "acroyoga pass (x10) - couples");
}

/** Lookback window catches a late-marked class (not only today). */
{
  const now = new Date("2026-08-03T12:00:00+03:00");
  const w = trialAttendedLookbackWindow(now, 7);
  assert.equal(w.toDate, "2026-08-03");
  assert.equal(w.fromDate, "2026-07-28");
  // class from a few days ago is inside window
  assert.ok(w.fromDate <= "2026-08-02" && "2026-08-02" <= w.toDate);
}

/** Dedup per (user_id, class_date). */
{
  const seen = new Set<string>();
  function tryProcess(userId: number, classDate: string): "ok" | "dedup" {
    const key = `1:${userId}:${classDate}`;
    if (seen.has(key)) return "dedup";
    seen.add(key);
    return "ok";
  }
  assert.equal(tryProcess(99, "2026-08-02"), "ok");
  assert.equal(tryProcess(99, "2026-08-02"), "dedup");
  assert.equal(tryProcess(99, "2026-08-01"), "ok");
}

/** no_rule: empty / missing template → null. */
{
  assert.equal(pickTrialAttendedTemplateTriggerRule([]), null);
  const picked = pickTrialAttendedTemplateTriggerRule([
    {
      id: "t2",
      business_id: 1,
      trigger_type: "trial_attended",
      product_filter: [80601],
      delay_days: 0,
      delay_direction: "after",
      template_name: "T_attended",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ]);
  assert.equal(picked?.template_name, "T_attended");
  assert.deepEqual(picked?.product_filter, [80601]);
}

/** Path uses bookingsReport + lookback range. */
{
  const path = buildBookingsReportPath({
    fromDate: "2026-07-28",
    toDate: "2026-08-03",
    locationId: "3068",
  });
  assert.match(path, /bookingsReport/);
  assert.match(path, /fromDate=2026-07-28/);
  assert.match(path, /toDate=2026-08-03/);
  assert.doesNotMatch(path, /trialClassesReport/);
}

console.log("arbox-trial-attended.test.ts: ok");
