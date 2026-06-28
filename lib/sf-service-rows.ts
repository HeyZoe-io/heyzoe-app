import { offerKindFromServiceMeta } from "@/lib/sales-flow";
import {
  migrateLegacyCourseToCycles,
  resolveWaSchedulePickSlotsFromMeta,
  syncCourseLegacyDatesFromCycles,
  type CourseCycle,
  type WaSchedulePickSlot,
} from "@/lib/product-schedule-slots";

export type SfOfferKind = "trial" | "workshop" | "course";

export type SfServiceRow = {
  name: string;
  benefit: string;
  priceText: string;
  durationText: string;
  paymentLink: string;
  levelsEnabled: boolean;
  levels: string[];
  trialPickMediaUrl: string;
  trialPickMediaType: "image" | "video" | "";
  offerKind: SfOfferKind;
  courseSessionsText: string;
  courseStartDate: string;
  courseEndDate: string;
  /** מועדי לוח / מחזורי קורס — לבחירה בווטסאפ */
  scheduleSlots: WaSchedulePickSlot[];
  courseCycles: CourseCycle[];
};

export type RawServiceRowInput = {
  name?: unknown;
  description?: unknown;
  price_text?: unknown;
};

/** כש-JSON ב-description שבור — משחזרים לפחות את שדות מדיית בחירת השירות */
export function fallbackTrialPickFromRawDescription(
  raw: string
): Pick<SfServiceRow, "trialPickMediaUrl" | "trialPickMediaType"> {
  const text = raw.trim();
  if (!text) return { trialPickMediaUrl: "", trialPickMediaType: "" };
  const url = (text.match(/"trial_pick_media_url"\s*:\s*"([^"]*)"/)?.[1] ?? "").trim();
  const t = (text.match(/"trial_pick_media_type"\s*:\s*"(video|image)"/i)?.[1] ?? "").toLowerCase();
  const trialPickMediaType =
    t === "video" ? ("video" as const) : t === "image" ? ("image" as const) : ("" as const);
  return { trialPickMediaUrl: url, trialPickMediaType };
}

function parseOneSfServiceRow(s: RawServiceRowInput): SfServiceRow | null {
  const name = String(s.name ?? "").trim();
  if (!name) return null;

  try {
    const raw = String(s.description ?? "");
    const stripped = raw.trim().startsWith("__META__:") ? raw.trim().slice("__META__:".length) : raw;
    const candidate = stripped.replace(/^\uFEFF/, "").trimStart();
    const jsonStart = candidate.indexOf("{");
    const toParse = jsonStart >= 0 ? candidate.slice(jsonStart) : candidate;
    const meta = JSON.parse(toParse.trim() || "{}") as Record<string, unknown>;
    return {
      name,
      benefit: String(meta.benefit_line ?? "").trim(),
      priceText: String(s.price_text ?? meta.price_text ?? "").trim(),
      durationText: String(meta.duration ?? "").trim(),
      paymentLink: String(meta.payment_link ?? "").trim(),
      levelsEnabled: meta.levels_enabled === true,
      levels: Array.isArray(meta.levels)
        ? meta.levels.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [],
      trialPickMediaUrl: String(meta.trial_pick_media_url ?? "").trim(),
      trialPickMediaType:
        meta.trial_pick_media_type === "video"
          ? ("video" as const)
          : meta.trial_pick_media_type === "image"
            ? ("image" as const)
            : ("" as const),
      offerKind: offerKindFromServiceMeta(meta),
      courseSessionsText: String(meta.course_sessions_count ?? "").trim(),
      courseStartDate: (() => {
        const k = offerKindFromServiceMeta(meta);
        if (k === "course") {
          let c = 0;
          return syncCourseLegacyDatesFromCycles(
            migrateLegacyCourseToCycles(meta, () => `s${c++}`)
          ).course_start_date;
        }
        return String(meta.course_start_date ?? "").trim();
      })(),
      courseEndDate: (() => {
        const k = offerKindFromServiceMeta(meta);
        if (k === "course") {
          let c = 0;
          return syncCourseLegacyDatesFromCycles(
            migrateLegacyCourseToCycles(meta, () => `s${c++}`)
          ).course_end_date;
        }
        return String(meta.course_end_date ?? "").trim();
      })(),
      scheduleSlots: (() => {
        let c = 0;
        return resolveWaSchedulePickSlotsFromMeta(meta, offerKindFromServiceMeta(meta), () => `s${c++}`);
      })(),
      courseCycles: (() => {
        let c = 0;
        return migrateLegacyCourseToCycles(meta, () => `s${c++}`);
      })(),
    };
  } catch {
    const raw = String(s.description ?? "");
    const fb = fallbackTrialPickFromRawDescription(raw);
    return {
      name,
      benefit: "",
      priceText: String(s.price_text ?? "").trim(),
      durationText: "",
      paymentLink: "",
      levelsEnabled: false,
      levels: [],
      trialPickMediaUrl: fb.trialPickMediaUrl,
      trialPickMediaType: fb.trialPickMediaType,
      offerKind: "trial",
      courseSessionsText: "",
      courseStartDate: "",
      courseEndDate: "",
      scheduleSlots: [],
      courseCycles: [],
    };
  }
}

/** Parse שורות services מ-DB ל-runtime של פלואו מכירה בווטסאפ */
export function parseSfServiceRows(rawServices: RawServiceRowInput[]): SfServiceRow[] {
  return rawServices
    .map(parseOneSfServiceRow)
    .filter((row): row is SfServiceRow => row !== null);
}
