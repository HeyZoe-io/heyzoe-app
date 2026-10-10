/**
 * Pure helpers for Arbox class auto-booking after a paid trial sale. No network, no DB.
 * The run step (arbox-class-autobook-run.ts) feeds them and acts on the result.
 */
import { addDaysYmd, hebrewDayLetterFromYmd, israelYmd, normalizeHhmm } from "@/lib/arbox-schedule-sync";
import { parseArboxClassStamp } from "@/lib/arbox-class-stamp";
import { formatIsraelDayMonth } from "@/lib/israel-time";
import {
  dayLetterFromHebrewDayName,
  formatDayNameForScheduleDatePlaceholder,
  normalizeProductScheduleSlotsFromMeta,
} from "@/lib/product-schedule-slots";

export const AUTOBOOK_MIN_LEAD_MS = 60 * 60 * 1000;
export const AUTOBOOK_MAX_PICK_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const AUTOBOOK_NOT_BOOKED_TEXT =
  "התשלום התקבל, תודה! 💜 לא הצלחתי לשריין לך את השיעור שבחרת, אז אני מעבירה לצוות שיחזרו אליך לסגור מועד.";

/** Top-level `businesses.social_links` key. Survives dashboard saves (prev ⊕ incoming merge). */
export const AUTOBOOK_BOOKED_TEXT_SOCIAL_KEY = "arbox_autobook_booked_text";

export type AutobookSkipReason =
  | "no_pick"
  | "course_date"
  | "bad_day"
  | "bad_time"
  | "no_anchor"
  | "stale_pick"
  | "no_product"
  | "no_stamp"
  | "schedule_removed"
  | "slot_not_in_product"
  | "no_membership_dates";

export type AutobookHandoffReason = "passed" | "lead_time" | "outside_membership";

export type AutobookTarget =
  | { kind: "skip"; reason: AutobookSkipReason }
  | { kind: "handoff"; reason: AutobookHandoffReason; date: string; time: string; className: string }
  | { kind: "target"; date: string; time: string; className: string; dayLetter: string };

const IL_TZ = "Asia/Jerusalem";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function wallClockInIsrael(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IL_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
}

/** Israel wall clock `YYYY-MM-DD` + `HH:MM` → UTC instant (DST-correct). */
export function israelLocalToUtc(ymd: string, hhmm: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const tm = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!dm || !tm) return null;
  const want = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  let guess = want - 2 * 60 * 60 * 1000;
  for (let i = 0; i < 3; i++) {
    const diff = want - wallClockInIsrael(new Date(guess));
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function ymdOf(raw: unknown): string | null {
  const s = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Weekly slots on the product, plus the per-branch copies under meta.branch_offers. */
export function productSlotKeys(meta: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  const add = (raw: unknown) => {
    for (const slot of normalizeProductScheduleSlotsFromMeta(raw, () => "")) {
      const time = normalizeHhmm(slot.time);
      if (slot.day && time) keys.add(`${slot.day}|${time}`);
    }
  };
  add(meta.schedule_slots);
  const branches = asRecord(meta.branch_offers);
  if (branches) {
    for (const offer of Object.values(branches)) add(asRecord(offer)?.schedule_slots);
  }
  return keys;
}

/**
 * The class this lead chose in Zoe's flow, as a concrete occurrence.
 * The date is the first matching weekday AFTER the moment of the pick (not after now),
 * so a late sale never silently moves the lead a week forward.
 */
export function resolveAutobookTarget(input: {
  pick: { date: string | null | undefined; time: string | null | undefined };
  pickAt: string | Date | null | undefined;
  now: Date;
  product: { meta: Record<string, unknown> } | null;
  saleRow: { start_date?: unknown; end_date?: unknown };
}): AutobookTarget {
  const rawDate = String(input.pick.date ?? "").trim();
  const rawTime = String(input.pick.time ?? "").trim();
  if (!rawDate || !rawTime) return { kind: "skip", reason: "no_pick" };
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) return { kind: "skip", reason: "course_date" };

  const dayLetter = dayLetterFromHebrewDayName(rawDate);
  if (!dayLetter) return { kind: "skip", reason: "bad_day" };
  const time = normalizeHhmm(rawTime);
  if (!time) return { kind: "skip", reason: "bad_time" };

  const pickAtMs = input.pickAt instanceof Date ? input.pickAt.getTime() : Date.parse(String(input.pickAt ?? ""));
  if (!Number.isFinite(pickAtMs)) return { kind: "skip", reason: "no_anchor" };
  const nowMs = input.now.getTime();
  if (nowMs - pickAtMs > AUTOBOOK_MAX_PICK_AGE_MS) return { kind: "skip", reason: "stale_pick" };

  const meta = input.product?.meta;
  if (!meta) return { kind: "skip", reason: "no_product" };
  const stamp = parseArboxClassStamp(meta);
  if (!stamp.arbox_class_name) return { kind: "skip", reason: "no_stamp" };
  if (stamp.schedule_removed_notice) return { kind: "skip", reason: "schedule_removed" };
  if (!productSlotKeys(meta).has(`${dayLetter}|${time}`)) return { kind: "skip", reason: "slot_not_in_product" };

  const pickYmd = israelYmd(new Date(pickAtMs));
  let date = "";
  let startMs = Number.NaN;
  for (let i = 0; i <= 7; i++) {
    const ymd = addDaysYmd(pickYmd, i);
    if (hebrewDayLetterFromYmd(ymd) !== dayLetter) continue;
    const start = israelLocalToUtc(ymd, time);
    if (start && start.getTime() > pickAtMs) {
      date = ymd;
      startMs = start.getTime();
      break;
    }
  }
  const className = stamp.arbox_class_name;
  if (!date) return { kind: "skip", reason: "bad_day" };

  if (startMs <= nowMs) return { kind: "handoff", reason: "passed", date, time, className };
  if (startMs < nowMs + AUTOBOOK_MIN_LEAD_MS) return { kind: "handoff", reason: "lead_time", date, time, className };

  const startDate = ymdOf(input.saleRow.start_date);
  if (!startDate) return { kind: "skip", reason: "no_membership_dates" };
  const endDate = ymdOf(input.saleRow.end_date);
  if (date < startDate || (endDate && date > endDate)) {
    return { kind: "handoff", reason: "outside_membership", date, time, className };
  }

  return { kind: "target", date, time, className, dayLetter };
}

/** {יום} → «רביעי», {תאריך} → «14.10», {שעה} → «18:30». */
export function fillAutobookBookedText(template: string, slot: { date: string; time: string }): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slot.date);
  const dayName = formatDayNameForScheduleDatePlaceholder(hebrewDayLetterFromYmd(slot.date));
  const dm = m ? formatIsraelDayMonth(Number(m[2]), Number(m[3])) : "";
  return template.replaceAll("{יום}", dayName).replaceAll("{תאריך}", dm).replaceAll("{שעה}", slot.time).trim();
}

/** Join key between an attempts row and a bookingsReport row (`user_id`, `date`, `time`). */
export function autobookOccurrenceKey(arboxUserId: unknown, ymd: unknown, hhmm: unknown): string {
  return `${String(arboxUserId ?? "").trim()}|${String(ymd ?? "").trim().slice(0, 10)}|${normalizeHhmm(hhmm)}`;
}

export function autobookBookedTextFromSocial(social: unknown): string {
  return String(asRecord(social)?.[AUTOBOOK_BOOKED_TEXT_SOCIAL_KEY] ?? "").trim();
}

/** `POST /v3/schedule/bookSession` 200 body → `data[0].booking_id`. */
export function bookingIdFromBookSessionJson(json: unknown): number | null {
  const data = asRecord(json)?.data;
  const first = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
  const id = Number(first?.booking_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Short error text for the attempts row. Digit runs (phones, ids) are masked. */
export function summarizeArboxBookingError(json: unknown): string {
  const rec = asRecord(json);
  const raw = [rec?.message, rec?.error, rec?.errors]
    .map((v) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v)))
    .filter(Boolean)
    .join(" | ");
  return raw.replace(/\d{4,}/g, "#").replace(/[^\s|]+@[^\s|]+/g, "@").slice(0, 200);
}
