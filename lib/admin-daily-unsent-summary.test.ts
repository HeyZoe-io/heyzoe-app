import assert from "node:assert/strict";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import {
  adminDailySummaryDue,
  renderAdminDailyUnsentText,
  unsentDetailParam,
  unsentReason,
  type UnsentRow,
} from "@/lib/admin-daily-unsent-summary";

assert.equal(adminDailySummaryDue(israelWallTimeToUtc("2026-10-07", "09:29")), false);
assert.equal(adminDailySummaryDue(israelWallTimeToUtc("2026-10-07", "09:30")), true);
assert.equal(adminDailySummaryDue(israelWallTimeToUtc("2026-10-07", "08:00")), false);

assert.equal(unsentReason({ status: "sent", overdue: true }), null);
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
  "צפוי: 2 סימוני היסטוריה (כללים חדשים / זמן עבר), 0 דילוגי תקרת שימור, 0 שיעורים שכבר התחילו"
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
assert.match(attention, /Oriya Wellness · trial_reminder · סומן בלי שליחה 1/);
assert.match(attention, /Tights · trial_booked · נכשל 131026: Message undeliverable 1/);
assert.match(attention, /צפוי: 2 סימוני היסטוריה/);
assert.equal(attention.includes("…"), false);
assert.match(renderAdminDailyUnsentText(2, detail), /2 הודעות אוטומטיות לא יצאו/);
