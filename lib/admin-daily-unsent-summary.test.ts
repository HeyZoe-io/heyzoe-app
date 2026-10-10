import assert from "node:assert/strict";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import {
  adminDailySummaryDue,
  AUTO_CANCEL_REASON,
  MANUAL_BLOCK_REASON,
  renderAdminDailyUnsentText,
  WHATSAPP_HANDOFF_EXPECTED_REASON,
  arboxHandoffTaskTypeIdMissing,
  unsentDetailParam,
  unsentGroup,
  unsentProblemCount,
  unsentReason,
  type UnsentRow,
} from "@/lib/admin-daily-unsent-summary";

assert.equal(arboxHandoffTaskTypeIdMissing(null), true);
assert.equal(arboxHandoffTaskTypeIdMissing(""), true);
assert.equal(arboxHandoffTaskTypeIdMissing("114001"), false);
const whatsappHandoffRow: UnsentRow = {
  businessId: 3251,
  business: "Limitless",
  trigger: "משימת ארבוקס",
  contact: "",
  reason: WHATSAPP_HANDOFF_EXPECTED_REASON,
  at: "",
};
assert.equal(unsentGroup(whatsappHandoffRow), "expected");
assert.equal(unsentProblemCount([whatsappHandoffRow]), 0);
assert.match(unsentDetailParam([whatsappHandoffRow]), /1 העברות בוואטסאפ בלי משימת ארבוקס/);
assert.equal(
  unsentGroup({ reason: "נכשל במסירה", future: false }),
  "problem",
  "a failed owner WhatsApp stays a problem"
);

assert.equal(adminDailySummaryDue(israelWallTimeToUtc("2026-10-07", "09:29")), false);
assert.equal(adminDailySummaryDue(israelWallTimeToUtc("2026-10-07", "09:30")), true);
assert.equal(adminDailySummaryDue(israelWallTimeToUtc("2026-10-07", "08:00")), false);

assert.equal(unsentReason({ status: "sent", overdue: true }), null);
assert.equal(unsentReason({ status: "sending", overdue: true }), "נשאר באמצע שליחה");
assert.equal(unsentReason({ status: "unknown", overdue: false }), "תוצאה לא ידועה");
assert.equal(
  unsentReason({ status: "sending", lastError: "send_outcome_unknown", overdue: true }),
  "תוצאה לא ידועה",
  "unknown stored as sending before the SQL"
);
assert.equal(
  unsentReason({ status: "failed", lastError: "send_outcome_unknown: fetch failed", overdue: false }),
  "תוצאה לא ידועה"
);
assert.equal(unsentReason({ status: "failed", lastError: "empty_variable", overdue: false }), "משתנה ריק בטמפלייט");
assert.equal(unsentReason({ status: "pending", lastError: "empty_variable", overdue: false }), "משתנה ריק בטמפלייט");
assert.equal(
  unsentReason({ status: "sent", lastError: "sending", overdue: true }),
  null,
  "a claim stored as sent before the SQL counts as sent"
);
assert.equal(unsentReason({ status: "failed", lastError: "sending", overdue: true }), "נשאר באמצע שליחה");
assert.equal(
  unsentReason({ status: "sent", lastError: "duplicate_guard", overdue: true }),
  "נחסם כפילות"
);
assert.equal(unsentReason({ status: "seeded", overdue: false }), "סומן בלי שליחה");
assert.equal(unsentReason({ status: "no_phone", overdue: false }), "אין טלפון");
assert.equal(unsentReason({ status: "skipped", overdue: false }), "דילוג");
assert.equal(
  unsentReason({ status: "skipped", lastError: "before_activation", overdue: false }),
  null
);
assert.equal(
  unsentReason({ status: "skipped", lastError: "mass_change", overdue: false }),
  "שינוי סטטוס המוני"
);
assert.equal(
  unsentReason({ status: "skipped", lastError: "status_changed_before_send", overdue: false }),
  null
);
assert.equal(
  unsentReason({ status: "skipped", lastError: "pull_integrity", overdue: false }),
  "סריקת ארבוקס לא שלמה"
);
assert.equal(
  unsentReason({ status: "skipped", lastError: "expired", overdue: false }),
  "פג תוקף כי הסריקה נכשלה"
);
assert.equal(
  unsentReason({ status: "canceled", lastError: "retention_daily_cap", overdue: false }),
  "תקרת שימור יומית"
);
assert.equal(unsentReason({ status: "pending", overdue: false }), null);
assert.equal(unsentReason({ status: "pending", overdue: true }), "ממתין אחרי 09:00");
assert.equal(
  unsentReason({ status: "canceled", lastError: "activation_seed", overdue: true }),
  "סומן בלי שליחה"
);
assert.equal(
  unsentReason({ status: "canceled", lastError: "no_valid_name", overdue: true }),
  "שם לא תקין"
);

const rows: UnsentRow[] = [
  {
    businessId: 1,
    business: "tights",
    trigger: "trial_booked",
    contact: "רותם",
    reason: "סומן בלי שליחה",
    at: "07.10, 11:00",
  },
  {
    businessId: 1,
    business: "tights",
    trigger: "trial_booked",
    contact: "ליאור",
    reason: "סומן בלי שליחה",
    at: "07.10, 11:00",
  },
];
const detail = unsentDetailParam(rows);
assert.equal(detail.includes("\n"), false);
assert.equal(
  detail,
  "צפוי: 2 סימוני היסטוריה (כללים חדשים / זמן עבר), 0 אימונים בלי סימון נוכחות, 0 דילוגי תקרת שימור, 0 דילוגים, 0 הקפאות, 0 לא מנוי פעיל, 0 עם אימון עתידי, 0 צוות"
);
assert.equal(
  unsentReason({ status: "seeded", lastError: "class_unmarked", overdue: false }),
  "אימון בלי סימון"
);
assert.equal(unsentReason({ status: "seeded", lastError: "staff", overdue: false }), "צוות");
assert.equal(unsentReason({ status: "seeded", lastError: "frozen", overdue: false }), "הקפאה");
assert.equal(
  unsentReason({ status: "seeded", lastError: "not_active_member", overdue: false }),
  "לא מנוי פעיל"
);
assert.equal(
  unsentReason({ status: "seeded", lastError: "has_future_booking", overdue: false }),
  "אימון עתידי"
);
assert.equal(
  unsentReason({ status: "seeded", lastError: "retention_daily_cap", overdue: false }),
  "תקרת שימור יומית"
);
assert.equal(
  unsentDetailParam([
    ...rows,
    {
      businessId: 1,
      business: "apex",
      trigger: "missed_class",
      contact: "עידן",
      reason: "אימון בלי סימון",
      at: "08.10, 09:00",
    },
  ]),
  "צפוי: 2 סימוני היסטוריה (כללים חדשים / זמן עבר), 1 אימונים בלי סימון נוכחות, 0 דילוגי תקרת שימור, 0 דילוגים, 0 הקפאות, 0 לא מנוי פעיל, 0 עם אימון עתידי, 0 צוות"
);
const attention = unsentDetailParam([
  ...rows,
  {
    businessId: 2,
    business: "Oriya Wellness",
    trigger: "trial_reminder",
    contact: "12122221",
    reason: "סומן בלי שליחה",
    at: "07.10, 09:00",
    future: true,
  },
  {
    businessId: 1,
    business: "Tights",
    trigger: "trial_booked",
    contact: "נירי",
    reason: "נכשל",
    at: "06.10, 17:00",
    metaError: "131026: Message undeliverable",
  },
]);
assert.match(attention, /Oriya Wellness · trial_reminder · סומן לפני מועד השליחה 1/);
assert.match(attention, /Tights · trial_booked · נכשל 131026: Message undeliverable 1/);
assert.match(attention, /צפוי: 2 סימוני היסטוריה/);
assert.equal(attention.includes("…"), false);
assert.match(renderAdminDailyUnsentText(2, detail), /2 הודעות אוטומטיות לא יצאו/);

// Manual holds written by a person or a one-off script, from 8.10.
for (const lastError of [
  "cancel_request_handoff",
  "handoff_within_14d_sep25",
  "registered_via_zoe",
  "held_class_oct5_not_yesterday_catchup|blocked_oct8_catchup",
  "intro_class_not_sessions",
  "sends_hold",
]) {
  assert.equal(unsentReason({ status: "abandoned", lastError, overdue: false }), MANUAL_BLOCK_REASON, lastError);
  assert.equal(unsentReason({ status: "canceled", lastError, overdue: false }), MANUAL_BLOCK_REASON, lastError);
}
// Real failures stay failures.
assert.equal(unsentReason({ status: "abandoned", lastError: "send_failed", overdue: false }), "נכשל");
assert.equal(unsentReason({ status: "abandoned", lastError: "send_failed:3", overdue: false }), "נכשל");
assert.equal(unsentReason({ status: "abandoned", overdue: false }), "נכשל");
assert.equal(
  unsentReason({ status: "abandoned", lastError: "131026: Message undeliverable", overdue: false }),
  "נכשל"
);
assert.equal(unsentReason({ status: "canceled", lastError: "claim_held:2", overdue: false }), "בוטל");
assert.equal(unsentReason({ status: "canceled", overdue: false }), "בוטל");
assert.equal(unsentReason({ status: "canceled", lastError: "suppressed_opt_out", overdue: false }), AUTO_CANCEL_REASON);
assert.equal(unsentReason({ status: "canceled", lastError: "product_filter_scope", overdue: false }), AUTO_CANCEL_REASON);
assert.equal(unsentReason({ status: "canceled", lastError: "retention_daily_cap", overdue: false }), "תקרת שימור יומית");
assert.equal(unsentReason({ status: "canceled", lastError: "activation_seed", overdue: false }), "סומן בלי שליחה");

assert.equal(unsentGroup({ reason: MANUAL_BLOCK_REASON }), "manual");
assert.equal(unsentGroup({ reason: AUTO_CANCEL_REASON }), "expected");
assert.equal(unsentGroup({ reason: "סומן בלי שליחה" }), "expected");
assert.equal(unsentGroup({ reason: "סומן בלי שליחה", future: true }), "problem");
for (const reason of ["נכשל", "תוצאה לא ידועה", "נשאר באמצע שליחה", "ממתין אחרי 09:00", "בוטל"]) {
  assert.equal(unsentGroup({ reason }), "problem", reason);
}

{
  const row = (patch: Partial<UnsentRow>): UnsentRow => ({
    businessId: 1,
    business: "OR-IA",
    trigger: "milestones",
    contact: "x",
    reason: "סומן בלי שליחה",
    at: "08.10, 09:00",
    ...patch,
  });
  const day: UnsentRow[] = [
    ...Array.from({ length: 11 }, () => row({ rule: "milestones2" })),
    ...Array.from({ length: 10 }, () => row({ business: "Limitless", trigger: "attendance_gap", rule: "attendance_gap" })),
    ...Array.from({ length: 3 }, () => row({ business: "Apex", trigger: "missed_class", reason: MANUAL_BLOCK_REASON })),
    row({ business: "Tights", trigger: "sessions_expiring", reason: AUTO_CANCEL_REASON }),
    row({ business: "Apex", trigger: "missed_class", reason: "נכשל", metaError: "131049" }),
    row({ business: "OR-IA", trigger: "trial_reminder", future: true }),
  ];
  assert.equal(unsentProblemCount(day), 2, "only the failure and the future seed count");
  const text = unsentDetailParam(day);
  assert.match(text, /^(Apex · missed_class · נכשל 131049 1|OR-IA · trial_reminder · סומן לפני מועד השליחה 1) \| /);
  assert.match(text, /OR-IA · trial_reminder · סומן לפני מועד השליחה 1/);
  assert.match(text, /נחסם ידנית: 3 \(Apex · missed_class 3\)/);
  assert.match(text, /צפוי: 21 סימוני היסטוריה \(כללים חדשים \/ זמן עבר; מעל 10 לכלל: OR-IA · milestones \(milestones2\) 11\)/);
  assert.equal(text.includes("Limitless · attendance_gap (attendance_gap)"), false, "10 is not more than 10");
  assert.match(text, /, 1 ביטולים אוטומטיים$/);
  assert.equal(/נכשל[^|]*Apex · missed_class 3|missed_class · נכשל 3/.test(text), false, "manual holds never read as failed");

  const noisy = [
    ...day,
    ...Array.from({ length: 40 }, (_, i) =>
      row({ business: `Business ${i}`, trigger: "lost_lead", reason: "נכשל", metaError: `1310${i}: something long went wrong here` })
    ),
  ];
  const manyHolds = [
    ...day,
    ...Array.from({ length: 30 }, (_, i) =>
      row({ business: `Studio with a long name ${i}`, trigger: "not_registered_after_trial", reason: MANUAL_BLOCK_REASON })
    ),
  ];
  const trimmed = unsentDetailParam(manyHolds);
  assert.ok(trimmed.length <= 800, `detail is ${trimmed.length} chars`);
  assert.match(trimmed, /נחסם ידנית: 33 \|/, "manual breakdown goes first");
  assert.match(trimmed, /מעל 10 לכלל: OR-IA · milestones \(milestones2\) 11/, "per-rule list stays");
  assert.match(trimmed, /OR-IA · trial_reminder · סומן לפני מועד השליחה 1/, "problems stay");

  const capped = unsentDetailParam(noisy);
  assert.ok(capped.length <= 800, `detail is ${capped.length} chars`);
  assert.match(capped, /נחסם ידנית: 3/);
  assert.match(capped, /צפוי: 21 סימוני היסטוריה/);
  assert.match(capped, /הפירוט המלא ב-\/admin\/unsent/);
}

console.log("admin-daily-unsent-summary.test.ts: ok");
