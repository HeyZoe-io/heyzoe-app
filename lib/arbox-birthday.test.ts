import assert from "node:assert/strict";
import {
  birthdayReportFetchWindowForRule,
  buildBirthdayReportPath,
  computeBirthdayTriggerDateYmd,
  celebrationYearIsrael,
  formatDateYmdIsrael,
  isBirthdayTriggerDueToday,
  parseBirthdayMonthDay,
} from "@/lib/leads/arbox-birthday";
import { pickBirthdayTemplateTriggerRule } from "@/lib/template-triggers-match";

/** Parse birthday month/day from Arbox field. */
{
  assert.deepEqual(parseBirthdayMonthDay("2000-08-02"), { month: 8, day: 2 });
  assert.deepEqual(parseBirthdayMonthDay("08-02"), { month: 8, day: 2 });
  assert.equal(parseBirthdayMonthDay("bad"), null);
}

/** due-today match: delay=0 → birthday calendar day == today. */
{
  const now = new Date("2026-08-02T15:00:00.000Z");
  const todayYmd = formatDateYmdIsrael(now);
  const [y, m, d] = todayYmd.split("-");
  const birthday = `1990-${m}-${d}`;
  assert.equal(
    isBirthdayTriggerDueToday(birthday, { delay_days: 0, delay_direction: "after" }, now),
    true
  );
  assert.equal(
    isBirthdayTriggerDueToday("1990-01-01", { delay_days: 0, delay_direction: "after" }, now),
    false
  );
}

/** delay after: trigger = birthday + N; due today when birthday was N days ago. */
{
  const now = new Date("2026-08-05T12:00:00+03:00");
  // Israel YMD for this instant
  const today = formatDateYmdIsrael(now);
  assert.equal(today, "2026-08-05");
  assert.equal(
    computeBirthdayTriggerDateYmd("1990-08-02", { delay_days: 3, delay_direction: "after" }, now),
    "2026-08-05"
  );
  assert.equal(
    isBirthdayTriggerDueToday("1990-08-02", { delay_days: 3, delay_direction: "after" }, now),
    true
  );
  assert.equal(
    isBirthdayTriggerDueToday("1990-08-05", { delay_days: 3, delay_direction: "after" }, now),
    false
  );
}

/** delay before: trigger = birthday - N; due today when birthday is N days ahead. */
{
  const now = new Date("2026-08-02T12:00:00+03:00");
  assert.equal(formatDateYmdIsrael(now), "2026-08-02");
  assert.equal(
    computeBirthdayTriggerDateYmd("1990-08-05", { delay_days: 3, delay_direction: "before" }, now),
    "2026-08-02"
  );
  assert.equal(
    isBirthdayTriggerDueToday("1990-08-05", { delay_days: 3, delay_direction: "before" }, now),
    true
  );
}

/** Fetch window covers the birthday calendar day that maps to due-today. */
{
  const now = new Date("2026-08-05T12:00:00+03:00");
  assert.deepEqual(
    birthdayReportFetchWindowForRule({ delay_days: 0, delay_direction: "after" }, now),
    { fromDate: "2026-08-05", toDate: "2026-08-05" }
  );
  assert.deepEqual(
    birthdayReportFetchWindowForRule({ delay_days: 3, delay_direction: "after" }, now),
    { fromDate: "2026-08-02", toDate: "2026-08-02" }
  );
  assert.deepEqual(
    birthdayReportFetchWindowForRule({ delay_days: 3, delay_direction: "before" }, now),
    { fromDate: "2026-08-08", toDate: "2026-08-08" }
  );
}

/** birthdayReport path includes fromDate/toDate (API requires them). */
{
  const path = buildBirthdayReportPath({
    fromDate: "2026-08-02",
    toDate: "2026-08-02",
    locationId: "3068",
  });
  assert.match(path, /fromDate=2026-08-02/);
  assert.match(path, /toDate=2026-08-02/);
  assert.match(path, /location_id=3068/);
}

/** Year-boundary: before-delay near Dec 31 uses next year's birthday occurrence. */
{
  const now = new Date("2026-12-30T12:00:00+02:00");
  assert.equal(formatDateYmdIsrael(now), "2026-12-30");
  assert.equal(
    isBirthdayTriggerDueToday("1990-01-02", { delay_days: 3, delay_direction: "before" }, now),
    true
  );
  assert.deepEqual(
    birthdayReportFetchWindowForRule({ delay_days: 3, delay_direction: "before" }, now),
    { fromDate: "2027-01-02", toDate: "2027-01-02" }
  );
}

/** once-per-year dedup key uses celebration year (not birth year). */
{
  const year = celebrationYearIsrael(new Date("2026-08-02T12:00:00+03:00"));
  assert.equal(year, 2026);
  // Simulate sync_log PK decision
  const seen = new Set<string>();
  function tryProcess(userId: number, birthdayYear: number): "ok" | "dedup" {
    const key = `1:${userId}:${birthdayYear}`;
    if (seen.has(key)) return "dedup";
    seen.add(key);
    return "ok";
  }
  assert.equal(tryProcess(99, 2026), "ok");
  assert.equal(tryProcess(99, 2026), "dedup");
  assert.equal(tryProcess(99, 2027), "ok");
}

/** no_rule: empty / missing template → null. */
{
  assert.equal(pickBirthdayTemplateTriggerRule([]), null);
  assert.equal(
    pickBirthdayTemplateTriggerRule([
      {
        id: "b1",
        business_id: 1,
        trigger_type: "birthday",
        product_filter: null,
        delay_days: 0,
        delay_direction: "after",
        template_name: "",
        enabled: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: null,
      },
    ]),
    null
  );
  const picked = pickBirthdayTemplateTriggerRule([
    {
      id: "b2",
      business_id: 1,
      trigger_type: "birthday",
      product_filter: null,
      delay_days: 0,
      delay_direction: "after",
      template_name: "T_birthday",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ]);
  assert.equal(picked?.template_name, "T_birthday");
}

console.log("arbox-birthday.test.ts: ok");
