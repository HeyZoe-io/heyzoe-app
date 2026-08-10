/**
 * קביעת מועד לשיחה (sales_flow_call_scheduling) —
 * day_of_week מיושר לאינדקס HEBREW_DAY_OPTIONS (0=ראשון … 6=שבת).
 */

import { HEBREW_DAY_OPTIONS } from "@/lib/product-schedule-slots";

/** תווית כפתור CTA כשהטוגל פעיל */
export const CALL_SCHEDULE_CTA_LABEL = "קביעת מועד לשיחה";

/** בלוקי שעתיים מותרים (CHECK על business_call_slots.time_block) */
export const CALL_SCHEDULE_TIME_BLOCKS = [
  "08:00-10:00",
  "10:00-12:00",
  "12:00-14:00",
  "14:00-16:00",
  "16:00-18:00",
  "18:00-20:00",
  "20:00-22:00",
] as const;

export type CallScheduleTimeBlock = (typeof CALL_SCHEDULE_TIME_BLOCKS)[number];

export type BusinessCallSlotRow = {
  day_of_week: number;
  time_block: string;
};

/** 0 = ראשון (= HEBREW_DAY_OPTIONS[0]) … 6 = שבת */
export function hebrewDayLetterFromDow(dayOfWeek: number): string {
  const opt = HEBREW_DAY_OPTIONS[dayOfWeek];
  return opt?.value ?? "";
}

export function hebrewDayLabelFromDow(dayOfWeek: number): string {
  const opt = HEBREW_DAY_OPTIONS[dayOfWeek];
  return opt?.label ?? "";
}

export function dayOfWeekFromHebrewLetter(letter: string): number | null {
  const t = String(letter ?? "").trim();
  if (!t) return null;
  const idx = HEBREW_DAY_OPTIONS.findIndex((o) => o.value === t || o.label === t);
  return idx >= 0 ? idx : null;
}

/** תווית כפתור יום בווטסאפ — «יום ראשון» */
export function callScheduleDayButtonLabel(dayOfWeek: number): string {
  const label = hebrewDayLabelFromDow(dayOfWeek);
  return label ? `יום ${label}` : "";
}

export function dayOfWeekFromCallScheduleDayButtonLabel(text: string): number | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  for (let i = 0; i < HEBREW_DAY_OPTIONS.length; i++) {
    const label = callScheduleDayButtonLabel(i);
    if (label && (raw === label || raw === HEBREW_DAY_OPTIONS[i]!.label || raw === HEBREW_DAY_OPTIONS[i]!.value)) {
      return i;
    }
  }
  const m = raw.match(/^יום\s+(.+)$/u);
  if (m) {
    const name = m[1]!.trim();
    const idx = HEBREW_DAY_OPTIONS.findIndex((o) => o.label === name);
    if (idx >= 0) return idx;
  }
  return null;
}

export function isValidCallScheduleDayOfWeek(n: unknown): n is number {
  const v = Number(n);
  return Number.isInteger(v) && v >= 0 && v <= 6;
}

export function isValidCallScheduleTimeBlock(raw: unknown): raw is CallScheduleTimeBlock {
  const t = String(raw ?? "").trim();
  return (CALL_SCHEDULE_TIME_BLOCKS as readonly string[]).includes(t);
}

export function normalizeCallScheduleSlots(
  rows: Array<{ day_of_week?: unknown; time_block?: unknown } | null | undefined>
): BusinessCallSlotRow[] {
  const seen = new Set<string>();
  const out: BusinessCallSlotRow[] = [];
  for (const row of rows) {
    if (!row) continue;
    const day = Number(row.day_of_week);
    const block = String(row.time_block ?? "").trim();
    if (!isValidCallScheduleDayOfWeek(day) || !isValidCallScheduleTimeBlock(block)) continue;
    const key = `${day}|${block}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day_of_week: day, time_block: block });
  }
  return out.sort((a, b) => a.day_of_week - b.day_of_week || a.time_block.localeCompare(b.time_block));
}

export function uniqueDaysWithSlots(slots: BusinessCallSlotRow[]): number[] {
  const days = new Set<number>();
  for (const s of slots) {
    if (isValidCallScheduleDayOfWeek(s.day_of_week)) days.add(s.day_of_week);
  }
  return [...days].sort((a, b) => a - b);
}

export function timeBlocksForDay(slots: BusinessCallSlotRow[], dayOfWeek: number): string[] {
  return slots
    .filter((s) => s.day_of_week === dayOfWeek && isValidCallScheduleTimeBlock(s.time_block))
    .map((s) => s.time_block)
    .sort((a, b) => a.localeCompare(b));
}

export function formatCallScheduleSlotForOwner(input: {
  dayOfWeek: number;
  timeBlock: string;
}): string {
  const day = hebrewDayLabelFromDow(input.dayOfWeek);
  const block = String(input.timeBlock ?? "").trim();
  if (day && block) return `יום ${day}, ${block}`;
  if (block) return block;
  if (day) return `יום ${day}`;
  return "";
}

/** מפתח ייחודי לשורה — להתאמת diff בשמירה */
export function callSlotKey(slot: BusinessCallSlotRow): string {
  return `${slot.day_of_week}|${slot.time_block}`;
}

/**
 * מחשב insert/delete בלבד מול מצב קיים (בלי wipe מלא).
 */
export function diffCallScheduleSlots(
  existing: BusinessCallSlotRow[],
  next: BusinessCallSlotRow[]
): { toInsert: BusinessCallSlotRow[]; toDelete: BusinessCallSlotRow[] } {
  const existingNorm = normalizeCallScheduleSlots(existing);
  const nextNorm = normalizeCallScheduleSlots(next);
  const existingKeys = new Set(existingNorm.map(callSlotKey));
  const nextKeys = new Set(nextNorm.map(callSlotKey));
  return {
    toInsert: nextNorm.filter((s) => !existingKeys.has(callSlotKey(s))),
    toDelete: existingNorm.filter((s) => !nextKeys.has(callSlotKey(s))),
  };
}

/** דורס תווית כפתור trial כשהטוגל פעיל */
export function applyCallScheduleCtaLabelOverride<T extends { kind?: string; label: string }>(
  buttons: T[],
  enabled: boolean
): T[] {
  if (!enabled) return buttons;
  return buttons.map((b) =>
    b.kind === "trial" ? { ...b, label: CALL_SCHEDULE_CTA_LABEL } : b
  );
}
