import { offerKindFromServiceMeta } from "@/lib/sales-flow";
import {
  migrateLegacyCourseToCycles,
  resolveWaSchedulePickSlotsFromMeta,
  syncCourseLegacyDatesFromCycles,
  type CourseCycle,
  type WaSchedulePickSlot,
} from "@/lib/product-schedule-slots";

export type SfOfferKind = "trial" | "workshop" | "course";

/** פיזי (location) | אונליין — רלוונטי במיוחד לקורס */
export type SfLocationMode = "location" | "online";

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
  locationMode: SfLocationMode;
  locationText: string;
  /** קורס: האם יש תאריכי התחלה/סיום (מחזורים). ברירת מחדל true */
  courseDatesEnabled: boolean;
};

export type RawServiceRowInput = {
  name?: unknown;
  description?: unknown;
  price_text?: unknown;
  location_mode?: unknown;
  location_text?: unknown;
};

export function resolveSfLocationMode(raw: unknown): SfLocationMode {
  return String(raw ?? "").trim().toLowerCase() === "online" ? "online" : "location";
}

export function resolveCourseDatesEnabled(meta: Record<string, unknown> | null | undefined): boolean {
  return meta?.course_dates_enabled !== false;
}

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
    const offerKind = offerKindFromServiceMeta(meta);
    const courseDatesEnabled = offerKind === "course" ? resolveCourseDatesEnabled(meta) : true;
    const courseCycles = (() => {
      if (offerKind !== "course" || !courseDatesEnabled) return [] as CourseCycle[];
      let c = 0;
      return migrateLegacyCourseToCycles(meta, () => `s${c++}`);
    })();
    const locationModeFromMeta =
      meta.location_mode === "online" || meta.location_mode === "location"
        ? meta.location_mode
        : undefined;
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
      offerKind,
      courseSessionsText: String(meta.course_sessions_count ?? "").trim(),
      courseStartDate: (() => {
        if (offerKind !== "course" || !courseDatesEnabled) return "";
        return syncCourseLegacyDatesFromCycles(courseCycles).course_start_date;
      })(),
      courseEndDate: (() => {
        if (offerKind !== "course" || !courseDatesEnabled) return "";
        return syncCourseLegacyDatesFromCycles(courseCycles).course_end_date;
      })(),
      scheduleSlots: (() => {
        if (offerKind === "course" && !courseDatesEnabled) return [];
        let c = 0;
        return resolveWaSchedulePickSlotsFromMeta(meta, offerKind, () => `s${c++}`);
      })(),
      courseCycles,
      locationMode: resolveSfLocationMode(locationModeFromMeta ?? s.location_mode),
      locationText: String(s.location_text ?? meta.location_text ?? "").trim(),
      courseDatesEnabled,
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
      locationMode: resolveSfLocationMode(s.location_mode),
      locationText: String(s.location_text ?? "").trim(),
      courseDatesEnabled: true,
    };
  }
}

/** Parse שורות services מ-DB ל-runtime של פלואו מכירה בווטסאפ */
export function parseSfServiceRows(rawServices: RawServiceRowInput[]): SfServiceRow[] {
  return rawServices
    .map(parseOneSfServiceRow)
    .filter((row): row is SfServiceRow => row !== null);
}
