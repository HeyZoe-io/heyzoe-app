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
assert.equal(detail, "tights · trial_booked · סומן בלי שליחה 2");
assert.match(renderAdminDailyUnsentText(2, detail), /2 הודעות אוטומטיות לא יצאו/);
