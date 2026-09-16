import assert from "node:assert/strict";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { matchCatalogServiceFromFreeText, shouldHandoffUnknownClassSlot } from "@/lib/wa-unknown-class-slot";
import type { ArboxOccurrenceStateResult } from "@/lib/arbox-occurrence-state";
import { userRequestedHumanAgent } from "@/lib/notifications/detect-human-request";
import {
  buildIsraelNowSchedulePromptBlock,
  buildWhichExistingClassQuestion,
  EXISTING_CLASS_WHICH_CLASS_MODEL,
  formatDayClassScheduleLine,
  formatNamedClassScheduleLine,
  isRelativeDayCatalogAllFullReply,
  isScheduleSlotPickAllFullRepickLabel,
  isScheduleSlotPickAllFullResult,
  previousUserTextFromHistory,
  RELATIVE_DAY_CLASS_SLOTS_MODEL,
  scheduleSlotPickAllFullFiresHandoff,
  SCHEDULE_SLOT_PICK_ALL_FULL_MODEL,
  SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE,
  SCHEDULE_SLOT_PICK_ALL_FULL_REPICK_LABEL,
  tryBuildRelativeDayClassSlotsReply,
  type RawDataFetcher,
} from "@/lib/wa-relative-day-class-slots";

function svc(name: string, slots: { day: string; time: string }[], arboxClassName = ""): SfServiceRow {
  return {
    name,
    benefit: "",
    priceText: "80",
    durationText: "55",
    descriptionText: "",
    paymentLink: "",
    levelsEnabled: false,
    levels: [],
    trialPickMediaUrl: "",
    trialPickMediaType: "",
    offerKind: "trial",
    courseSessionsText: "",
    courseStartDate: "",
    courseEndDate: "",
    scheduleSlots: slots.map((s) => ({ day: s.day, time: s.time })),
    courseCycles: [],
    locationMode: "location",
    locationText: "",
    courseDatesEnabled: true,
    arboxClassName,
  };
}

const tueMorning = new Date("2026-09-01T07:02:00.000Z"); // שלישי 10:02 ישראל

const chair = svc("פילאטיס מכשירים (כסא)", [
  { day: "א", time: "18:00" },
  { day: "א", time: "19:00" },
  { day: "ב", time: "18:00" },
  { day: "ג", time: "18:30" },
  { day: "ג", time: "19:30" },
  { day: "ה", time: "18:00" },
]);

const strength = svc("אימוני כוח - Strength", [
  { day: "ג", time: "19:30" },
  { day: "ד", time: "18:30" },
]);

const catalog = [chair, strength];

/**
 * A raw-data fetcher that synthesizes /v3/schedule + classesSummaryReport rows for whatever
 * "date|time|className" -> desired state is registered, so the REAL resolveOccurrenceState join
 * logic runs under test too. Call count is per DISTINCT DATE — the actual dedup unit, since the
 * production code fetches once per date and resolves every candidate on it locally.
 */
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
        summaryRows.push({ date: d, start_time: time, class_name: className, status: "active", registration_count: 5 });
      } else if (state === "open") {
        scheduleRows.push({ date: d, start_time: time, session_name: className, max_participants: 5 });
        summaryRows.push({ date: d, start_time: time, class_name: className, status: "active", registration_count: 1 });
      }
      // "unknown" (or unregistered) -> no rows for that key at all, resolves to unknown naturally.
    }
    return { scheduleRows, summaryRows };
  };
  return { impl, calls };
}

async function main() {
  assert.equal(
    formatNamedClassScheduleLine("פילאטיס מכשירים", "מחר (חמישי)", ["19:30"]),
    "פילאטיס מכשירים | מחר (חמישי) ב-19:30"
  );
  assert.equal(
    formatNamedClassScheduleLine("פילאטיס מכשירים", "הערב", ["18:30", "19:30"]),
    "פילאטיס מכשירים | הערב ב-18:30 וב-19:30"
  );
  assert.equal(
    formatDayClassScheduleLine("היום", "18:30", "פילאטיס מזרן"),
    "היום ב-18:30, פילאטיס מזרן"
  );

  assert.equal(matchCatalogServiceFromFreeText("כיסא", catalog), "פילאטיס מכשירים (כסא)");

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "כיסא",
      previousUserText: "אפשר לבוא לעוד אימון הערב?",
      services: catalog,
      now: tueMorning,
    });
    assert.ok(reply);
    assert.equal(reply!.modelUsed, RELATIVE_DAY_CLASS_SLOTS_MODEL);
    assert.match(reply!.text, /פילאטיס מכשירים \(כסא\) \| הערב ב-18:30 וב-19:30/);
    assert.doesNotMatch(reply!.text, /הערב יש/);
    assert.doesNotMatch(reply!.text, /18:30.{0,12}מכשירים.{0,12}הערב/);
    assert.doesNotMatch(reply!.text, /18:00/);
    assert.doesNotMatch(reply!.text, /19:00/);
  }

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש כיסא מחר?",
      services: catalog,
      now: tueMorning,
    });
    assert.ok(reply);
    assert.match(reply!.text, /מחר/);
    assert.match(reply!.text, /אין/);
  }

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "ומחר?",
      previousUserText: "כיסא",
      services: catalog,
      now: tueMorning,
    });
    assert.ok(reply);
    assert.match(reply!.text, /מחר/);
    assert.match(reply!.text, /אין/);
  }

  assert.equal(
    await tryBuildRelativeDayClassSlotsReply({
      text: "כיסא",
      services: catalog,
      now: tueMorning,
    }),
    null,
    "service name alone without a day is not a today/tomorrow listing"
  );

  assert.equal(
    await tryBuildRelativeDayClassSlotsReply({
      text: "כיסא",
      previousUserText: "אפשר לבוא לעוד אימון הערב?",
      services: catalog,
      sessionPhase: "schedule_date",
      now: tueMorning,
    }),
    null,
    "do not intercept the schedule picker"
  );

  assert.equal(
    shouldHandoffUnknownClassSlot({
      text: "יש כיסא הערב ב-19:00?",
      services: catalog,
      now: tueMorning,
    }),
    true,
    "tonight 19:00 is not on Tuesday chair — handoff"
  );

  assert.equal(
    shouldHandoffUnknownClassSlot({
      text: "יש כיסא הערב ב-18:30?",
      services: catalog,
      now: tueMorning,
    }),
    false,
    "tonight 18:30 exists on Tuesday"
  );

  assert.equal(
    previousUserTextFromHistory({
      currentText: "כיסא",
      userMessagesOldestFirst: ["אפשר לבוא לעוד אימון הערב?", "כיסא"],
    }),
    "אפשר לבוא לעוד אימון הערב?"
  );

  {
    const block = buildIsraelNowSchedulePromptBlock(catalog, tueMorning);
    assert.match(block, /שלישי/);
    assert.match(block, /18:30/);
    assert.match(block, /רביעי/);
  }

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש כיסא הערב?",
      services: catalog,
      now: tueMorning,
    });
    assert.ok(reply);
    assert.match(reply!.text, /18:30/);
    assert.match(reply!.text, /19:30/);
  }

  const joeWeekly = [
    svc("אקרו יוגה - ליחיד", [
      { day: "ב", time: "19:00" },
      { day: "ג", time: "19:00" },
    ]),
    svc("עמידות ידיים / גמישות", [
      { day: "א", time: "18:00" },
      { day: "ב", time: "18:00" },
    ]),
    svc("שיעור אקרו אישי (1 - 1)", []),
  ];

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "אני יכול רק ביום ראשון. מתי יש אימון?",
      previousUserText: "כמה עולה שיעור ניסיון?",
      services: joeWeekly,
      now: tueMorning,
    });
    assert.ok(reply, "generic Sunday ask should list catalog classes");
    assert.equal(reply!.modelUsed, RELATIVE_DAY_CLASS_SLOTS_MODEL);
    assert.match(reply!.text, /ראשון/);
    assert.match(reply!.text, /ביום ראשון ב-18:00, עמידות ידיים/);
    assert.match(reply!.text, /18:00/);
    assert.doesNotMatch(reply!.text, /19:00/);
    assert.doesNotMatch(reply!.text, /אקרו יוגה/);
    assert.doesNotMatch(reply!.text, /עמידות ידיים.{0,20}ב-18:00/);
  }

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "אני יכול רק ביום ראשון. מתי יש אימון?",
      services: [svc("שיעור אקרו אישי (1 - 1)", [])],
      now: tueMorning,
    });
    assert.equal(reply, null, "no Sunday in catalog → leave to unknown-slot handoff");
  }

  {
    const talCouldntSee = `היי כן,
אשמח לקבוע אימון שני ניסיון לשבוע הבא ביום שני
לא הצלחתי לראות איזה אימונים יש לכן שאלתי אם יש במקרה אימון כוח ביום שני ב19:30?`;
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: talCouldntSee,
      services: catalog,
      now: tueMorning,
    });
    assert.ok(reply, "couldn't-see-classes + Monday → catalog Monday slots, not membership lookup");
    assert.equal(reply!.modelUsed, RELATIVE_DAY_CLASS_SLOTS_MODEL);
    assert.match(reply!.text, /שני/);
    assert.match(reply!.text, /18:00/);
  }

  {
    const shirCancel = `היוש, וולקאם באק 🙂 תבטלי את השיעור עם שיר בבקשה. היא חולה.
היה לי רק שיעןר עם ליאת היום`;
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: shirCancel,
      previousUserText: "כיסא",
      services: catalog,
      now: new Date("2026-09-03T07:00:00.000Z"), // חמישי
    });
    assert.equal(reply, null, "cancel-class must not dump today's pilates slot");
  }

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "היה לי רק שיעור עם ליאת היום",
      previousUserText: "כיסא",
      services: catalog,
      now: new Date("2026-09-03T07:00:00.000Z"),
    });
    assert.equal(reply, null, "past class with a coach is not a schedule ask");
  }

  {
    const overflowMat = svc("פילאטיס מזרן", [{ day: "ד", time: "18:30" }]);
    const flowOnly = Array.from({ length: 10 }, (_, i) => svc(`אימון ${i + 1}`, [{ day: "א", time: "10:00" }]));
    const wedAfternoon = new Date("2026-09-09T14:00:00.000Z");
    assert.equal(matchCatalogServiceFromFreeText("יש מזרן היום?", flowOnly), null);
    const withOverflow = [...flowOnly, overflowMat];
    assert.equal(matchCatalogServiceFromFreeText("יש מזרן היום?", withOverflow), "פילאטיס מזרן");
    const matToday = await tryBuildRelativeDayClassSlotsReply({
      text: "יש מזרן היום?",
      services: withOverflow,
      now: wedAfternoon,
    });
    assert.ok(matToday);
    assert.match(matToday!.text, /18:30/);
    assert.doesNotMatch(matToday!.text, /אין/);
  }

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "הייי יגאל מה קורה יהיה אימון ביום שישי ערב חג ?",
      services: [svc("איגרוף", [{ day: "ו", time: "19:00" }])],
      now: new Date("2026-09-09T14:00:00.000Z"),
    });
    assert.equal(reply, null, "holiday eve must not list weekly Friday slots");
  }

  {
    // Tuesday 19:00 Israel — chair's 18:30 Tuesday slot already passed, 19:30 hasn't.
    const tueEvening = new Date("2026-09-01T16:00:00.000Z");
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש כיסא הערב?",
      services: catalog,
      now: tueEvening,
    });
    assert.ok(reply, "19:30 is still ahead — a reply should still be built");
    assert.doesNotMatch(reply!.text, /18:30/, "already-passed 18:30 must not be offered");
    assert.match(reply!.text, /19:30/, "19:30 hasn't passed yet — still offered");
  }

  {
    // Tuesday 19:45 Israel — both chair Tuesday slots (18:30, 19:30) already passed.
    const tueLate = new Date("2026-09-01T16:45:00.000Z");
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש כיסא הערב?",
      services: catalog,
      now: tueLate,
    });
    assert.ok(reply, "no slots left today should still produce the 'none today' reply");
    assert.match(reply!.text, /אין/);
    assert.doesNotMatch(reply!.text, /18:30/);
    assert.doesNotMatch(reply!.text, /19:30/);
  }

  {
    // Prompt-block backup path: today's already-passed slot must not appear either.
    const tueEvening = new Date("2026-09-01T16:00:00.000Z");
    const block = buildIsraelNowSchedulePromptBlock(catalog, tueEvening);
    const todayLine = block.split("מועדים למחר")[0]!;
    assert.doesNotMatch(todayLine, /18:30/, "prompt block must drop today's already-passed slot");
    assert.match(todayLine, /19:30/, "prompt block keeps today's still-upcoming slot");
  }

  // ==========================================================================
  // Stage 2c Part 1 — fullness/cancellation omission in the list path
  // ==========================================================================
  const arboxCtx = { businessId: 42, arboxApiKey: "k", arboxBoxId: "1" };

  // Stamped product, one of two times on the (only) requested day is full -> only that time drops.
  {
    const stamped = svc("אימוני כוח - Strength", [{ day: "ג", time: "18:30" }, { day: "ג", time: "19:30" }], "Strength");
    const { impl } = fakeRawDataFetcher({ "2026-09-01|18:30|Strength": "full" });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש חדר כוח הערב?",
      services: [stamped],
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply);
    assert.doesNotMatch(reply!.text, /18:30/, "the full time is dropped");
    assert.match(reply!.text, /19:30/, "the open time is kept");
    assert.doesNotMatch(reply!.text, /אין/, "still one time left — not a 'none' reply");
  }

  // All times on a day are cancelled, and that day is NOT the only day requested ->
  // the whole day-line disappears (no "none" message for it either).
  {
    const stamped = svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }, { day: "ד", time: "18:30" }], "Strength");
    const { impl } = fakeRawDataFetcher({
      "2026-09-01|19:30|Strength": "cancelled", // Tuesday — the only Tuesday slot
    });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "מתי יש חדר כוח היום ומחר?",
      services: [stamped],
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply, "Wednesday's slot still stands, so a reply is still built");
    assert.doesNotMatch(reply!.text, /שלישי.{0,20}אין/, "Tuesday's day-line must not appear at all, not even as 'none'");
    assert.match(reply!.text, /18:30/, "Wednesday's open slot is still offered");
  }

  // Same, but it's the ONLY requested day -> falls through to the existing "none" message.
  {
    const stamped = svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }], "Strength");
    const { impl } = fakeRawDataFetcher({ "2026-09-01|19:30|Strength": "cancelled" });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש חדר כוח הערב?",
      services: [stamped],
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply);
    assert.match(reply!.text, /אין/, "the only requested day, fully suppressed, must fall back to 'none'");
    assert.doesNotMatch(reply!.text, /19:30/);
  }

  // Unstamped product (no arbox_class_name) -> completely untouched, zero raw-data fetches.
  {
    const unstamped = svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }], "");
    const { impl, calls } = fakeRawDataFetcher({ "2026-09-01|19:30|Strength": "full" });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש חדר כוח הערב?",
      services: [unstamped],
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply);
    assert.match(reply!.text, /19:30/, "unstamped product is offered exactly as before, never checked");
    assert.equal(calls.length, 0, "zero Arbox fetches for an unstamped product");
  }

  // "unknown" behaves identically to "open" — never suppressed. (No rows registered for this
  // key at all -> resolveOccurrenceState naturally returns "unknown".)
  {
    const stamped = svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }], "Strength");
    const { impl } = fakeRawDataFetcher({});
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש חדר כוח הערב?",
      services: [stamped],
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply);
    assert.match(reply!.text, /19:30/, "unknown must behave exactly like open — never omitted");
  }

  // No Arbox context at all (businessId/apiKey/boxId missing) -> nothing filtered, no fetches.
  {
    const stamped = svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }], "Strength");
    const { impl, calls } = fakeRawDataFetcher({ "2026-09-01|19:30|Strength": "full" });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יש חדר כוח הערב?",
      services: [stamped],
      now: tueMorning,
      rawDataFetcherImpl: impl,
      // no businessId/arboxApiKey/arboxBoxId
    });
    assert.ok(reply);
    assert.match(reply!.text, /19:30/);
    assert.equal(calls.length, 0, "no Arbox context -> fetcher is never invoked");
  }

  // Dedup — the real point of the Stage 2c fix: a catalog-wide day ask across many stamped
  // services, including different times/classNames, all on the SAME date, must fetch raw data
  // ONCE (one date), not once per candidate.
  {
    const multi = [
      svc("A", [{ day: "ג", time: "19:00" }], "ClassA"),
      svc("B", [{ day: "ג", time: "19:00" }], "ClassB"),
      svc("C", [{ day: "ג", time: "20:00" }], "ClassA"), // same className, different time
    ];
    const { impl, calls } = fakeRawDataFetcher({});
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "מה יש ביום שלישי?",
      services: multi,
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply);
    assert.equal(calls.length, 1, "one raw-data fetch for the one distinct date, regardless of candidate count");
    assert.equal(calls[0]!.date, "2026-09-01");
  }

  // Dedup across two distinct dates (multi-day single-service reply, e.g. "today and tomorrow")
  // must fetch exactly once per distinct date — two dates, two fetches, not more.
  {
    const stamped = svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }, { day: "ד", time: "18:30" }], "Strength");
    const { impl, calls } = fakeRawDataFetcher({});
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "מתי יש חדר כוח היום ומחר?",
      services: [stamped],
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply);
    assert.equal(calls.length, 2, "two distinct requested dates -> two fetches, not one per slot");
    assert.deepEqual(new Set(calls.map((c) => c.date)), new Set(["2026-09-01", "2026-09-02"]));
  }

  // ==========================================================================
  // Catalog-wide all-full (Option 2) — two empties must not collapse
  // ==========================================================================
  const stampedTueWed = [
    svc("פילאטיס מכשירים (כסא)", [{ day: "ג", time: "18:30" }, { day: "ג", time: "19:30" }], "Chair"),
    svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }, { day: "ד", time: "18:30" }], "Strength"),
  ];

  // (a) all slots full -> all-full message + button contract (same empty-state as the menu path).
  {
    const { impl, calls } = fakeRawDataFetcher({
      "2026-09-01|18:30|Chair": "full",
      "2026-09-01|19:30|Chair": "full",
      "2026-09-01|19:30|Strength": "full",
    });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "מה יש ביום שלישי?",
      services: stampedTueWed,
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.equal(isRelativeDayCatalogAllFullReply(reply), true);
    assert.equal(reply!.kind, "all_full");
    assert.equal(reply!.text, SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE);
    assert.equal(reply!.modelUsed, SCHEDULE_SLOT_PICK_ALL_FULL_MODEL);
    assert.equal(isScheduleSlotPickAllFullResult(3, 0), true);
    assert.equal(isScheduleSlotPickAllFullRepickLabel(SCHEDULE_SLOT_PICK_ALL_FULL_REPICK_LABEL), true);
    assert.equal(scheduleSlotPickAllFullFiresHandoff(), false);
    assert.equal(userRequestedHumanAgent("נציג אנושי"), true);
    assert.equal(calls.length, 1, "one fetch-pair for the one requested date — already paid by LIST, not extra");
  }

  // (b) all slots cancelled -> same all-full empty state.
  {
    const { impl } = fakeRawDataFetcher({
      "2026-09-01|18:30|Chair": "cancelled",
      "2026-09-01|19:30|Chair": "cancelled",
      "2026-09-01|19:30|Strength": "cancelled",
    });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "מה יש ביום שלישי?",
      services: stampedTueWed,
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.equal(isRelativeDayCatalogAllFullReply(reply), true);
    assert.equal(reply!.text, SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE);
    assert.equal(reply!.modelUsed, SCHEDULE_SLOT_PICK_ALL_FULL_MODEL);
  }

  // (c) genuinely no class that day (items.length === 0) -> NOT all-full; current null fall-through.
  {
    const { impl, calls } = fakeRawDataFetcher({
      "2026-09-01|19:30|Strength": "full",
    });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "מה יש ביום ראשון?",
      services: [svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }], "Strength")],
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.equal(reply, null, "no Sunday weekly slots -> Claude fall-through, not the all-full notice");
    assert.equal(isRelativeDayCatalogAllFullReply(reply), false);
    assert.equal(calls.length, 0, "genuinely-empty never fetches");
  }

  // (d) multi-day: one day all-full, another has open slots -> list the open day, omit the full day, NO all-full notice.
  {
    const { impl, calls } = fakeRawDataFetcher({
      "2026-09-01|18:30|Chair": "full",
      "2026-09-01|19:30|Chair": "full",
      "2026-09-01|19:30|Strength": "full",
      "2026-09-02|18:30|Strength": "open",
    });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "איזה אימונים יש היום ומחר?",
      services: stampedTueWed,
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply);
    assert.equal(reply!.kind, "list");
    assert.equal(isRelativeDayCatalogAllFullReply(reply), false);
    assert.match(reply!.text, /18:30/, "Wednesday's open slot is listed");
    assert.match(reply!.text, /מחר/, "open day is tomorrow, not today");
    assert.doesNotMatch(reply!.text, /היום/, "Tuesday's all-full day-line is omitted, not replaced by the notice");
    assert.doesNotMatch(reply!.text, /19:30/, "Tuesday-only times must not leak into the reply");
    assert.notEqual(reply!.text, SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE);
    assert.equal(new Set(calls.map((c) => c.date)).size, 2);
  }

  // (e) multi-day where ALL requested days are all-full -> all-full message.
  {
    const { impl } = fakeRawDataFetcher({
      "2026-09-01|18:30|Chair": "full",
      "2026-09-01|19:30|Chair": "full",
      "2026-09-01|19:30|Strength": "full",
      "2026-09-02|18:30|Strength": "full",
    });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "איזה אימונים יש היום ומחר?",
      services: stampedTueWed,
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.equal(isRelativeDayCatalogAllFullReply(reply), true);
    assert.equal(reply!.text, SCHEDULE_SLOT_PICK_ALL_FULL_NOTICE);
  }

  // (f) fetch throws -> slots kept as unknown -> list reply, not all-full (fail-open).
  {
    const { impl, calls } = fakeRawDataFetcher({}, { throwOnFetch: true });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "מה יש ביום שלישי?",
      services: stampedTueWed,
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply, "fail-open still answers from the weekly template");
    assert.equal(isRelativeDayCatalogAllFullReply(reply), false);
    assert.equal(reply!.kind, "list");
    assert.match(reply!.text, /18:30/);
    assert.match(reply!.text, /19:30/);
    assert.ok(calls.length >= 1);
  }

  // (g) unstamped catalog-wide -> unchanged listing, zero fetches, never all-full.
  {
    const unstamped = [
      svc("פילאטיס מכשירים (כסא)", [{ day: "ג", time: "18:30" }, { day: "ג", time: "19:30" }], ""),
      svc("אימוני כוח - Strength", [{ day: "ג", time: "19:30" }], ""),
    ];
    const { impl, calls } = fakeRawDataFetcher({
      "2026-09-01|18:30|Chair": "full",
      "2026-09-01|19:30|Chair": "full",
      "2026-09-01|19:30|Strength": "full",
    });
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "מה יש ביום שלישי?",
      services: unstamped,
      now: tueMorning,
      ...arboxCtx,
      rawDataFetcherImpl: impl,
    });
    assert.ok(reply);
    assert.equal(reply!.kind, "list");
    assert.equal(isRelativeDayCatalogAllFullReply(reply), false);
    assert.match(reply!.text, /18:30/);
    assert.match(reply!.text, /19:30/);
    assert.equal(calls.length, 0, "unstamped catalog-wide never fetches");
  }

  const apexFriday = [
    svc("חדר כושר", [
      { day: "ו", time: "07:30" },
      { day: "ו", time: "08:30" },
      { day: "ו", time: "09:30" },
    ]),
    svc("אימון פונקציונלי", [
      { day: "ו", time: "07:30" },
      { day: "ו", time: "12:00" },
    ]),
    svc("אימונים לנוער (ז'-י')", [
      { day: "ו", time: "13:00" },
      { day: "א", time: "17:00" },
    ]),
  ];
  const monMorning = new Date("2026-09-15T05:42:00.000Z");
  const semyonMakeup = `שון שכח מהאימון ביום שישי
האם יש אפשרות להחזיר את השיעור ?

ורציתי לדעת האם יש אימון השבוע`;

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: semyonMakeup,
      services: apexFriday,
      now: monMorning,
    });
    assert.ok(reply, "missed Friday class without a name must still reply");
    assert.equal(reply!.kind, "list");
    assert.equal(reply!.modelUsed, EXISTING_CLASS_WHICH_CLASS_MODEL);
    assert.match(reply!.text, /שון היה אמור להגיע לאיזה שיעור ביום שישי/);
    assert.doesNotMatch(reply!.text, /חדר כושר/);
    assert.doesNotMatch(reply!.text, /07:30/);
    assert.doesNotMatch(reply!.text, /פונקציונלי/);
  }

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "יהיה אימון ביום שישי?",
      services: apexFriday,
      now: monMorning,
    });
    assert.ok(reply, "plain Friday timetable ask still lists catalog");
    assert.equal(reply!.modelUsed, RELATIVE_DAY_CLASS_SLOTS_MODEL);
    assert.match(reply!.text, /חדר כושר/);
  }

  {
    const reply = await tryBuildRelativeDayClassSlotsReply({
      text: "שון שכח מאימון נוער ביום שישי, אפשר להחזיר את השיעור?",
      services: apexFriday,
      now: monMorning,
    });
    assert.ok(reply);
    assert.equal(reply!.modelUsed, RELATIVE_DAY_CLASS_SLOTS_MODEL);
    assert.match(reply!.text, /נוער/);
    assert.doesNotMatch(reply!.text, /חדר כושר/);
  }

  assert.match(
    buildWhichExistingClassQuestion({
      text: "מאיה שכחה מהאימון ביום שני",
      day: "ב",
      now: monMorning,
    }),
    /מאיה הייתה אמורה להגיע לאיזה שיעור ביום שני/
  );

  console.log("wa-relative-day-class-slots.test.ts: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
