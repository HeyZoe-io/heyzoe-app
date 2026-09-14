import {
  HEBREW_DAY_OPTIONS,
  filterConfiguredProductScheduleSlots,
  sortProductScheduleSlots,
} from "@/lib/product-schedule-slots";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import {
  addIsraelDayLetter,
  getIsraelDayLetter,
  hasWeeklySlotPassedToday,
  resolveNextOccurrence,
  type IsraelDayLetter,
} from "@/lib/israel-time";
import {
  isCatalogWideClassDayAsk,
  looksLikeClassTimeQuestion,
  matchCatalogServiceFromFreeText,
  parseRequestedClassDays,
  asksWhichClassesOnDay,
  looksLikeHolidayClassScheduleAsk,
} from "@/lib/wa-unknown-class-slot";
import { classifyInboundSpeechAct, shouldAnswerFromClassTimetable } from "@/lib/wa-inbound-speech-act";
import {
  getOccurrenceRawData,
  resolveOccurrenceState,
  type ArboxOccurrenceRaw,
  type ArboxOccurrenceStateResult,
} from "@/lib/arbox-occurrence-state";

export const RELATIVE_DAY_CLASS_SLOTS_MODEL = "relative_day_class_slots";

const DAY_NAME: Record<IsraelDayLetter, string> = {
  א: "ראשון",
  ב: "שני",
  ג: "שלישי",
  ד: "רביעי",
  ה: "חמישי",
  ו: "שישי",
  ש: "שבת",
};

/** Same-day slots whose time already passed (+ grace) are dropped — a recurring "today" slot
 * that's already over isn't a real offer until it recurs next week. */
function slotsForDay(service: SfServiceRow, day: IsraelDayLetter, now: Date): { day: string; time: string }[] {
  const rows = filterConfiguredProductScheduleSlots(service.scheduleSlots ?? []);
  const sameDay = sortProductScheduleSlots(rows.filter((s) => String(s.day ?? "").trim() === day));
  return sameDay.filter((s) => !hasWeeklySlotPassedToday(day, s.time, now));
}

export type RawDataFetcher = (input: {
  businessId: number | string;
  apiKey: string;
  boxId: string;
  date: string;
}) => Promise<ArboxOccurrenceRaw>;

export type ArboxOfferContext = {
  businessId?: number | string | null;
  arboxApiKey?: string | null;
  arboxBoxId?: string | null;
  /** Test-only override — production callers must not set this. */
  rawDataFetcherImpl?: RawDataFetcher;
};

function occurrenceStateKey(dateYmd: string, time: string, arboxClassName: string): string {
  return `${dateYmd}|${time}|${arboxClassName}`;
}

/**
 * Fetches raw Arbox data ONCE per distinct date, then resolves every candidate locally via
 * the pure resolveOccurrenceState — NOT once per candidate. Calling getOccurrenceState once
 * per candidate would be wrong here: unstable_cache only de-dupes once the first call has
 * resolved, so N candidates fired concurrently (Promise.all) on the same date would each miss
 * the still-empty cache and trigger N real fetches (verified live: 11 concurrent callers -> 11
 * real fetches). Fetching once per date up front and reusing the raw rows in-memory is what
 * actually guarantees one fetch pair per distinct date, regardless of candidate count.
 * Unstamped products (no arbox_class_name) never contribute a date to fetch — gate #1. No
 * businessId/apiKey/boxId → nothing is resolvable, nothing gets filtered (safety rule).
 */
async function resolveOccurrenceStatesForCandidates(
  candidates: { dateYmd: string; time: string; arboxClassName: string }[],
  ctx: ArboxOfferContext
): Promise<Map<string, ArboxOccurrenceStateResult>> {
  const map = new Map<string, ArboxOccurrenceStateResult>();
  const businessId = ctx.businessId;
  const apiKey = String(ctx.arboxApiKey ?? "").trim();
  const boxId = String(ctx.arboxBoxId ?? "").trim();
  if (businessId == null || String(businessId).trim() === "" || !apiKey || !boxId) return map;

  const stamped = candidates.filter((c) => c.arboxClassName); // gate #1
  if (!stamped.length) return map;

  const dates = [...new Set(stamped.map((c) => c.dateYmd))];
  const fetcher = ctx.rawDataFetcherImpl ?? getOccurrenceRawData;
  const rawByDate = new Map<string, ArboxOccurrenceRaw>();
  await Promise.all(
    dates.map(async (date) => {
      const raw = await fetcher({ businessId, apiKey, boxId, date });
      rawByDate.set(date, raw);
    })
  );

  const seen = new Set<string>();
  for (const c of stamped) {
    const key = occurrenceStateKey(c.dateYmd, c.time, c.arboxClassName);
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = rawByDate.get(c.dateYmd) ?? { scheduleRows: null, summaryRows: null };
    map.set(key, resolveOccurrenceState(raw, c.dateYmd, c.time, c.arboxClassName));
  }
  return map;
}

/** "full"/"cancelled" are the only states a caller should ever omit on — "unknown" behaves as "open". */
function isSuppressedOccurrenceState(state: ArboxOccurrenceStateResult["state"] | undefined): boolean {
  return state === "full" || state === "cancelled";
}

function formatTimesPhrase(times: string[]): string {
  if (times.length === 1) return `ב-${times[0]}`;
  if (times.length === 2) return `ב-${times[0]} וב-${times[1]}`;
  return `ב-${times.slice(0, -1).join(", ")} ו-${times[times.length - 1]}`;
}

/** לפי שם שיעור: שם | יום+שעות יחד (לא לפצל שעה לפני השם ויום אחרי). */
export function formatNamedClassScheduleLine(serviceName: string, dayPhrase: string, times: string[]): string {
  return `${serviceName} | ${dayPhrase} ${formatTimesPhrase(times)}`;
}

/** אילו שיעורים ביום: יום+שעה יחד, ואז שם השיעור. */
export function formatDayClassScheduleLine(dayPhrase: string, time: string, serviceName: string): string {
  return `${dayPhrase} ב-${time}, ${serviceName}`;
}

function dayAskPhrase(input: { text: string; day: IsraelDayLetter; now: Date }): string {
  const today = getIsraelDayLetter(input.now);
  const tomorrow = addIsraelDayLetter(today, 1);
  const t = input.text;
  if (input.day === today && /(?:^|[^\p{L}])ו?(?:הערב|להערב|tonight)(?:[^\p{L}]|$)/iu.test(t)) {
    return "הערב";
  }
  if (input.day === today) return "היום";
  if (input.day === tomorrow) return `מחר (${DAY_NAME[input.day]})`;
  const named = HEBREW_DAY_OPTIONS.find((o) => o.value === input.day)?.label ?? DAY_NAME[input.day];
  return `ביום ${named}`;
}

function resolveServiceName(input: {
  currentText: string;
  previousUserText: string;
  services: SfServiceRow[];
}): string | null {
  const fromCurrent = matchCatalogServiceFromFreeText(input.currentText, input.services);
  if (fromCurrent) return fromCurrent;
  const fromPrev = matchCatalogServiceFromFreeText(input.previousUserText, input.services);
  if (fromPrev) return fromPrev;
  const combined = `${input.previousUserText} ${input.currentText}`.trim();
  return matchCatalogServiceFromFreeText(combined, input.services);
}

function looksLikeDayOrClassAsk(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (looksLikeClassTimeQuestion(t) || asksWhichClassesOnDay(t)) return true;
  if (parseRequestedClassDays(t).length === 0) return false;
  return /מתי|יש\s+(?:שיעור|אימון)|באיזו\s+שעה|באיזה\s+שעה|להגיע|להצטרף|לבוא|מועד|[?؟]/u.test(t);
}

function formatIsraelNowLine(now: Date): string {
  const letter = getIsraelDayLetter(now);
  const name = DAY_NAME[letter];
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const d = Number(get("day"));
  const m = Number(get("month"));
  const hh = get("hour");
  const mm = get("minute");
  return `עכשיו בישראל: יום ${name} ${d}.${m}, שעה ${hh}:${mm}. «היום»/«הערב» = ${name}. «מחר» = ${DAY_NAME[addIsraelDayLetter(letter, 1)]}.`;
}

function formatDaySlotLines(services: SfServiceRow[], day: IsraelDayLetter, now: Date): string {
  const lines: string[] = [];
  for (const s of services) {
    const slots = slotsForDay(s, day, now);
    if (!slots.length) continue;
    const times = [...new Set(slots.map((x) => x.time))];
    for (const time of times) {
      lines.push(`- ${time}, ${s.name}`);
    }
  }
  return lines.length ? lines.join("\n") : "- אין מועדים ליום הזה בלוח";
}

/** בלוק פרומפט: היום/מחר לפי שעון ישראל — גיבוי כשאין מענה דטרמיניסטי. */
export function buildIsraelNowSchedulePromptBlock(services: SfServiceRow[], now: Date = new Date()): string {
  if (!services.length) return "";
  const today = getIsraelDayLetter(now);
  const tomorrow = addIsraelDayLetter(today, 1);
  return `
${formatIsraelNowLine(now)}
מועדים להיום (${DAY_NAME[today]}) בלבד — אסור לערבב שעות מיום אחר:
${formatDaySlotLines(services, today, now)}
מועדים למחר (${DAY_NAME[tomorrow]}) בלבד:
${formatDaySlotLines(services, tomorrow, now)}
כששואלים על שיעור ספציפי היום/הערב/מחר — רק השורות של אותו אימון ביום ששאלו. אם אין שורה: אמרי שאין, בלי לקחת שעה מיום אחר.
ניסוח ללקוח — יום ושעה תמיד צמודים (לא «שעה + שם + יום»):
- לפי שם שיעור: «פילאטיס מכשירים | מחר (חמישי) ב-19:30». כמה מועדים: «שם | יום א ב-שעה | יום ב ב-שעה».
- אילו שיעורים ביום: «היום ב-18:30, פילאטיס מזרן». שורה לכל מועד.
- אסור: «שבע וחצי מכשירים מחר (חמישי)». אסור לדחוס משפט שני באותה שורת תבליט.`;
}

export function buildRelativeDayClassSlotsReply(input: {
  serviceName: string;
  day: IsraelDayLetter;
  sourceText: string;
  services: SfServiceRow[];
  now: Date;
}): string | null {
  const service = input.services.find((s) => s.name === input.serviceName);
  if (!service) return null;
  const slots = slotsForDay(service, input.day, input.now);
  const phrase = dayAskPhrase({ text: input.sourceText, day: input.day, now: input.now });
  if (!slots.length) {
    return `${phrase} אין ${input.serviceName}.`;
  }
  const times = [...new Set(slots.map((s) => s.time))];
  return `${formatNamedClassScheduleLine(input.serviceName, phrase, times)} 💜`;
}

/** כל האימונים שיש להם מועד ביום ששאלו — בלי להיתקע על אימון שנבחר קודם. */
export async function buildCatalogDaySlotsReply(
  input: {
    day: IsraelDayLetter;
    sourceText: string;
    services: SfServiceRow[];
    now: Date;
  } & ArboxOfferContext
): Promise<string | null> {
  const phrase = dayAskPhrase({ text: input.sourceText, day: input.day, now: input.now });

  type Item = { time: string; serviceName: string; arboxClassName: string; dateYmd: string };
  const items: Item[] = [];
  for (const s of input.services) {
    const slots = slotsForDay(s, input.day, input.now);
    if (!slots.length) continue;
    const times = [...new Set(slots.map((x) => x.time))];
    for (const time of times) {
      items.push({
        time,
        serviceName: s.name,
        arboxClassName: s.arboxClassName,
        dateYmd: resolveNextOccurrence(input.day, time, input.now).ymd,
      });
    }
  }
  if (!items.length) return null;

  const stateMap = await resolveOccurrenceStatesForCandidates(items, input);

  const lines: string[] = [];
  for (const item of items) {
    const state = stateMap.get(occurrenceStateKey(item.dateYmd, item.time, item.arboxClassName))?.state;
    if (isSuppressedOccurrenceState(state)) continue;
    lines.push(formatDayClassScheduleLine(phrase, item.time, item.serviceName));
  }
  if (!lines.length) return null;
  return `${lines.join("\n")} 💜`;
}

/**
 * שאלה על שיעור ספציפי היום/מחר/יום בשבוע — תשובה מהלוח, בלי Claude.
 * ההודעה הקודמת נספרת רק כשהנוכחית חסרה יום או שם אימון (למשל «כיסא» אחרי «הערב»).
 */
export async function tryBuildRelativeDayClassSlotsReply(
  input: {
    text: string;
    previousUserText?: string | null;
    services: SfServiceRow[];
    sessionPhase?: string | null;
    now?: Date;
  } & ArboxOfferContext
): Promise<{ text: string; modelUsed: string } | null> {
  const phase = String(input.sessionPhase ?? "").trim();
  if (phase === "schedule_date" || phase === "schedule_time") return null;

  const current = String(input.text ?? "").trim();
  if (!current || current.length > 500) return null;
  if (looksLikeHolidayClassScheduleAsk(current)) return null;
  const prev = String(input.previousUserText ?? "").trim();
  const now = input.now ?? new Date();
  const act = classifyInboundSpeechAct(current, now);
  if (act === "booking_mutation" || act === "illness_only") return null;

  const daysCurrent = parseRequestedClassDays(current, now);
  const daysPrev = prev ? parseRequestedClassDays(prev, now) : [];
  const days = daysCurrent.length ? daysCurrent : daysPrev;
  if (!days.length) return null;
  if (!shouldAnswerFromClassTimetable(current, now)) return null;

  if (isCatalogWideClassDayAsk(current, input.services, now)) {
    const parts: string[] = [];
    for (const day of daysCurrent.length ? daysCurrent : days) {
      const line = await buildCatalogDaySlotsReply({
        day: day as IsraelDayLetter,
        sourceText: current,
        services: input.services,
        now,
        businessId: input.businessId,
        arboxApiKey: input.arboxApiKey,
        arboxBoxId: input.arboxBoxId,
        rawDataFetcherImpl: input.rawDataFetcherImpl,
      });
      if (line) parts.push(line);
    }
    if (!parts.length) return null;
    return { text: parts.join("\n"), modelUsed: RELATIVE_DAY_CLASS_SLOTS_MODEL };
  }

  const serviceName = resolveServiceName({
    currentText: current,
    previousUserText: prev,
    services: input.services,
  });
  if (!serviceName) return null;

  const sourceText = daysCurrent.length ? current : `${prev} ${current}`.trim();
  const askOk = looksLikeDayOrClassAsk(current) || looksLikeDayOrClassAsk(prev);
  if (!askOk) return null;

  const service = input.services.find((s) => s.name === serviceName);
  if (!service) return null;

  // כמה ימים באותה הודעה («היום ומחר») — שם | יום+שעות | יום+שעות
  type DayGroup = { phrase: string; slots: { time: string; dateYmd: string }[] };
  const dayGroups: DayGroup[] = [];
  const missing: string[] = [];
  for (const day of days) {
    const slots = slotsForDay(service, day as IsraelDayLetter, now);
    const phrase = dayAskPhrase({ text: sourceText, day: day as IsraelDayLetter, now });
    if (!slots.length) {
      missing.push(`${phrase} אין ${serviceName}.`);
      continue;
    }
    const times = [...new Set(slots.map((s) => s.time))];
    dayGroups.push({
      phrase,
      slots: times.map((time) => ({ time, dateYmd: resolveNextOccurrence(day as IsraelDayLetter, time, now).ymd })),
    });
  }

  const candidates = dayGroups.flatMap((g) =>
    g.slots.map((s) => ({ dateYmd: s.dateYmd, time: s.time, arboxClassName: service.arboxClassName }))
  );
  const stateMap = await resolveOccurrenceStatesForCandidates(candidates, input);

  const foundBits: string[] = [];
  for (const g of dayGroups) {
    const openTimes = g.slots
      .filter((s) => {
        const state = stateMap.get(occurrenceStateKey(s.dateYmd, s.time, service.arboxClassName))?.state;
        return !isSuppressedOccurrenceState(state);
      })
      .map((s) => s.time);
    if (!openTimes.length) {
      // All of this day's times were full/cancelled. If it's the only day the lead asked
      // about, fall through to the existing "none today" message; otherwise the day-line
      // simply disappears from a multi-day reply rather than falsely saying "none".
      if (days.length === 1) missing.push(`${g.phrase} אין ${serviceName}.`);
      continue;
    }
    foundBits.push(`${g.phrase} ${formatTimesPhrase(openTimes)}`);
  }

  if (!foundBits.length && !missing.length) return null;
  const text = [
    foundBits.length ? `${serviceName} | ${foundBits.join(" | ")} 💜` : "",
    ...missing,
  ]
    .filter(Boolean)
    .join("\n");
  if (!text) return null;
  return { text, modelUsed: RELATIVE_DAY_CLASS_SLOTS_MODEL };
}

export function previousUserTextFromHistory(input: {
  currentText: string;
  userMessagesOldestFirst: string[];
}): string {
  const current = String(input.currentText ?? "").trim();
  const msgs = input.userMessagesOldestFirst.map((m) => String(m ?? "").trim()).filter(Boolean);
  if (!msgs.length) return "";
  const last = msgs[msgs.length - 1]!;
  if (last === current) return msgs.length >= 2 ? msgs[msgs.length - 2]! : "";
  return last;
}
