import assert from "node:assert/strict";
import {
  AUTOBOOK_NOT_BOOKED_TEXT,
  autobookBookedTextFromSocial,
  bookingIdFromBookSessionJson,
  fillAutobookBookedText,
  israelLocalToUtc,
  resolveAutobookTarget,
  summarizeArboxBookingError,
} from "@/lib/leads/arbox-class-autobook";
import { resolveOccurrenceScheduleId, resolveOccurrenceState } from "@/lib/arbox-occurrence-state";

// 2026-10-11 is a Sunday. 10:00Z = 13:00 Israel (IDT, +3).
const PICK_AT = "2026-10-11T10:00:00.000Z";
const NOW = new Date("2026-10-12T08:00:00.000Z");
const META = {
  arbox_class_name: "Strength",
  arbox_box_category_id: 7,
  schedule_slots: [
    { day: "ד", time: "18:30" },
    { day: "א", time: "18:00" },
    { day: "א", time: "09:00" },
  ],
};
const SALE = { start_date: "2026-10-11", end_date: "2026-11-11" };

const base: Parameters<typeof resolveAutobookTarget>[0] = {
  pick: { date: "רביעי", time: "18:30" },
  pickAt: PICK_AT,
  now: NOW,
  product: { meta: META },
  saleRow: SALE,
};

// DST-correct wall clock conversion.
assert.equal(israelLocalToUtc("2026-10-14", "18:30")?.toISOString(), "2026-10-14T15:30:00.000Z");
assert.equal(israelLocalToUtc("2026-10-26", "18:00")?.toISOString(), "2026-10-26T16:00:00.000Z");
assert.equal(israelLocalToUtc("2026-10-14", "bad"), null);

assert.deepEqual(resolveAutobookTarget(base), {
  kind: "target",
  date: "2026-10-14",
  time: "18:30",
  className: "Strength",
  dayLetter: "ד",
});
assert.equal(resolveAutobookTarget({ ...base, pick: { date: "יום רביעי", time: "18:30" } }).kind, "target");
assert.equal(resolveAutobookTarget({ ...base, pick: { date: "רביעי", time: "18:30:00" } }).kind, "target");

// Next occurrence after the pick, not after now.
const sameDayLater = resolveAutobookTarget({ ...base, pick: { date: "ראשון", time: "18:00" }, now: new Date("2026-10-11T11:00:00Z") });
assert.equal(sameDayLater.kind === "target" && sameDayLater.date, "2026-10-11");
const sameDayEarlier = resolveAutobookTarget({ ...base, pick: { date: "ראשון", time: "09:00" } });
assert.equal(sameDayEarlier.kind === "target" && sameDayEarlier.date, "2026-10-18");
// Sale lands after the picked class already ran: handoff, never next week.
const passed = resolveAutobookTarget({ ...base, now: new Date("2026-10-14T16:00:00Z") });
assert.deepEqual(passed, { kind: "handoff", reason: "passed", date: "2026-10-14", time: "18:30", className: "Strength" });
const leadTime = resolveAutobookTarget({ ...base, now: new Date("2026-10-14T15:00:00Z") });
assert.equal(leadTime.kind === "handoff" && leadTime.reason, "lead_time");
const exactlyHour = resolveAutobookTarget({ ...base, now: new Date("2026-10-14T14:30:00Z") });
assert.equal(exactlyHour.kind, "target");

const skip = (over: Partial<typeof base>) => {
  const r = resolveAutobookTarget({ ...base, ...over });
  return r.kind === "skip" ? r.reason : r.kind;
};
assert.equal(skip({ pick: { date: "", time: "18:30" } }), "no_pick");
assert.equal(skip({ pick: { date: "רביעי", time: "" } }), "no_pick");
assert.equal(skip({ pick: { date: "14/10/2026", time: "18:30" } }), "course_date");
assert.equal(skip({ pick: { date: "ד", time: "18:30" } }), "bad_day");
assert.equal(skip({ pick: { date: "מחר", time: "18:30" } }), "bad_day");
assert.equal(skip({ pick: { date: "רביעי", time: "בערב" } }), "bad_time");
assert.equal(skip({ pickAt: null }), "no_anchor");
assert.equal(skip({ now: new Date("2026-10-19T10:00:01Z") }), "stale_pick");
assert.equal(skip({ product: null }), "no_product");
assert.equal(skip({ product: { meta: { ...META, arbox_class_name: "" } } }), "no_stamp");
assert.equal(
  skip({ product: { meta: { ...META, schedule_removed_notice: { detected_at: "2026-10-01", dismissed: false } } } }),
  "schedule_removed"
);
assert.equal(skip({ pick: { date: "רביעי", time: "19:30" } }), "slot_not_in_product");
assert.equal(skip({ saleRow: { start_date: null, end_date: null } }), "no_membership_dates");

// Branch-only slot counts.
const branchMeta = {
  arbox_class_name: "Strength",
  schedule_slots: [],
  branch_offers: { amiad: { schedule_slots: [{ day: "ד", time: "18:30" }] } },
};
assert.equal(skip({ product: { meta: branchMeta } }), "target");

// Membership window.
const outside = (saleRow: Record<string, unknown>) => {
  const r = resolveAutobookTarget({ ...base, saleRow });
  return r.kind === "handoff" ? r.reason : r.kind;
};
assert.equal(outside({ start_date: "2026-10-15", end_date: null }), "outside_membership");
assert.equal(outside({ start_date: "2026-10-11", end_date: "2026-10-13" }), "outside_membership");
assert.equal(outside({ start_date: "2026-10-14 00:00:00", end_date: "2026-10-14 23:59:59" }), "target");
assert.equal(outside({ start_date: "2026-10-01", end_date: null }), "target");

// schedule_id: both endpoints must agree on exactly one row.
const sched = (over: Record<string, unknown> = {}) => ({
  schedule_id: 501,
  date: "2026-10-14",
  start_time: "18:30:00",
  session_name: "Strength",
  max_participants: 10,
  ...over,
});
const summ = (over: Record<string, unknown> = {}) => ({
  schedule_id: 501,
  date: "2026-10-14",
  start_time: "18:30",
  class_name: "Strength",
  status: "active",
  registration_count: 3,
  ...over,
});
const id = (scheduleRows: unknown[] | null, summaryRows: unknown[] | null) =>
  resolveOccurrenceScheduleId(
    { scheduleRows: scheduleRows as Record<string, unknown>[] | null, summaryRows: summaryRows as Record<string, unknown>[] | null },
    "2026-10-14",
    "18:30",
    "Strength"
  );
assert.equal(id([sched()], [summ()]), 501);
assert.equal(id([sched()], [summ({ schedule_id: 502 })]), null);
assert.equal(id([sched(), sched({ schedule_id: 600 })], [summ()]), null);
assert.equal(id([sched()], []), null);
assert.equal(id(null, [summ()]), null);
assert.equal(id([sched({ schedule_id: null })], [summ({ schedule_id: null })]), null);
assert.equal(id([sched(), sched({ session_name: "Other", schedule_id: 9 })], [summ()]), 501);
assert.equal(id([sched({ start_time: "19:30" })], [summ()]), null);
// Existing contract unchanged.
assert.equal(resolveOccurrenceState({ scheduleRows: [sched()], summaryRows: [summ()] }, "2026-10-14", "18:30", "Strength").state, "open");

// Booked text fill.
assert.equal(
  fillAutobookBookedText("שריינתי לך את יום {יום} {תאריך} ב-{שעה} 💜", { date: "2026-10-14", time: "18:30" }),
  "שריינתי לך את יום רביעי 14.10 ב-18:30 💜"
);
assert.equal(autobookBookedTextFromSocial({ arbox_autobook_booked_text: "  היי  " }), "היי");
assert.equal(autobookBookedTextFromSocial(null), "");
assert.equal(autobookBookedTextFromSocial({ sales_flow: {} }), "");
assert.ok(AUTOBOOK_NOT_BOOKED_TEXT.startsWith("התשלום התקבל"));

// Arbox response parsing.
assert.equal(bookingIdFromBookSessionJson({ data: [{ booking_id: 9001, schedule_id: 501 }] }), 9001);
assert.equal(bookingIdFromBookSessionJson({ data: { booking_id: "9002" } }), 9002);
assert.equal(bookingIdFromBookSessionJson({ data: [] }), null);
assert.equal(bookingIdFromBookSessionJson(null), null);
assert.equal(summarizeArboxBookingError({ message: "User 0501234567 already booked" }), "User # already booked");
assert.equal(summarizeArboxBookingError({ error: "x@y.com bad" }), "@ bad");
assert.equal(summarizeArboxBookingError(null), "");

console.log("arbox-class-autobook tests passed");
