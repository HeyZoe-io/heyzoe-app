import assert from "node:assert/strict";
import type { ArboxOccurrenceStateResult } from "@/lib/arbox-occurrence-state";
import { formatSlotPickButtonLabelWithCycle } from "@/lib/product-schedule-slots";
import { userRequestedHumanAgent } from "@/lib/notifications/detect-human-request";
import { resolveWaMenuChoice } from "@/lib/wa-menu-choice";
import {
  filterScheduleSlotsByOccurrenceState,
  isScheduleSlotPickAllFullRepickLabel,
  isScheduleSlotPickAllFullResult,
  scheduleSlotPickAllFullFiresHandoff,
  SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE,
  SCHEDULE_SLOT_PICK_ALL_FULL_REPICK_LABEL,
  type RawDataFetcher,
} from "@/lib/wa-relative-day-class-slots";

/** Tuesday 10:02 Israel — same fixture as wa-relative-day-class-slots.test.ts */
const tueMorning = new Date("2026-09-01T07:02:00.000Z");

const STAMP = "Strength";
const OFFER_CTX_BASE = { businessId: 42, arboxApiKey: "k", arboxBoxId: "1" as string };

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
  // Verbatim empty-state copy + button. Handoff is never auto-fired from this path.
  assert.equal(
    SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE,
    "אני לא רואה כרגע מועדים זמינים לשיעור. אפשר לכתוב ״נציג אנושי״ ואעביר לפנייה לצוות, או לבחור אימון אחר."
  );
  assert.equal(SCHEDULE_SLOT_PICK_ALL_FULL_REPICK_LABEL, "בחירת אימון");
  assert.equal(scheduleSlotPickAllFullFiresHandoff(), false);
  assert.equal(isScheduleSlotPickAllFullRepickLabel(SCHEDULE_SLOT_PICK_ALL_FULL_REPICK_LABEL), true);
  assert.equal(isScheduleSlotPickAllFullRepickLabel("בחירת אימון אחר"), false);

  // Existing free-text detector already catches the phrase in the empty-state notice.
  assert.equal(userRequestedHumanAgent("נציג אנושי"), true);

  // ---------- index alignment (the regression that matters most) ----------
  // Raw index 1 (0-based) is full. Displayed buttons are [sun 18:00, wed 19:00].
  // Typing "2" / tapping the 2nd button must resolve to Wednesday, not the dropped Tuesday.
  {
    const { impl } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.deepEqual(
      filtered.map((s) => `${s.day}|${s.time}`),
      ["א|18:00", "ד|19:00"]
    );
    assert.equal(filtered.some((s) => s.day === "ג" && s.time === "18:30"), false);

    const labels = filtered.map((s) => formatSlotPickButtonLabelWithCycle(s));
    const resolved = resolveWaMenuChoice("2", undefined, labels, labels);
    const idx = labels.findIndex((l) => l === resolved);
    assert.equal(idx, 1, "typed 2 maps to the second DISPLAYED label");
    assert.equal(filtered[idx]!.day, "ד");
    assert.equal(filtered[idx]!.time, "19:00");
    assert.notEqual(filtered[idx]!.time, "18:30");
  }

  // One full slot dropped from a multi-slot menu; the open sibling stays.
  {
    const { impl } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.equal(filtered.length, 2);
    assert.ok(filtered.some((s) => s.time === "18:00"));
    assert.ok(filtered.some((s) => s.time === "19:00"));
  }

  // Cancelled slot dropped.
  {
    const { impl } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "cancelled" });
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.equal(filtered.some((s) => s.day === "ג"), false);
    assert.equal(filtered.length, 2);
  }

  // Unstamped product -> menu unchanged, zero Arbox calls.
  {
    const { impl, calls } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], "", {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.deepEqual(filtered, [...rawThree]);
    assert.equal(calls.length, 0);
    assert.equal(isScheduleSlotPickAllFullResult(rawThree.length, filtered.length), false);
  }

  // Unknown -> slot kept (fail-open).
  {
    const { impl } = fakeRawDataFetcher({});
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.deepEqual(
      filtered.map((s) => `${s.day}|${s.time}`),
      rawThree.map((s) => `${s.day}|${s.time}`)
    );
  }

  // All slots full -> empty-state result. Button label is the product-pick entry ("בחירת אימון"
  // → sendOpeningServicePickMenu). No auto handoff.
  {
    const { impl } = fakeRawDataFetcher({
      "2026-09-06|18:00|Strength": "full",
      "2026-09-01|18:30|Strength": "full",
      "2026-09-02|19:00|Strength": "full",
    });
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.equal(filtered.length, 0);
    assert.equal(isScheduleSlotPickAllFullResult(rawThree.length, filtered.length), true);
    assert.equal(scheduleSlotPickAllFullFiresHandoff(), false);
    assert.equal(isScheduleSlotPickAllFullRepickLabel("בחירת אימון"), true);
  }

  // Fail-open guard: fetch throws for every date -> all slots stay -> empty-state MUST NOT fire.
  {
    const { impl } = fakeRawDataFetcher({}, { throwOnFetch: true });
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.deepEqual(
      filtered.map((s) => `${s.day}|${s.time}`),
      rawThree.map((s) => `${s.day}|${s.time}`)
    );
    assert.equal(isScheduleSlotPickAllFullResult(rawThree.length, filtered.length), false);
  }

  // Fail-open guard: timeout/empty raw (unknown) on every slot -> empty-state does not fire.
  {
    const { impl } = fakeRawDataFetcher({});
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.equal(filtered.length, rawThree.length);
    assert.equal(isScheduleSlotPickAllFullResult(rawThree.length, filtered.length), false);
  }

  // Byte-identical lists: menu build and handler call the SAME fn with the SAME now.
  {
    const { impl } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const ctx = { ...OFFER_CTX_BASE, now: tueMorning, rawDataFetcherImpl: impl };
    const fromMenu = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, ctx);
    const fromHandler = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, ctx);
    assert.equal(JSON.stringify(fromMenu), JSON.stringify(fromHandler));
    assert.deepEqual(fromMenu, fromHandler);
  }

  // Live dedup: one fetch-pair per distinct date, not per slot.
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
    await filterScheduleSlotsByOccurrenceState(realistic, STAMP, {
      ...OFFER_CTX_BASE,
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    const dates = calls.map((c) => c.date).sort();
    assert.equal(calls.length, 3, "Sun + Tue + Thu = 3 dates, even though Tue has two times");
    assert.deepEqual(dates, ["2026-09-01", "2026-09-03", "2026-09-06"]);
  }

  // No creds -> unchanged, zero fetches (same gate as unstamped).
  {
    const { impl, calls } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const filtered = await filterScheduleSlotsByOccurrenceState([...rawThree], STAMP, {
      businessId: 42,
      arboxApiKey: "",
      arboxBoxId: "",
      now: tueMorning,
      rawDataFetcherImpl: impl,
    });
    assert.deepEqual(filtered, [...rawThree]);
    assert.equal(calls.length, 0);
  }

  console.log("wa-schedule-slot-occurrence-filter.test.ts: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
