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
    const day = normalizeDayLetter(String(o.day ?? o.day_letter ?? ""));
    const time = normalizeTimeHHMM(String(o.time ?? ""));
    if (!day || !time) continue;
    const id = String(o.id ?? "").trim() || newId();
    out.push({ id, day, time });
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
  if (!slots.length) return "";
  return slots.map((s) => `${formatYomForContactSlotDate(s.day)} ${s.time}`).join(", ");
}
