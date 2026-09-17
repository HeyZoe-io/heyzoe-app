import assert from "node:assert/strict";
import type { ArboxOccurrenceStateResult } from "@/lib/arbox-occurrence-state";
import { formatScheduleSlotDisplayLabel } from "@/lib/product-schedule-slots";
import { userRequestedHumanAgent } from "@/lib/notifications/detect-human-request";
import { schedulePickChangeServiceLabel } from "@/lib/business-content-lang";
import {
  annotateScheduleSlotsByOccurrenceState,
  buildScheduleSlotPickMenuLabels,
  isScheduleSlotPickAllFullRepickLabel,
  isScheduleSlotPickAllFullResult,
  resolveScheduleSlotPickTap,
  scheduleSlotPickAllFullFiresHandoff,
  scheduleSlotPickOpenContactPatch,
  SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE,
  SCHEDULE_SLOT_PICK_ALL_FULL_REPICK_LABEL,
  SCHEDULE_SLOT_PICK_CANCELLED_TAP_NOTICE,
  SCHEDULE_SLOT_PICK_FULL_TAP_NOTICE,
  SCHEDULE_SLOT_PICK_MENU_PHASE,
  OCCURRENCE_STATUS_CANCELLED_SUFFIX,
  OCCURRENCE_STATUS_FULL_SUFFIX,
  type RawDataFetcher,
} from "@/lib/wa-relative-day-class-slots";

/** Tuesday 10:02 Israel — same fixture as wa-relative-day-class-slots.test.ts */
const tueMorning = new Date("2026-09-01T07:02:00.000Z");

const STAMP = "Strength";
const OFFER_CTX_BASE = { businessId: 42, arboxApiKey: "k", arboxBoxId: "1" as string };
const CHANGE = schedulePickChangeServiceLabel("he");

function fakeRawDataFetcher(
  byKey: Record<string, ArboxOccurrenceStateResult["state"]>,
  opts?: { throwOnFetch?: boolean }
): { impl: RawDataFetcher; calls: { businessId: unknown; date: string }[] } {
  const calls: { businessId: unknown; date: string }[] = [];
  const impl: RawDataFetcher = async ({ businessId, date }) => {
    calls.push({ businessId, date });
    if (opts?.throwOnFetch) throw new Error("arbox_unavailable");
    const scheduleRows: Record<string, unknown>[] = [];
    const summaryRows: Record<string, unknown>[] = [];
    for (const [key, state] of Object.entries(byKey)) {
      const [d, time, className] = key.split("|");
      if (d !== date) continue;
      if (state === "cancelled") {
        summaryRows.push({ date: d, start_time: time, class_name: className, status: "cancelled" });
      } else if (state === "full") {
        scheduleRows.push({ date: d, start_time: time, session_name: className, max_participants: 5 });
        summaryRows.push({
          date: d,
          start_time: time,
          class_name: className,
          status: "active",
          registration_count: 5,
        });
      } else if (state === "open") {
        scheduleRows.push({ date: d, start_time: time, session_name: className, max_participants: 5 });
        summaryRows.push({
          date: d,
          start_time: time,
          class_name: className,
          status: "active",
          registration_count: 1,
        });
      }
    }
    return { scheduleRows, summaryRows };
  };
  return { impl, calls };
}

const rawThree = [
  { day: "א", time: "18:00" },
  { day: "ג", time: "18:30" },
  { day: "ד", time: "19:00" },
] as const;

async function main() {
  // 20-char gate: longest live pattern is 5-char day-name + space + HH:MM + cancelled suffix.
  const longestBase = formatScheduleSlotDisplayLabel({ day: "ג", time: "18:30" });
  assert.equal([...longestBase].length, 11);
  assert.equal([...`${longestBase}${OCCURRENCE_STATUS_CANCELLED_SUFFIX}`].length, 19);
  assert.ok([...`${longestBase}${OCCURRENCE_STATUS_CANCELLED_SUFFIX}`].length <= 20);

  assert.equal(SCHEDULE_SLOT_PICK_FULL_TAP_NOTICE, "השיעור מלא, בוא נבחר מועד אחר!");
  assert.equal(SCHEDULE_SLOT_PICK_CANCELLED_TAP_NOTICE, "השיעור הזה לא מתקיים השבוע, בוא נבחר מועד אחר!");
  assert.equal(CHANGE, "בחירת אימון אחר");
  assert.equal(SCHEDULE_SLOT_PICK_MENU_PHASE, "schedule_date");
  assert.equal(scheduleSlotPickOpenContactPatch("רביעי", "19:00").session_phase, "cta");

  // ---------- CONTINUITY (the critical test) ----------
  // tap full → full copy; re-send leaves phase=schedule_date; tap open → NEW slot written, phase=cta.
  {
    const { impl } = fakeRawDataFetcher({
      "2026-09-06|18:00|Strength": "open",
      "2026-09-01|18:30|Strength": "full",
      "2026-09-02|19:00|Strength": "open",
    });
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    const labels = buildScheduleSlotPickMenuLabels(annotated, CHANGE);
    assert.equal(labels[labels.length - 1], CHANGE, "choose-another-class is last");
    assert.match(labels[1]!, /18:30 \(מלא\)/);
    assert.doesNotMatch(labels[0]!, /\(מלא\)|\(מבוטל\)/);
    assert.doesNotMatch(labels[2]!, /\(מלא\)|\(מבוטל\)/);

    const fullTap = resolveScheduleSlotPickTap({
      inboundText: labels[1]!,
      slotsForPick: annotated,
      labels,
    });
    assert.equal(fullTap.kind, "blocked");
    if (fullTap.kind !== "blocked") throw new Error("expected blocked");
    assert.equal(fullTap.reason, "full");
    assert.equal(fullTap.notice, SCHEDULE_SLOT_PICK_FULL_TAP_NOTICE);
    assert.equal(fullTap.slot.time, "18:30");

    // Re-send uses the same annotate+labels path and restores schedule_date (menu writer).
    const resentPhase = SCHEDULE_SLOT_PICK_MENU_PHASE;
    assert.equal(resentPhase, "schedule_date");

    const openTap = resolveScheduleSlotPickTap({
      inboundText: labels[2]!,
      slotsForPick: annotated,
      labels,
    });
    assert.equal(openTap.kind, "open");
    if (openTap.kind !== "open") throw new Error("expected open");
    assert.equal(openTap.timeTxt, "19:00", "NEW slot time, not the full 18:30");
    assert.equal(openTap.dateTxt, "רביעי");
    assert.notEqual(openTap.timeTxt, "18:30");
    assert.equal(openTap.contactPatch.sf_requested_date, "רביעי");
    assert.equal(openTap.contactPatch.sf_requested_time, "19:00");
    assert.equal(openTap.contactPatch.session_phase, "cta");
    assert.equal(openTap.contactPatch.flow_step, 0);
  }

  // Tap cancelled → cancelled copy. Then open re-pick still writes the NEW slot.
  {
    const { impl } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "cancelled" });
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    const labels = buildScheduleSlotPickMenuLabels(annotated, CHANGE);
    assert.match(labels[1]!, /18:30 \(מבוטל\)/);
    const cancelledTap = resolveScheduleSlotPickTap({
      inboundText: labels[1]!,
      slotsForPick: annotated,
      labels,
    });
    assert.equal(cancelledTap.kind, "blocked");
    if (cancelledTap.kind !== "blocked") throw new Error("expected blocked");
    assert.equal(cancelledTap.reason, "cancelled");
    assert.equal(cancelledTap.notice, SCHEDULE_SLOT_PICK_CANCELLED_TAP_NOTICE);

    const openTap = resolveScheduleSlotPickTap({
      inboundText: labels[0]!,
      slotsForPick: annotated,
      labels,
    });
    assert.equal(openTap.kind, "open");
    if (openTap.kind !== "open") throw new Error("expected open");
    assert.equal(openTap.timeTxt, "18:00");
    assert.equal(openTap.contactPatch.session_phase, "cta");
  }

  // Index-alignment removal: full slot stays in the list; typed "2" is the full Tuesday, not Wednesday.
  {
    const { impl } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.deepEqual(
      annotated.map((s) => `${s.day}|${s.time}|${s.occurrenceState}`),
      ["א|18:00|unknown", "ג|18:30|full", "ד|19:00|unknown"]
    );
    const labels = buildScheduleSlotPickMenuLabels(annotated, CHANGE);
    const typed2 = resolveScheduleSlotPickTap({ inboundText: "2", slotsForPick: annotated, labels });
    assert.equal(typed2.kind, "blocked");
    if (typed2.kind !== "blocked") throw new Error("expected blocked");
    assert.equal(typed2.slot.time, "18:30");
    const typed3 = resolveScheduleSlotPickTap({ inboundText: "3", slotsForPick: annotated, labels });
    assert.equal(typed3.kind, "open");
    if (typed3.kind !== "open") throw new Error("expected open");
    assert.equal(typed3.timeTxt, "19:00");
  }

  // Last button still routes to product re-pick — checked BEFORE index-into-slots.
  {
    const { impl } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    const labels = buildScheduleSlotPickMenuLabels(annotated, CHANGE);
    assert.equal(labels[labels.length - 1], CHANGE);
    const last = resolveScheduleSlotPickTap({
      inboundText: CHANGE,
      slotsForPick: annotated,
      labels,
    });
    assert.equal(last.kind, "change_service");
    const byNumber = resolveScheduleSlotPickTap({
      inboundText: String(labels.length),
      slotsForPick: annotated,
      labels,
    });
    assert.equal(byNumber.kind, "change_service");
  }

  // Unknown at tap (no rows) → proceed as open. Suffix never applied.
  {
    const { impl } = fakeRawDataFetcher({});
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    const labels = buildScheduleSlotPickMenuLabels(annotated, CHANGE);
    assert.equal(labels.some((l) => l.includes(OCCURRENCE_STATUS_FULL_SUFFIX)), false);
    assert.equal(labels.some((l) => l.includes(OCCURRENCE_STATUS_CANCELLED_SUFFIX)), false);
    const tap = resolveScheduleSlotPickTap({ inboundText: labels[1]!, slotsForPick: annotated, labels });
    assert.equal(tap.kind, "open");
    if (tap.kind !== "open") throw new Error("expected open");
    assert.equal(tap.timeTxt, "18:30");
  }

  // Fetch throw → fail-open, no suffix, tap proceeds as open.
  {
    const { impl } = fakeRawDataFetcher({}, { throwOnFetch: true });
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.ok(annotated.every((s) => s.occurrenceState === "unknown"));
    const labels = buildScheduleSlotPickMenuLabels(annotated, CHANGE);
    assert.equal(labels.some((l) => l.includes(OCCURRENCE_STATUS_FULL_SUFFIX)), false);
    const tap = resolveScheduleSlotPickTap({ inboundText: labels[0]!, slotsForPick: annotated, labels });
    assert.equal(tap.kind, "open");
  }

  // Unstamped → raw labels, zero Arbox calls, tap proceeds as open.
  {
    const { impl, calls } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], "", {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.equal(calls.length, 0);
    assert.ok(annotated.every((s) => s.occurrenceState === "unknown"));
    const labels = buildScheduleSlotPickMenuLabels(annotated, CHANGE);
    assert.equal(labels[1], formatScheduleSlotDisplayLabel({ day: "ג", time: "18:30" }));
    const tap = resolveScheduleSlotPickTap({ inboundText: labels[1]!, slotsForPick: annotated, labels });
    assert.equal(tap.kind, "open");
  }

  // No creds → same as unstamped.
  {
    const { impl, calls } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      businessId: 42,
      arboxApiKey: "",
      arboxBoxId: "",
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.equal(calls.length, 0);
    assert.ok(annotated.every((s) => s.occurrenceState === "unknown"));
  }

  // Showing every slot means all-full empty-state never fires from annotate length.
  {
    const { impl } = fakeRawDataFetcher({
      "2026-09-06|18:00|Strength": "full",
      "2026-09-01|18:30|Strength": "full",
      "2026-09-02|19:00|Strength": "full",
    });
    const annotated = await annotateScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.equal(annotated.length, rawThree.length);
    assert.equal(isScheduleSlotPickAllFullResult(rawThree.length, annotated.length), false);
    const labels = buildScheduleSlotPickMenuLabels(annotated, CHANGE);
    assert.equal(labels.filter((l) => l.includes(OCCURRENCE_STATUS_FULL_SUFFIX)).length, 3);
  }

  // One fetch-pair per distinct date (Sun+Tue+Thu; Tue has two times).
  {
    const realistic = [
      { day: "א", time: "18:00" },
      { day: "ג", time: "18:30" },
      { day: "ג", time: "19:30" },
      { day: "ה", time: "18:00" },
    ];
    const { impl, calls } = fakeRawDataFetcher({
      "2026-09-01|18:30|Strength": "open",
      "2026-09-01|19:30|Strength": "open",
    });
    await annotateScheduleSlotsByOccurrenceState(realistic, STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.equal(calls.length, 3, "Sun + Tue + Thu = 3 dates, even though Tue has two times");
    assert.deepEqual(
      calls.map((c) => c.date).sort(),
      ["2026-09-01", "2026-09-03", "2026-09-06"]
    );
  }

  // Option 2 helpers still compile / exist (dead in list practice).
  assert.equal(
    SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE,
    "אני לא רואה כרגע מועדים זמינים לשיעור. אפשר לכתוב ״נציג אנושי״ ואעביר לפנייה לצוות, או לבחור אימון אחר."
  );
  assert.equal(SCHEDULE_SLOT_PICK_ALL_FULL_REPICK_LABEL, "בחירת אימון");
  assert.equal(scheduleSlotPickAllFullFiresHandoff(), false);
  assert.equal(isScheduleSlotPickAllFullRepickLabel(SCHEDULE_SLOT_PICK_ALL_FULL_REPICK_LABEL), true);
  assert.equal(userRequestedHumanAgent("נציג אנושי"), true);

  console.log("wa-schedule-slot-occurrence-filter.test.ts: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
