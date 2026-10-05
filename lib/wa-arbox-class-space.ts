/**
 * שאלת «יש מקום בשיעור» ללקוח ארבוקס.
 * בודקים אילו שיעורים קיימים ביום ובשעה, ואז תפוסה (שני GET ליום: schedule + classesSummary).
 * הקריאה נשמרת 60 שניות ב-getOccurrenceRawData — לא סריקת טבלה, ורק כששואלים.
 */
import { getOccurrenceRawData, resolveOccurrenceState, type ArboxOccurrenceRaw } from "@/lib/arbox-occurrence-state";
import { normalizeHhmm } from "@/lib/arbox-schedule-sync";
import { getIsraelDayLetter, israelCalendarDatePlusDays, resolveNextOccurrence } from "@/lib/israel-time";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { hideClassFullness } from "@/lib/wa-class-full-policy";
import {
  looksLikeClassSpaceQuestion,
  matchCatalogServicesFromFreeText,
  parseRequestedClassDays,
  parseRequestedTimes,
  type DayLetter,
} from "@/lib/wa-unknown-class-slot";

export const ARBOX_CLASS_SPACE_MODEL = "arbox_class_space";

const APP_CHECK = "אפשר לוודא על ידי בדיקה באפליקציה.";

const DAY_NAME: Record<DayLetter, string> = {
  א: "ראשון",
  ב: "שני",
  ג: "שלישי",
  ד: "רביעי",
  ה: "חמישי",
  ו: "שישי",
  ש: "שבת",
};

export type ClassSpaceState = "open" | "full" | "cancelled" | "unknown";

export type ClassSpaceHit = {
  name: string;
  day: DayLetter;
  time: string;
  dateYmd: string;
  state: ClassSpaceState;
};

function normalizeSlotTime(raw: string): string {
  const m = String(raw ?? "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return "";
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

function dayPhrase(day: DayLetter, now: Date): string {
  return day === getIsraelDayLetter(now) ? "היום" : `ביום ${DAY_NAME[day]}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} ואת ${names[1]}`;
  return `${names.slice(0, -1).join(", את ")} ואת ${names[names.length - 1]}`;
}

/** שיעורים בלוח השבועי שתואמים ליום ולשעה בשאלה. בלי יום — היום. */
export function findWeeklyClassSpaceHits(
  text: string,
  services: SfServiceRow[],
  now: Date = new Date()
): { hits: ClassSpaceHit[]; times: string[]; day: DayLetter | null } {
  const times = parseRequestedTimes(text).map(normalizeSlotTime).filter(Boolean);
  if (!times.length) return { hits: [], times: [], day: null };
  const parsedDays = parseRequestedClassDays(text, now);
  const days = parsedDays.length ? parsedDays : [getIsraelDayLetter(now)];
  const day = days[0] ?? null;
  const named = matchCatalogServicesFromFreeText(text, services);
  const pool = named.length ? services.filter((s) => named.includes(s.name)) : services;
  const askedToday = /היום|\btoday\b/iu.test(text);
  const hits: ClassSpaceHit[] = [];
  const seen = new Set<string>();
  for (const service of pool) {
    const name = String(service.name ?? "").trim();
    if (!name) continue;
    for (const slot of service.scheduleSlots ?? []) {
      const slotDay = String(slot.day ?? "").trim() as DayLetter;
      if (!days.includes(slotDay)) continue;
      const time = normalizeSlotTime(slot.time);
      if (!time || !times.includes(time)) continue;
      const occ = resolveNextOccurrence(slotDay, time, now);
      if (askedToday && slotDay === getIsraelDayLetter(now) && occ.daysAhead !== 0) continue;
      const key = `${name}|${slotDay}|${time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ name, day: slotDay, time, dateYmd: occ.ymd, state: "unknown" });
    }
  }
  return { hits, times, day };
}

export function composeArboxClassSpaceReply(input: {
  hits: ClassSpaceHit[];
  times: string[];
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const times = input.times.length ? input.times : ["השעה שציינת"];
  const timeLabel = times.map((t) => `ב-${t}`).join(" או ");
  if (!input.hits.length) {
    const when = input.times.length ? timeLabel : "בשעה הזו";
    return `אני לא רואה שיעור היום ${when}. ${APP_CHECK}`;
  }
  const bySlot = new Map<string, ClassSpaceHit[]>();
  for (const hit of input.hits) {
    const key = `${hit.day}|${hit.time}`;
    const list = bySlot.get(key) ?? [];
    list.push(hit);
    bySlot.set(key, list);
  }
  const sentences: string[] = [];
  for (const group of bySlot.values()) {
    const when = dayPhrase(group[0]!.day, now);
    const time = group[0]!.time;
    const open = group.filter((h) => h.state === "open" || h.state === "unknown");
    const full = group.filter((h) => h.state === "full");
    const cancelled = group.filter((h) => h.state === "cancelled");
    if (open.length === 1 && !full.length && !cancelled.length) {
      sentences.push(
        `אני רואה שיש ${when} את השיעור ${open[0]!.name} ב-${time}, ולפי מה שאני רואה יש מקום.`
      );
    } else if (open.length > 1 && !full.length && !cancelled.length) {
      sentences.push(
        `אני רואה שיש ${when} ב-${time} את ${joinNames(open.map((h) => h.name))}, ולפי מה שאני רואה יש מקום.`
      );
    } else {
      if (open.length === 1) {
        sentences.push(
          `אני רואה שיש ${when} את השיעור ${open[0]!.name} ב-${time}, ולפי מה שאני רואה יש מקום.`
        );
      } else if (open.length > 1) {
        sentences.push(
          `אני רואה שיש ${when} ב-${time} את ${joinNames(open.map((h) => h.name))}, ולפי מה שאני רואה יש מקום.`
        );
      }
      if (full.length === 1) {
        sentences.push(
          `אני רואה שיש ${when} את השיעור ${full[0]!.name} ב-${time}, ולפי מה שאני רואה השיעור מלא.`
        );
      } else if (full.length > 1) {
        sentences.push(
          `אני רואה שיש ${when} ב-${time} את ${joinNames(full.map((h) => h.name))}, ולפי מה שאני רואה השיעורים מלאים.`
        );
      }
      if (cancelled.length) {
        sentences.push(
          `אני רואה שהשיעור ${joinNames(cancelled.map((h) => h.name))} ${when} ב-${time} לא מתקיים.`
        );
      }
    }
  }
  return `${sentences.join(" ")} ${APP_CHECK}`;
}

type RawFetcher = (input: {
  businessId: number | string;
  apiKey: string;
  boxId: string;
  date: string;
}) => Promise<ArboxOccurrenceRaw>;

/**
 * תשובה דטרמיניסטית. null = זו לא שאלת מקום, או שאין בה שעה.
 * שני קריאות ארבוקס ליום (schedule + סיכום), לא לכל שיעור.
 */
export async function tryBuildArboxClassSpaceReply(input: {
  text: string;
  services: SfServiceRow[];
  now?: Date;
  businessId: string | number;
  arboxApiKey: string;
  arboxBoxId: string;
  /** Omer's place: a full class is described as having space, never as full. */
  ignoreClassFullness?: boolean;
  rawDataFetcherImpl?: RawFetcher;
}): Promise<string | null> {
  const text = String(input.text ?? "").trim();
  if (!looksLikeClassSpaceQuestion(text)) return null;
  const now = input.now ?? new Date();
  const found = findWeeklyClassSpaceHits(text, input.services, now);
  if (!found.times.length) return null;
  const apiKey = String(input.arboxApiKey ?? "").trim();
  const boxId = String(input.arboxBoxId ?? "").trim();
  const fetcher = input.rawDataFetcherImpl ?? getOccurrenceRawData;
  const askedToday = /היום|\btoday\b/iu.test(text);
  const todayCal = israelCalendarDatePlusDays(now, 0);
  const todayYmd = `${todayCal.year}-${String(todayCal.month).padStart(2, "0")}-${String(todayCal.day).padStart(2, "0")}`;
  let dates = [
    ...new Set(
      found.hits.length
        ? found.hits.map((h) => h.dateYmd)
        : found.times.map((time) => {
            const day = found.day ?? getIsraelDayLetter(now);
            return resolveNextOccurrence(day, time, now).ymd;
          })
    ),
  ];
  if (askedToday) dates = dates.filter((d) => d === todayYmd);
  if (!dates.length) {
    return composeArboxClassSpaceReply({ hits: [], times: found.times, now });
  }
  const rawByDate = new Map<string, ArboxOccurrenceRaw>();
  if (apiKey && boxId && input.businessId != null && String(input.businessId).trim()) {
    await Promise.all(
      dates.map(async (date) => {
        try {
          const raw = await fetcher({
            businessId: input.businessId,
            apiKey,
            boxId,
            date,
          });
          rawByDate.set(date, raw);
        } catch (e) {
          console.error("[wa-arbox-class-space] occurrence fetch failed", {
            businessId: input.businessId,
            date,
            error: e instanceof Error ? e.message : String(e),
          });
          rawByDate.set(date, { scheduleRows: null, summaryRows: null });
        }
      })
    );
  }

  const liveHits = hitsFromLiveSchedule(rawByDate, found.times, input.services, found.day, now);
  const scheduleKnown = [...rawByDate.values()].some((raw) => Array.isArray(raw.scheduleRows));
  const baseHits = scheduleKnown ? liveHits : found.hits;
  const hits = baseHits.map((hit) => {
    const service = input.services.find((s) => s.name === hit.name);
    const className = String(service?.arboxClassName ?? "").trim() || hit.name;
    const raw = rawByDate.get(hit.dateYmd);
    if (!raw) return hit;
    const state = hideClassFullness(
      resolveOccurrenceState(raw, hit.dateYmd, hit.time, className).state,
      input.ignoreClassFullness
    );
    return { ...hit, state };
  });
  return composeArboxClassSpaceReply({ hits, times: found.times, now });
}

function hitsFromLiveSchedule(
  rawByDate: Map<string, ArboxOccurrenceRaw>,
  times: string[],
  services: SfServiceRow[],
  day: DayLetter | null,
  now: Date
): ClassSpaceHit[] {
  const hits: ClassSpaceHit[] = [];
  const seen = new Set<string>();
  const slotDay = day ?? getIsraelDayLetter(now);
  for (const [dateYmd, raw] of rawByDate) {
    for (const row of raw.scheduleRows ?? []) {
      const rowDate = String(row.date ?? "").trim().slice(0, 10);
      const time = normalizeHhmm(row.start_time);
      if (rowDate !== dateYmd || !times.includes(time)) continue;
      const sessionName = String(row.session_name ?? "").trim();
      if (!sessionName) continue;
      const service =
        services.find((s) => s.arboxClassName.trim() === sessionName) ??
        services.find((s) => s.name.trim() === sessionName);
      const name = service?.name.trim() || sessionName;
      const key = `${name}|${time}|${dateYmd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ name, day: slotDay, time, dateYmd, state: "unknown" });
    }
  }
  return hits;
}
