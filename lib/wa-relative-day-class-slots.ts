import {
  HEBREW_DAY_OPTIONS,
  filterConfiguredProductScheduleSlots,
  sortProductScheduleSlots,
} from "@/lib/product-schedule-slots";
import type { SfServiceRow } from "@/lib/sf-service-rows";
import { addIsraelDayLetter, getIsraelDayLetter, type IsraelDayLetter } from "@/lib/israel-time";
import {
  isCatalogWideClassDayAsk,
  looksLikeClassTimeQuestion,
  matchCatalogServiceFromFreeText,
  parseRequestedClassDays,
  asksWhichClassesOnDay,
} from "@/lib/wa-unknown-class-slot";
import { matchClassCancelPlaybook } from "@/lib/wa-closed-playbook-intents";

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

function slotsForDay(service: SfServiceRow, day: IsraelDayLetter): { day: string; time: string }[] {
  const rows = filterConfiguredProductScheduleSlots(service.scheduleSlots ?? []);
  return sortProductScheduleSlots(rows.filter((s) => String(s.day ?? "").trim() === day));
}

function formatTimesPhrase(times: string[]): string {
  if (times.length === 1) return `ב-${times[0]}`;
  if (times.length === 2) return `ב-${times[0]} וב-${times[1]}`;
  return `ב-${times.slice(0, -1).join(", ")} ו-${times[times.length - 1]}`;
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

function isScheduleAskFragment(text: string): boolean {
  return String(text ?? "").trim().length <= 28;
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

function formatDaySlotLines(services: SfServiceRow[], day: IsraelDayLetter): string {
  const lines: string[] = [];
  for (const s of services) {
    const slots = slotsForDay(s, day);
    if (!slots.length) continue;
    const times = [...new Set(slots.map((x) => x.time))];
    lines.push(`- ${s.name}: ${times.join(", ")}`);
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
${formatDaySlotLines(services, today)}
מועדים למחר (${DAY_NAME[tomorrow]}) בלבד:
${formatDaySlotLines(services, tomorrow)}
כששואלים על שיעור ספציפי היום/הערב/מחר — רק השורות של אותו אימון ביום ששאלו. אם אין שורה: אמרי שאין, בלי לקחת שעה מיום אחר.`;
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
  const slots = slotsForDay(service, input.day);
  const phrase = dayAskPhrase({ text: input.sourceText, day: input.day, now: input.now });
  if (!slots.length) {
    return `${phrase} אין ${input.serviceName}.`;
  }
  const times = [...new Set(slots.map((s) => s.time))];
  return `${phrase} יש ${input.serviceName} ${formatTimesPhrase(times)} 💜`;
}

/** כל האימונים שיש להם מועד ביום ששאלו — בלי להיתקע על אימון שנבחר קודם. */
export function buildCatalogDaySlotsReply(input: {
  day: IsraelDayLetter;
  sourceText: string;
  services: SfServiceRow[];
  now: Date;
}): string | null {
  const phrase = dayAskPhrase({ text: input.sourceText, day: input.day, now: input.now });
  const items: string[] = [];
  for (const s of input.services) {
    const slots = slotsForDay(s, input.day);
    if (!slots.length) continue;
    const times = [...new Set(slots.map((x) => x.time))];
    items.push(`${s.name} ${formatTimesPhrase(times)}`);
  }
  if (!items.length) return null;
  if (items.length === 1) return `${phrase} יש ${items[0]} 💜`;
  return `${phrase} יש:\n${items.map((x) => `- ${x}`).join("\n")} 💜`;
}

/**
 * שאלה על שיעור ספציפי היום/מחר/יום בשבוע — תשובה מהלוח, בלי Claude.
 * ההודעה הקודמת נספרת רק כשהנוכחית חסרה יום או שם אימון (למשל «כיסא» אחרי «הערב»).
 */
export function tryBuildRelativeDayClassSlotsReply(input: {
  text: string;
  previousUserText?: string | null;
  services: SfServiceRow[];
  sessionPhase?: string | null;
  now?: Date;
}): { text: string; modelUsed: string } | null {
  const phase = String(input.sessionPhase ?? "").trim();
  if (phase === "schedule_date" || phase === "schedule_time") return null;

  const current = String(input.text ?? "").trim();
  if (!current || current.length > 500) return null;
  if (matchClassCancelPlaybook(current)) return null;
  const prev = String(input.previousUserText ?? "").trim();
  const now = input.now ?? new Date();

  const daysCurrent = parseRequestedClassDays(current, now);
  const daysPrev = prev ? parseRequestedClassDays(prev, now) : [];
  const days = daysCurrent.length ? daysCurrent : daysPrev;
  if (!days.length) return null;

  if (isCatalogWideClassDayAsk(current, input.services, now)) {
    const parts: string[] = [];
    for (const day of daysCurrent.length ? daysCurrent : days) {
      const line = buildCatalogDaySlotsReply({
        day: day as IsraelDayLetter,
        sourceText: current,
        services: input.services,
        now,
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
  const askOk =
    looksLikeDayOrClassAsk(current) ||
    (isScheduleAskFragment(current) && looksLikeDayOrClassAsk(prev));
  if (!askOk) return null;

  // כמה ימים באותה הודעה («היום ומחר») — פסקה לכל יום
  const parts: string[] = [];
  for (const day of days) {
    const line = buildRelativeDayClassSlotsReply({
      serviceName,
      day: day as IsraelDayLetter,
      sourceText,
      services: input.services,
      now,
    });
    if (line) parts.push(line);
  }
  if (!parts.length) return null;
  return { text: parts.join("\n"), modelUsed: RELATIVE_DAY_CLASS_SLOTS_MODEL };
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
