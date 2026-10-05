import assert from "node:assert/strict";
import type { ArboxOccurrenceStateResult } from "@/lib/arbox-occurrence-state";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { schedulePickChangeServiceLabel } from "@/lib/business-content-lang";
import { formatScheduleSlotDisplayLabel } from "@/lib/product-schedule-slots";
import { tryBuildArboxClassSpaceReply } from "@/lib/wa-arbox-class-space";
import { businessIgnoresClassFullness, hideClassFullness } from "@/lib/wa-class-full-policy";
import { resolveCtaOccurrenceOutcome } from "@/lib/wa-registration-cta-from-slot";
import {
  annotateScheduleSlotsByOccurrenceState,
  buildCatalogDaySlotsReply,
  buildScheduleSlotPickMenuLabels,
  OCCURRENCE_STATUS_CANCELLED_SUFFIX,
  OCCURRENCE_STATUS_FULL_SUFFIX,
  resolveScheduleSlotPickTap,
  type RawDataFetcher,
} from "@/lib/wa-relative-day-class-slots";

const tueMorning = new Date("2026-09-01T07:02:00.000Z");
const CHANGE = schedulePickChangeServiceLabel("he");

function svc(name: string, slots: { day: string; time: string }[], arboxClassName = ""): SfServiceRow {
  return {
    name,
    benefit: "",
    priceText: "",
    durationText: "",
    descriptionText: "",
    paymentLink: "https://example.com/join",
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

function fakeRawDataFetcher(byKey: Record<string, ArboxOccurrenceStateResult["state"]>): RawDataFetcher {
  return async ({ date }) => {
    const scheduleRows: Record<string, unknown>[] = [];
    const summaryRows: Record<string, unknown>[] = [];
    for (const [key, state] of Object.entries(byKey)) {
      const [d, time, className] = key.split("|");
      if (d !== date) continue;
      if (state === "cancelled") {
        summaryRows.push({ date: d, start_time: time, class_name: className, status: "cancelled" });
      } else if (state === "full" || state === "open") {
        scheduleRows.push({ date: d, start_time: time, session_name: className, max_participants: 5 });
        summaryRows.push({
          date: d,
          start_time: time,
          class_name: className,
          status: "active",
          registration_count: state === "full" ? 5 : 1,
        });
      }
    }
    return { scheduleRows, summaryRows };
  };
}

assert.equal(businessIgnoresClassFullness("omers-place"), true);
assert.equal(businessIgnoresClassFullness("Omers-Place"), true);
assert.equal(businessIgnoresClassFullness("apex"), false);
assert.equal(businessIgnoresClassFullness(""), false);
assert.equal(hideClassFullness("full", true), "open");
assert.equal(hideClassFullness("full", false), "full");
assert.equal(hideClassFullness("cancelled", true), "cancelled");

assert.equal(resolveCtaOccurrenceOutcome("full", { ignoreFull: true }), "send_link");
assert.equal(resolveCtaOccurrenceOutcome("cancelled", { ignoreFull: true }), "notice_cancelled");
assert.equal(resolveCtaOccurrenceOutcome("full"), "notice_full");

const slots = [
  { day: "א", time: "18:00" },
  { day: "ג", time: "18:30" },
  { day: "ד", time: "19:00" },
];
const offer = { businessId: 3618, arboxApiKey: "k", arboxBoxId: "1", now: tueMorning };

async function main() {
  const impl = fakeRawDataFetcher({
    "2026-09-06|18:00|Strength": "open",
    "2026-09-01|18:30|Strength": "full",
    "2026-09-02|19:00|Strength": "cancelled",
  });

  const hidden = await annotateScheduleSlotsByOccurrenceState([...slots], "Strength", {
    ...offer,
    ignoreClassFullness: true,
    rawDataFetcherImpl: impl,
  });
  const hiddenLabels = buildScheduleSlotPickMenuLabels(hidden, CHANGE);
  assert.equal(hiddenLabels.some((l) => l.includes(OCCURRENCE_STATUS_FULL_SUFFIX)), false);
  assert.equal(hiddenLabels.some((l) => l.includes(OCCURRENCE_STATUS_CANCELLED_SUFFIX)), true);
  assert.equal(hidden.find((s) => s.time === "18:30")?.occurrenceState, "open");

  const fullTap = resolveScheduleSlotPickTap({
    inboundText: formatScheduleSlotDisplayLabel({ day: "ג", time: "18:30" }),
    slotsForPick: hidden,
    labels: hiddenLabels,
    presentedLabels: hiddenLabels.map((l, i) => (i === 1 ? `${l}${OCCURRENCE_STATUS_FULL_SUFFIX}` : l)),
    ignoreClassFullness: true,
  });
  assert.equal(fullTap.kind, "open");
  if (fullTap.kind !== "open") throw new Error("expected open");
  assert.equal(fullTap.timeTxt, "18:30");

  const cancelledTap = resolveScheduleSlotPickTap({
    inboundText: hiddenLabels[2]!,
    slotsForPick: hidden,
    labels: hiddenLabels,
    ignoreClassFullness: true,
  });
  assert.equal(cancelledTap.kind, "blocked");
  if (cancelledTap.kind !== "blocked") throw new Error("expected blocked");
  assert.equal(cancelledTap.reason, "cancelled");

  const shown = await annotateScheduleSlotsByOccurrenceState([...slots], "Strength", {
    ...offer,
    rawDataFetcherImpl: impl,
  });
  const shownLabels = buildScheduleSlotPickMenuLabels(shown, CHANGE);
  assert.match(shownLabels[1]!, /18:30 \(מלא\)/);

  const catalog = await buildCatalogDaySlotsReply({
    day: "ג",
    sourceText: "מה יש ביום שלישי?",
    services: [svc("כוח", [{ day: "ג", time: "18:30" }], "Strength")],
    now: tueMorning,
    businessId: 3618,
    arboxApiKey: "k",
    arboxBoxId: "1",
    ignoreClassFullness: true,
    rawDataFetcherImpl: impl,
  });
  assert.equal(catalog?.kind, "lines");
  if (catalog?.kind !== "lines") throw new Error("expected lines");
  assert.doesNotMatch(catalog.text, /מלא/);
  assert.match(catalog.text, /18:30/);

  const space = await tryBuildArboxClassSpaceReply({
    text: "יש מקום לאימון היום ב18:30?",
    services: [svc("כוח", [{ day: "ג", time: "18:30" }], "Strength")],
    now: tueMorning,
    businessId: 3618,
    arboxApiKey: "k",
    arboxBoxId: "1",
    ignoreClassFullness: true,
    rawDataFetcherImpl: impl,
  });
  assert.match(space ?? "", /יש מקום/);
  assert.doesNotMatch(space ?? "", /מלא/);

  console.log("wa-class-full-policy.test.ts: ok");
}

main();
