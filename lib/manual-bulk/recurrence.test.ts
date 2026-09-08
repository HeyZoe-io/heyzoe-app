import assert from "node:assert/strict";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import {
  addDaysYmd,
  advanceWeeklyNextRunAt,
  applyAlreadySentSkip,
  isOpenManualBulkJobStatus,
  israelWeekdaySunday0,
  nextWeeklyRunAt,
  occurrenceYmdFromRunAt,
  parseManualBulkTimeLocal,
  parseManualBulkWeekday,
  shouldMaterializeWeekly,
} from "@/lib/manual-bulk/recurrence";

{
  assert.equal(parseManualBulkWeekday(0), 0);
  assert.equal(parseManualBulkWeekday("3"), 3);
  assert.equal(parseManualBulkWeekday(7), "invalid");
  assert.equal(parseManualBulkTimeLocal("09:00"), "09:00");
  assert.equal(parseManualBulkTimeLocal("09:00:00"), "09:00");
  assert.equal(parseManualBulkTimeLocal("9:00"), "invalid");
  assert.equal(parseManualBulkTimeLocal("24:00"), "invalid");
}

{
  assert.equal(addDaysYmd("2026-09-13", 7), "2026-09-20");
  assert.equal(israelWeekdaySunday0(israelWallTimeToUtc("2026-09-13", "09:00")), 0);
  assert.equal(israelWeekdaySunday0(israelWallTimeToUtc("2026-09-14", "09:00")), 1);
}

{
  const tue = israelWallTimeToUtc("2026-09-08", "11:00");
  const nextSun = nextWeeklyRunAt({ weekday: 0, timeLocal: "09:00", from: tue });
  assert.equal(nextSun.toISOString(), israelWallTimeToUtc("2026-09-13", "09:00").toISOString());
  assert.equal(occurrenceYmdFromRunAt(nextSun), "2026-09-13");
}

{
  const sundayMorning = israelWallTimeToUtc("2026-09-13", "08:00");
  const sameDay = nextWeeklyRunAt({ weekday: 0, timeLocal: "09:00", from: sundayMorning });
  assert.equal(sameDay.toISOString(), israelWallTimeToUtc("2026-09-13", "09:00").toISOString());

  const sundayLate = israelWallTimeToUtc("2026-09-13", "10:00");
  const nextWeek = nextWeeklyRunAt({ weekday: 0, timeLocal: "09:00", from: sundayLate });
  assert.equal(nextWeek.toISOString(), israelWallTimeToUtc("2026-09-20", "09:00").toISOString());
}

{
  const slot = israelWallTimeToUtc("2026-09-13", "09:00");
  assert.equal(
    shouldMaterializeWeekly({
      enabled: true,
      nextRunAt: slot,
      now: israelWallTimeToUtc("2026-09-13", "09:01"),
    }),
    true,
    "due slot fires"
  );
  assert.equal(
    shouldMaterializeWeekly({
      enabled: true,
      nextRunAt: slot,
      now: israelWallTimeToUtc("2026-09-12", "09:01"),
    }),
    false,
    "day before the slot does not fire"
  );
  assert.equal(
    shouldMaterializeWeekly({
      enabled: false,
      nextRunAt: slot,
      now: israelWallTimeToUtc("2026-09-13", "09:01"),
    }),
    false
  );

  const monday = israelWallTimeToUtc("2026-09-14", "09:01");
  const advanced = advanceWeeklyNextRunAt({
    weekday: 0,
    timeLocal: "09:00",
    now: monday,
    lastOccurrenceAt: slot,
  });
  assert.equal(advanced.toISOString(), israelWallTimeToUtc("2026-09-20", "09:00").toISOString());
  assert.equal(
    shouldMaterializeWeekly({ enabled: true, nextRunAt: advanced, now: monday }),
    false,
    "weekly fires once — Monday does not re-fire Sunday's slot"
  );

  const threeWeeksLater = israelWallTimeToUtc("2026-10-05", "10:00");
  const catchUpAdvance = advanceWeeklyNextRunAt({
    weekday: 0,
    timeLocal: "09:00",
    now: threeWeeksLater,
    lastOccurrenceAt: slot,
  });
  assert.equal(
    catchUpAdvance.toISOString(),
    israelWallTimeToUtc("2026-10-11", "09:00").toISOString(),
    "missed weeks: one catch-up then jump forward, no backfill"
  );
}

{
  const already = new Set(["arbox_user:11"]);
  assert.equal(
    applyAlreadySentSkip({
      skipAlreadySentLog: false,
      recipientKey: "arbox_user:11",
      alreadySent: already,
    }),
    "skip",
    "one-off M1 still uses the forever send_log"
  );
  assert.equal(
    applyAlreadySentSkip({
      skipAlreadySentLog: true,
      recipientKey: "arbox_user:11",
      alreadySent: already,
    }),
    "keep",
    "week 2 of a recurring schedule sends again"
  );
}

{
  assert.equal(isOpenManualBulkJobStatus("queued"), true);
  assert.equal(isOpenManualBulkJobStatus("sending"), true);
  assert.equal(isOpenManualBulkJobStatus("done"), false);
  assert.equal(isOpenManualBulkJobStatus("canceled"), false);
}

console.log("manual-bulk-recurrence.test.ts: ok");
