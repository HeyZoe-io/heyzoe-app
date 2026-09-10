import assert from "node:assert/strict";
import { clientFirstNameFromBookingRow } from "@/lib/leads/arbox-trainer-trial-heads-up";
import {
  classCancelledStaffLookbackWindow,
  isCancelledSessionStatus,
  parseScheduleId,
  staffPhoneByScheduleId,
} from "@/lib/leads/arbox-class-cancelled-staff";
import { formatDateYmdIsrael } from "@/lib/leads/arbox-trial-attended";
import {
  buildClassCancelledStaffScheduledDedupKey,
  buildTrainerTrialHeadsUpScheduledDedupKey,
} from "@/lib/scheduled-template-sends";
import {
  classDateYmdFromStaffDedupKey,
  classNameFromScheduledDedupKey,
  classTimeFromScheduledDedupKey,
  clientFirstNameFromStaffDedupKey,
} from "@/lib/template-send-params";
import { isStaffRecipientTriggerType } from "@/lib/trigger-catalog";

{
  assert.equal(
    clientFirstNameFromBookingRow({
      user_id: 1,
      first_name: "דנה",
      last_name: "כהן",
      full_name: "דנה כהן",
    }),
    "דנה"
  );
  assert.equal(
    clientFirstNameFromBookingRow({
      user_id: 1,
      full_name: "יוסי לוי",
    }),
    "יוסי"
  );
  assert.equal(clientFirstNameFromBookingRow({ user_id: 1 }), "");
}

{
  const key = buildTrainerTrialHeadsUpScheduledDedupKey({
    businessId: 1,
    triggerId: "rule",
    trainerPhone: "972501234567",
    userId: 9,
    classDateYmd: "2026-09-11",
    classTime: "18:00",
    clientFirstName: "דנה",
    className: "יוגה",
  });
  assert.equal(clientFirstNameFromStaffDedupKey(key), "דנה");
  assert.equal(classNameFromScheduledDedupKey(key), "יוגה");
  assert.equal(classTimeFromScheduledDedupKey(key), "18:00");
  assert.equal(isStaffRecipientTriggerType("trainer_trial_heads_up"), true);
}

{
  assert.equal(isCancelledSessionStatus("cancelled"), true);
  assert.equal(isCancelledSessionStatus("deleted"), true);
  assert.equal(isCancelledSessionStatus("canceled"), true);
  assert.equal(isCancelledSessionStatus("active"), false);
  assert.equal(isCancelledSessionStatus(""), true);
  assert.equal(parseScheduleId(44123), "44123");
  assert.equal(parseScheduleId("  "), null);

  const phones = staffPhoneByScheduleId([
    { schedule_id: "88", staff_member_phone: "0501234567" },
    { schedule_id: "88", staff_member_phone: "0509999999" },
    { schedule_id: "99" },
  ]);
  assert.equal(phones.get("88"), "972501234567");
  assert.equal(phones.has("99"), false);
}

{
  const key = buildClassCancelledStaffScheduledDedupKey({
    businessId: 1,
    triggerId: "rule",
    scheduleId: "88",
    className: "יוגה",
    classDateYmd: "2026-09-11",
    classTime: "18:00",
  });
  assert.equal(classNameFromScheduledDedupKey(key), "יוגה");
  assert.equal(classDateYmdFromStaffDedupKey(key), "2026-09-11");
  assert.equal(classTimeFromScheduledDedupKey(key), "18:00");
  assert.equal(isStaffRecipientTriggerType("class_cancelled_staff"), true);
}

{
  const now = new Date("2026-09-10T12:00:00+03:00");
  const window = classCancelledStaffLookbackWindow(now);
  const today = formatDateYmdIsrael(now);
  assert.equal(window.toDate, today);
  assert.equal(window.fromDate < window.toDate, true);
}

console.log("arbox-staff-templates.test.ts: ok");
