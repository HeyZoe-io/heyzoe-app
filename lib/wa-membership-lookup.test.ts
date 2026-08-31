import assert from "node:assert/strict";
import { canUseArboxScheduleLookup } from "@/lib/crm/types";
import { isScheduleInquiryIntent } from "@/lib/wa-booking-lookup";
import { isRegistrationFailedInquiry } from "@/lib/wa-registration-failed-intent";
import { matchesRegistrationIntentPhrase } from "@/lib/wa-registration-intent";
import { isScheduleIntent } from "@/lib/wa-schedule-intent";
import {
  buildArboxUserMembershipsPath,
  classifyMembershipLookup,
  hasPositiveMembershipDebt,
  isInForceMembership,
  mapMembershipLookupReply,
  MEMBERSHIP_LOOKUP_ACTIVE_DEBT_MODEL,
  MEMBERSHIP_LOOKUP_ACTIVE_DEBT_REPLY,
  MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_MODEL,
  MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_REPLY,
  MEMBERSHIP_LOOKUP_ACTIVE_MODEL,
  MEMBERSHIP_LOOKUP_ACTIVE_REPLY,
  MEMBERSHIP_LOOKUP_EXPIRED_MODEL,
  MEMBERSHIP_LOOKUP_EXPIRED_REPLY,
  MEMBERSHIP_LOOKUP_FETCH_FAILED_MODEL,
  MEMBERSHIP_LOOKUP_NOT_FOUND_MODEL,
  MEMBERSHIP_LOOKUP_NOT_FOUND_REPLY,
  parseArboxMembershipRecords,
  type ArboxUserMembershipRecord,
} from "@/lib/wa-membership-lookup";

const TODAY = "2026-08-23";

/** CRM gate: Arbox only; Boostapp / no-CRM cannot enter lookup. */
{
  assert.equal(canUseArboxScheduleLookup({ crm_type: "arbox", crm_api_key: "k", crm_box_id: "1" }), true);
  assert.equal(canUseArboxScheduleLookup({ crm_type: "arbox", crm_api_key: "k", crm_box_id: "" }), false);
  assert.equal(canUseArboxScheduleLookup({ crm_type: "boostapp", crm_api_key: "k", crm_box_id: "1" }), false);
  assert.equal(canUseArboxScheduleLookup({ crm_type: "", crm_api_key: "", crm_box_id: "" }), false);
  assert.equal(canUseArboxScheduleLookup(null), false);
}

/** Intent: registration/booking failed only — not timetable, not «רוצה להירשם», not «מתי קבענו». */
{
  const phrases = [
    "ניסיתי להירשם ולא הצלחתי",
    "ניסיתי להרשם ולא הצלחתי",
    "לא מצליח להירשם",
    "לא מצליחה להירשם",
    "לא הצלחתי להירשם",
    "ההרשמה נכשלה",
    "לא נותן לי להירשם",
    "מנסה להירשם ולא מצליח",
    "מנסה להירשם לשיעור ולא עובד",
    "ניסיתי להירשם",
    "לא מצליח לשריין מקום",
    "יש שגיאה בהרשמה",
    "האפליקציה לא נותנת לי להירשם",
    "לא נרשם לי",
    "ההרשמה לא עברה",
    "I tried to register but it failed",
    "I can't book a class",
    "registration failed",
    "the app won't let me register",
  ];
  for (const p of phrases) {
    assert.equal(isRegistrationFailedInquiry(p), true, p);
  }

  assert.equal(isRegistrationFailedInquiry("רוצה להירשם"), false);
  assert.equal(isRegistrationFailedInquiry("אני מנסה להירשם לשיעור"), false);
  assert.equal(isRegistrationFailedInquiry("מתי יש אימון"), false);
  assert.equal(isRegistrationFailedInquiry("מתי אפשר לבוא לאימון ניסיון"), false);
  assert.equal(isRegistrationFailedInquiry("מתי קבענו"), false);
  assert.equal(isRegistrationFailedInquiry("למתי נרשמתי"), false);
  assert.equal(isRegistrationFailedInquiry("כמה עולה השיעור?"), false);
  assert.equal(isRegistrationFailedInquiry("לא יודע איך להירשם"), false);
  assert.equal(isRegistrationFailedInquiry("לא נרשמתי עדיין"), false);
  assert.equal(isRegistrationFailedInquiry("פייסבוק לא עובד"), false);
  assert.equal(isRegistrationFailedInquiry("facebook doesn't work"), false);
  assert.equal(isRegistrationFailedInquiry(""), false);
}

/** Failed-registration must not steal schedule_inquiry / general timetable. */
{
  assert.equal(isScheduleInquiryIntent("מתי קבענו"), true);
  assert.equal(isRegistrationFailedInquiry("מתי קבענו"), false);
  assert.equal(isScheduleIntent("מתי יש אימון"), true);
  assert.equal(isRegistrationFailedInquiry("מתי יש אימון"), false);
  assert.equal(matchesRegistrationIntentPhrase("אני מנסה להירשם לשיעור"), true);
  assert.equal(isRegistrationFailedInquiry("אני מנסה להירשם לשיעור"), false);
}

/** In-force: active=1, not cancelled, null or future end_time. */
{
  const openEnded: ArboxUserMembershipRecord = { active: 1, cancelled: 0, end_time: null };
  assert.equal(isInForceMembership(openEnded, TODAY), true);

  const future: ArboxUserMembershipRecord = { active: 1, cancelled: 0, end_time: "2026-12-31" };
  assert.equal(isInForceMembership(future, TODAY), true);

  const todayEnd: ArboxUserMembershipRecord = {
    active: 1,
    cancelled: 0,
    end_time: "2026-08-23T09:00:00",
  };
  assert.equal(isInForceMembership(todayEnd, TODAY), true);

  const expired: ArboxUserMembershipRecord = { active: 1, cancelled: 0, end_time: "2026-08-22" };
  assert.equal(isInForceMembership(expired, TODAY), false);

  const cancelled: ArboxUserMembershipRecord = { active: 1, cancelled: 1, end_time: null };
  assert.equal(isInForceMembership(cancelled, TODAY), false);

  const inactive: ArboxUserMembershipRecord = { active: 0, cancelled: 0, end_time: "2026-12-31" };
  assert.equal(isInForceMembership(inactive, TODAY), false);

  const stringFlags: ArboxUserMembershipRecord = { active: "1", cancelled: "0", end_time: null };
  assert.equal(isInForceMembership(stringFlags, TODAY), true);

  const trialOpen: ArboxUserMembershipRecord = {
    active: 1,
    cancelled: 0,
    end_time: null,
    type: "trial",
  };
  assert.equal(isInForceMembership(trialOpen, TODAY), true);

  const withDebt: ArboxUserMembershipRecord = {
    active: 1,
    cancelled: 0,
    end_time: null,
    debt: 150,
  };
  assert.equal(isInForceMembership(withDebt, TODAY), true);
}

/** Debt: only Number(debt) > 0. Live Arbox is a non-negative number; strings coerced. Credit is not debt. */
{
  assert.equal(hasPositiveMembershipDebt(50), true);
  assert.equal(hasPositiveMembershipDebt("50"), true);
  assert.equal(hasPositiveMembershipDebt(400), true);
  assert.equal(hasPositiveMembershipDebt(0), false);
  assert.equal(hasPositiveMembershipDebt("0"), false);
  assert.equal(hasPositiveMembershipDebt(""), false);
  assert.equal(hasPositiveMembershipDebt(null), false);
  assert.equal(hasPositiveMembershipDebt(undefined), false);
  assert.equal(hasPositiveMembershipDebt(-10), false);
  assert.equal(hasPositiveMembershipDebt("-5"), false);
}

/** Classify: ACTIVE / EXPIRED / NOT-FOUND stay distinct. Full unfiltered set, not empty-filter. */
{
  const inForce: ArboxUserMembershipRecord = { active: 1, cancelled: 0, end_time: null };
  const expiredRow: ArboxUserMembershipRecord = { active: 0, cancelled: 1, end_time: "2026-01-01" };

  assert.equal(
    classifyMembershipLookup({ userFound: true, records: [inForce, expiredRow], todayYmd: TODAY }),
    "active"
  );
  assert.equal(
    classifyMembershipLookup({ userFound: true, records: [expiredRow], todayYmd: TODAY }),
    "expired"
  );
  assert.equal(classifyMembershipLookup({ userFound: true, records: [], todayYmd: TODAY }), "expired");
  assert.equal(classifyMembershipLookup({ userFound: false, records: [], todayYmd: TODAY }), "not_found");
  assert.equal(
    classifyMembershipLookup({
      userFound: false,
      records: [],
      todayYmd: TODAY,
      fetchFailed: true,
    }),
    "fetch_failed"
  );
  assert.equal(
    classifyMembershipLookup({
      userFound: true,
      records: [inForce],
      todayYmd: TODAY,
      fetchFailed: true,
    }),
    "fetch_failed"
  );

  /** 972527020655 live shape: expired session + in-force PRE-Sale → active, not expired. */
  const amirToday = "2026-08-31";
  const amirExpired: ArboxUserMembershipRecord = {
    active: 0,
    cancelled: 0,
    end_time: "2026-08-12",
    membership_type_name: "אימון בודד פילאטיס מכשירים",
  };
  const amirActive: ArboxUserMembershipRecord = {
    active: 1,
    cancelled: 0,
    start_time: "2026-08-15",
    end_time: "2026-10-14",
    membership_type_name: "PRE- Sale",
    type: "session",
  };
  assert.equal(isInForceMembership(amirActive, amirToday), true);
  assert.equal(isInForceMembership(amirExpired, amirToday), false);
  assert.equal(
    classifyMembershipLookup({
      userFound: true,
      records: [amirExpired, amirActive],
      todayYmd: amirToday,
    }),
    "active"
  );
  /** Filtered active=2 was empty — that must not be treated as expired when the full set has in-force. */
  assert.equal(
    classifyMembershipLookup({ userFound: true, records: [], todayYmd: amirToday }),
    "expired"
  );

  /** User in Arbox with only expired/cancelled cards → case 1. */
  const cancelledOnly: ArboxUserMembershipRecord = {
    active: 0,
    cancelled: 1,
    start_time: "2025-10-13",
    end_time: "2026-04-11",
  };
  assert.equal(
    classifyMembershipLookup({ userFound: true, records: [cancelledOnly], todayYmd: amirToday }),
    "expired"
  );

  /** Phone not in Arbox (no user_id) → case 3, even if leftover records were passed. */
  assert.equal(
    classifyMembershipLookup({ userFound: false, records: [amirActive], todayYmd: amirToday }),
    "not_found"
  );

  /** ACTIVE sub-branch: in-force + debt > 0 (number and string) → active_debt. */
  assert.equal(
    classifyMembershipLookup({
      userFound: true,
      records: [{ active: 1, cancelled: 0, end_time: null, debt: 50 }],
      todayYmd: TODAY,
    }),
    "active_debt"
  );
  assert.equal(
    classifyMembershipLookup({
      userFound: true,
      records: [{ active: 1, cancelled: 0, end_time: null, debt: "50" }],
      todayYmd: TODAY,
    }),
    "active_debt"
  );

  /** In-force with debt 0 / null / "0" / "" → standard ACTIVE. */
  for (const debt of [0, "0", "", null, undefined] as const) {
    assert.equal(
      classifyMembershipLookup({
        userFound: true,
        records: [{ active: 1, cancelled: 0, end_time: null, debt }],
        todayYmd: TODAY,
      }),
      "active",
      `debt=${JSON.stringify(debt)}`
    );
  }

  /** Expired-only with debt on that card → still EXPIRED. */
  assert.equal(
    classifyMembershipLookup({
      userFound: true,
      records: [{ active: 0, cancelled: 0, end_time: "2026-08-02", debt: 400 }],
      todayYmd: amirToday,
    }),
    "expired"
  );

  /** In-force debt 0 + expired card with debt → ACTIVE (debt only on in-force rows). */
  assert.equal(
    classifyMembershipLookup({
      userFound: true,
      records: [
        { active: 1, cancelled: 0, end_time: null, debt: 0 },
        { active: 0, cancelled: 0, end_time: "2026-08-02", debt: 400 },
      ],
      todayYmd: amirToday,
    }),
    "active"
  );
}

/** Memberships path: unfiltered — no `active` query (2 is not "all"). */
{
  const path = buildArboxUserMembershipsPath("11009462");
  assert.equal(path, "/v3/users/memberships?user_id=11009462");
  assert.equal(path.includes("active="), false);
}

/** Exact Hebrew copy; hyphen not em-dash; notify flags. */
{
  const active = mapMembershipLookupReply("active");
  assert.equal(active.kind, "active");
  assert.equal(active.modelUsed, MEMBERSHIP_LOOKUP_ACTIVE_MODEL);
  assert.equal(active.notifyHumanRequested, false);
  assert.equal(active.text, MEMBERSHIP_LOOKUP_ACTIVE_REPLY);
  assert.equal(
    active.text,
    "היי! אני רואה שיש לך מנוי/כרטיסיה בתוקף. אפשר לנסות שוב מהאפליקציה או שאבקש מהצוות שיחזרו אליך! בינתיים אפשר לכתוב לי לאיזה אימון ניסית להירשם?"
  );
  assert.equal(active.text.includes("—"), false);
  assert.equal(active.text.includes("כלול"), false);
  assert.equal(active.text.includes("נותרו"), false);

  const activeDebt = mapMembershipLookupReply("active_debt");
  assert.equal(activeDebt.kind, "active_debt");
  assert.equal(activeDebt.modelUsed, MEMBERSHIP_LOOKUP_ACTIVE_DEBT_MODEL);
  assert.equal(activeDebt.notifyHumanRequested, true);
  assert.equal(activeDebt.text, MEMBERSHIP_LOOKUP_ACTIVE_DEBT_REPLY);
  assert.equal(
    activeDebt.text,
    "אני רואה שיש חוב במערכת, אבל אני לא מעודכנת בכל הפרטים אז אני מעבירה לצוות שיסתכלו 💜"
  );
  assert.equal(activeDebt.text.includes("—"), false);

  const expired = mapMembershipLookupReply("expired");
  assert.equal(expired.kind, "expired");
  assert.equal(expired.modelUsed, MEMBERSHIP_LOOKUP_EXPIRED_MODEL);
  assert.equal(expired.notifyHumanRequested, true);
  assert.equal(expired.text, MEMBERSHIP_LOOKUP_EXPIRED_REPLY);
  assert.equal(
    expired.text,
    "היי! אני רואה שהמנוי/כרטיסיה פג תוקף/לא פעיל. אני אשאיר פנייה שיחזרו אליך בקרוב סבבה?"
  );
  assert.equal(expired.text.includes("—"), false);

  const notFound = mapMembershipLookupReply("not_found");
  assert.equal(notFound.kind, "not_found");
  assert.equal(notFound.modelUsed, MEMBERSHIP_LOOKUP_NOT_FOUND_MODEL);
  assert.equal(notFound.notifyHumanRequested, true);
  assert.equal(notFound.text, MEMBERSHIP_LOOKUP_NOT_FOUND_REPLY);
  assert.equal(notFound.text, "אני מבינה, אבקש מהצוות לחזור אליך בהקדם.");
  assert.equal(notFound.text.includes("מערכת"), false);
  assert.equal(notFound.text.includes("—"), false);

  const failed = mapMembershipLookupReply("fetch_failed");
  assert.equal(failed.kind, "fetch_failed");
  assert.equal(failed.modelUsed, MEMBERSHIP_LOOKUP_FETCH_FAILED_MODEL);
  assert.equal(failed.notifyHumanRequested, true);
  assert.equal(failed.text, MEMBERSHIP_LOOKUP_NOT_FOUND_REPLY);
  assert.equal(failed.text.includes("מערכת"), false);

  const followup = mapMembershipLookupReply("active_followup");
  assert.equal(followup.kind, "active_followup");
  assert.equal(followup.modelUsed, MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_MODEL);
  assert.equal(followup.notifyHumanRequested, true);
  assert.equal(followup.text, MEMBERSHIP_LOOKUP_ACTIVE_FOLLOWUP_REPLY);
  assert.equal(followup.text.includes("כלול"), false);
  assert.equal(followup.text.includes("—"), false);
}

/** Response parser: data array / single object / empty. */
{
  assert.equal(parseArboxMembershipRecords({ data: [{ active: 1 }] }).length, 1);
  assert.equal(parseArboxMembershipRecords({ data: { active: 1 } }).length, 1);
  assert.equal(parseArboxMembershipRecords({ data: [] }).length, 0);
  assert.equal(parseArboxMembershipRecords(null).length, 0);
  assert.equal(parseArboxMembershipRecords([{ active: 0 }]).length, 1);
}

console.log("wa-membership-lookup.test.ts: ok");
