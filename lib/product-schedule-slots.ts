/** מועדי לוח לפי מוצר (מערכת שעות לא־אינטראקטיבית) — נשמר ב־JSON של service.description */

export type ProductScheduleSlot = {
  id: string;
  /** א׳–ש׳ (ראשון–שבת) — ערך יציב לכפתורים/תצוגה */
  day: string;
  /** HH:MM בפורמט 24 שעות */
  time: string;
};

/** תווים מותרים ליום — א׳ (ראשון) עד ש׳ (שבת) */
export const HEBREW_DAY_OPTIONS: { value: string; label: string }[] = [
  { value: "א", label: "ראשון" },
  { value: "ב", label: "שני" },
  { value: "ג", label: "שלישי" },
  { value: "ד", label: "רביעי" },
  { value: "ה", label: "חמישי" },
  { value: "ו", label: "שישי" },
  { value: "ש", label: "שבת" },
];

const DAY_SET = new Set(HEBREW_DAY_OPTIONS.map((o) => o.value));

/** יום לא נבחר בדשבורד — לא נשלח לווטסאפ */
export const SCHEDULE_SLOT_DAY_UNSET = "";

export function isConfiguredProductScheduleSlot(slot: { day: string; time: string }): boolean {
  const day = normalizeDayLetter(slot.day);
  const time = normalizeTimeHHMM(slot.time);
  return Boolean(day && time);
}

export function filterConfiguredProductScheduleSlots<T extends { day: string; time: string }>(
  slots: readonly T[]
): T[] {
  return slots.filter(isConfiguredProductScheduleSlot);
}

export function createEmptyProductScheduleSlot(newId: () => string): ProductScheduleSlot {
  return { id: newId(), day: SCHEDULE_SLOT_DAY_UNSET, time: "00:00" };
}

function normalizeDayLetter(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const first = [...t][0] ?? "";
  if (DAY_SET.has(first)) return first;
  // לעיתים מגיע "א׳" / "ב׳"
  const noNik = t.replace(/[\u0591-\u05C7]/g, "");
  const c0 = [...noNik][0] ?? "";
  return DAY_SET.has(c0) ? c0 : "";
}

function normalizeTimeHHMM(raw: string): string {
  const t = String(raw ?? "").trim().replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "");
  const m = t.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function normalizeProductScheduleSlotsFromMeta(raw: unknown, newId: () => string): ProductScheduleSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductScheduleSlot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const dayRaw = String(o.day ?? o.day_letter ?? "").trim();
    const day = dayRaw === "" ? SCHEDULE_SLOT_DAY_UNSET : normalizeDayLetter(dayRaw);
    const timeRaw = String(o.time ?? "").trim();
    const time = normalizeTimeHHMM(timeRaw) || (timeRaw.length > 0 ? timeRaw : "00:00");
    if (day === SCHEDULE_SLOT_DAY_UNSET && !timeRaw) continue;
    const id = String(o.id ?? "").trim() || newId();
    out.push({ id, day: day || SCHEDULE_SLOT_DAY_UNSET, time });
  }
  return out;
}

/** לתצוגה בווטסאפ / שמירה ב־sf_requested_date — למשל «יום ב׳» */
export function formatYomForContactSlotDate(dayLetter: string): string {
  const opt = HEBREW_DAY_OPTIONS.find((o) => o.value === dayLetter);
  const short = opt ? opt.label.trim() : dayLetter;
  return `יום ${short}`;
}

/** תווית כפתור: «יום ב׳ ב19:00» */
export function formatSlotPickButtonLabel(slot: { day: string; time: string }): string {
  return `${formatYomForContactSlotDate(slot.day)} ב${slot.time}`;
}

/** נרמול לזיהוי בחירת מועד מרשימת וואטסאפ (ב-18:45 מול ב18:45, רווחים). */
export function normalizeScheduleSlotPickLabel(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ב\s*-\s*/gu, "ב")
    .replace(/ב\s+(?=\d)/gu, "ב");
}

export function scheduleSlotPickLabelsMatch(a: string, b: string): boolean {
  return normalizeScheduleSlotPickLabel(a) === normalizeScheduleSlotPickLabel(b);
}

export function formatScheduleSlotsForKnowledge(slots: ProductScheduleSlot[]): string {
  const configured = filterConfiguredProductScheduleSlots(slots);
  if (!configured.length) return "";
  return configured.map((s) => `${formatYomForContactSlotDate(s.day)} ${s.time}`).join(", ");
}

/** מחזור קורס: טווח תאריכים + מועדים שבועיים בתוך המחזור */
export type CourseCycle = {
  id: string;
  start_date: string;
  end_date: string;
  schedule_slots: ProductScheduleSlot[];
};

export function createEmptyCourseCycle(newId: () => string): CourseCycle {
  return {
    id: newId(),
    start_date: "",
    end_date: "",
    schedule_slots: [createEmptyProductScheduleSlot(newId)],
  };
}

export function formatCycleDateShort(isoDate: string): string {
  const t = String(isoDate ?? "").trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return t;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const DAY_SORT_ORDER: Record<string, number> = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5, ש: 6 };

export function sortProductScheduleSlots<T extends { day: string; time: string }>(slots: T[]): T[] {
  const toMin = (t: string): number => {
    const m = String(t ?? "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!m) return 10_000;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  return [...slots].sort((a, b) => {
    const da = DAY_SORT_ORDER[a.day] ?? 99;
    const db = DAY_SORT_ORDER[b.day] ?? 99;
    if (da !== db) return da - db;
    return toMin(a.time) - toMin(b.time);
  });
}

export function sortCourseCyclesByStartDate(cycles: CourseCycle[]): CourseCycle[] {
  return [...cycles].sort((a, b) => {
    const as = a.start_date.trim();
    const bs = b.start_date.trim();
    if (as && bs) return as.localeCompare(bs);
    if (as) return -1;
    if (bs) return 1;
    return 0;
  });
}

function hebrewDayLabelForPhrase(dayLetter: string): string {
  const opt = HEBREW_DAY_OPTIONS.find((o) => o.value === dayLetter);
  return opt?.label?.trim() || dayLetter;
}

function formatCycleSlotsPhrase(slots: ProductScheduleSlot[]): string {
  const configured = sortProductScheduleSlots(filterConfiguredProductScheduleSlots(slots));
  if (!configured.length) return "";
  return configured
    .map((s, idx) => {
      const dayLabel = hebrewDayLabelForPhrase(s.day);
      return idx === 0 ? `ביום ${dayLabel} בשעה ${s.time}` : `וביום ${dayLabel} בשעה ${s.time}`;
    })
    .join("");
}

/** פסקת מועדים לקורס לפני בחירת מחזור (ללא המילה «קורס» בתחילה) */
export function buildCourseScheduleInfoMessage(serviceName: string, cycles: CourseCycle[]): string {
  const name = serviceName.trim() || "הקורס";
  const sorted = sortCourseCyclesByStartDate(
    cycles.filter(
      (c) =>
        c.start_date.trim() ||
        c.end_date.trim() ||
        filterConfiguredProductScheduleSlots(c.schedule_slots).length > 0
    )
  );
  if (!sorted.length) return "";

  const cycleLines: string[] = [];
  let hasDateRange = false;

  for (let ci = 0; ci < sorted.length; ci++) {
    const cycle = sorted[ci]!;
    const slotsPhrase = formatCycleSlotsPhrase(cycle.schedule_slots);
    const start = formatCycleDateShort(cycle.start_date);
    const end = formatCycleDateShort(cycle.end_date);

    let segment = "";
    if (start && end) {
      hasDateRange = true;
      segment = `${start} עד ה${end}`;
    } else if (start) {
      hasDateRange = true;
      segment = `מתאריך ${start}`;
    } else if (end) {
      segment = `עד ה${end}`;
    }
    if (slotsPhrase) {
      segment = segment ? `${segment}, ${slotsPhrase}` : slotsPhrase;
    }
    if (!segment) continue;

    cycleLines.push(ci === 0 ? segment : `או ב: ${segment}`);
  }

  if (!cycleLines.length) return "";

  const body = hasDateRange
    ? [`${name} מתקיים בתאריכים:`, ...cycleLines].join("\n")
    : [`${name} מתקיים`, ...cycleLines].join("\n");
  return body.endsWith(".") ? body : `${body}.`;
}

/** לתבנית CTA קורס: «כל יום ראשון בשעה 08:30» (מכל המחזורים) */
export function buildCourseSchedulePhraseForCta(cycles: CourseCycle[]): string {
  const sorted = sortCourseCyclesByStartDate(
    cycles.filter(
      (c) =>
        c.start_date.trim() ||
        c.end_date.trim() ||
        filterConfiguredProductScheduleSlots(c.schedule_slots).length > 0
    )
  );
  const lines: string[] = [];
  for (const cycle of sorted) {
    for (const slot of sortProductScheduleSlots(filterConfiguredProductScheduleSlots(cycle.schedule_slots))) {
      const dayLabel = hebrewDayLabelForPhrase(slot.day);
      lines.push(`כל יום ${dayLabel} בשעה ${slot.time}`);
    }
  }
  if (!lines.length) return "";
  if (lines.length === 1) return lines[0]!;
  return lines.map((line, i) => (i === 0 ? line : `או ${line}`)).join(", ");
}

export function buildCourseCostAfterWarmupLine(priceText: string, sessionsText: string): string {
  const p = priceText.trim() || "...";
  const s = sessionsText.trim() || "...";
  return `עלות הקורס היא ${p} ₪ לכל ${s} המפגשים.`;
}

export function buildCourseCycleStartPickQuestion(): string {
  return "מתי נוח לך להתחיל את הקורס?";
}

export function formatCourseCycleStartButtonLabel(startDateIso: string): string {
  const d = formatCycleDateShort(startDateIso);
  return d ? `התחלה ב${d}` : "התחלה";
}

export function courseCycleStartButtonLabelsMatch(a: string, b: string): boolean {
  return normalizeScheduleSlotPickLabel(a) === normalizeScheduleSlotPickLabel(b);
}

/** מחזורים עם תאריך התחלה — לכפתורי בחירה (מהקרוב לרחוק) */
export function courseCyclesForStartButtons(cycles: CourseCycle[]): CourseCycle[] {
  return sortCourseCyclesByStartDate(cycles.filter((c) => c.start_date.trim()));
}

export function courseHasCycleSchedulePickData(cycles: CourseCycle[]): boolean {
  return cycles.some(
    (c) => c.start_date.trim() || filterConfiguredProductScheduleSlots(c.schedule_slots).length > 0
  );
}

export function formatCourseCycleDateRange(start_date: string, end_date: string): string {
  const a = formatCycleDateShort(start_date);
  const b = formatCycleDateShort(end_date);
  if (a && b) return `${a}–${b}`;
  return a || b || "";
}

export function normalizeCourseCyclesFromMeta(raw: unknown, newId: () => string): CourseCycle[] {
  if (Array.isArray(raw)) {
    const out: CourseCycle[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = String(o.id ?? "").trim() || newId();
      const start_date = String(o.start_date ?? "").trim();
      const end_date = String(o.end_date ?? "").trim();
      const schedule_slots = normalizeProductScheduleSlotsFromMeta(o.schedule_slots, newId);
      if (!start_date && !end_date && !schedule_slots.some(isConfiguredProductScheduleSlot)) continue;
      out.push({ id, start_date, end_date, schedule_slots });
    }
    if (out.length) return out;
  }

  return [];
}

/** מיגרציה: קורס ישן עם תאריכים + מועדי לוח ברמת המוצר */
export function migrateLegacyCourseToCycles(
  meta: Record<string, unknown>,
  newId: () => string
): CourseCycle[] {
  const fromMeta = normalizeCourseCyclesFromMeta(meta.course_cycles, newId);
  if (fromMeta.length) return fromMeta;

  const start_date = String(meta.course_start_date ?? "").trim();
  const end_date = String(meta.course_end_date ?? "").trim();
  const schedule_slots = normalizeProductScheduleSlotsFromMeta(meta.schedule_slots, newId);
  if (!start_date && !end_date && !schedule_slots.some(isConfiguredProductScheduleSlot)) {
    return [];
  }
  return [{ id: newId(), start_date, end_date, schedule_slots }];
}

/** תאריכי קורס לתבניות CTA — מהמחזור הראשון עם תאריך התחלה */
export function syncCourseLegacyDatesFromCycles(cycles: CourseCycle[]): {
  course_start_date: string;
  course_end_date: string;
} {
  const first = cycles.find((c) => c.start_date.trim()) ?? cycles[0];
  if (!first) return { course_start_date: "", course_end_date: "" };
  return {
    course_start_date: first.start_date.trim(),
    course_end_date: first.end_date.trim(),
  };
}

export function formatCourseCyclesForKnowledge(cycles: CourseCycle[]): string {
  const parts: string[] = [];
  cycles.forEach((cycle, idx) => {
    const range = formatCourseCycleDateRange(cycle.start_date, cycle.end_date);
    const slots = formatScheduleSlotsForKnowledge(cycle.schedule_slots);
    if (!range && !slots) return;
    const label = range ? `מחזור ${idx + 1} (${range})` : `מחזור ${idx + 1}`;
    parts.push(slots ? `${label}: ${slots}` : label);
  });
  return parts.join(" | ");
}

export type WaSchedulePickSlot = { day: string; time: string; cycle_start?: string; cycle_end?: string };

/** מועדים לבחירה בווטסאפ — כל מחזור עם כל המועדים המוגדרים שלו */
export function flattenCourseCyclesForWaPick(cycles: CourseCycle[]): WaSchedulePickSlot[] {
  const out: WaSchedulePickSlot[] = [];
  for (const cycle of cycles) {
    const configured = filterConfiguredProductScheduleSlots(cycle.schedule_slots);
    for (const slot of configured) {
      out.push({
        day: slot.day,
        time: slot.time,
        cycle_start: cycle.start_date.trim() || undefined,
        cycle_end: cycle.end_date.trim() || undefined,
      });
    }
  }
  return out;
}

export function formatSlotPickButtonLabelWithCycle(
  slot: { day: string; time: string },
  cycle?: { start_date?: string; end_date?: string }
): string {
  const base = formatSlotPickButtonLabel(slot);
  const range = formatCourseCycleDateRange(cycle?.start_date ?? "", cycle?.end_date ?? "");
  return range ? `${range} · ${base}` : base;
}

export function resolveScheduleSlotsForServiceMeta(
  meta: Record<string, unknown>,
  offerKind: string,
  newId: () => string
): { day: string; time: string }[] {
  if (offerKind === "course") {
    return flattenCourseCyclesForWaPick(migrateLegacyCourseToCycles(meta, newId)).map(({ day, time }) => ({
      day,
      time,
    }));
  }
  return filterConfiguredProductScheduleSlots(
    normalizeProductScheduleSlotsFromMeta(meta.schedule_slots, newId)
  ).map(({ day, time }) => ({ day, time }));
}

export function resolveWaSchedulePickSlotsFromMeta(
  meta: Record<string, unknown>,
  offerKind: string,
  newId: () => string
): WaSchedulePickSlot[] {
  if (offerKind === "course") {
    return flattenCourseCyclesForWaPick(migrateLegacyCourseToCycles(meta, newId));
  }
  return filterConfiguredProductScheduleSlots(
    normalizeProductScheduleSlotsFromMeta(meta.schedule_slots, newId)
  ).map(({ day, time }) => ({ day, time }));
}
