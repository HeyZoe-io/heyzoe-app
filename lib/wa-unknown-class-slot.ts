import type { SfServiceRow } from "@/lib/sf-service-rows";
import type { WaSchedulePickSlot } from "@/lib/product-schedule-slots";
import { foldHebrewServiceToken } from "@/lib/hebrew-service-token";
import { addIsraelDayLetter, getIsraelWeekday, ISRAEL_DAY_LETTERS } from "@/lib/israel-time";

/** כשאין מועד בידע — לא ממציאים שעה; מעבירים לצוות. */
export const UNKNOWN_CLASS_SLOT_HANDOFF_REPLY = "אין בעיה אני מעבירה את הבקשה לצוות";

export const UNKNOWN_CLASS_SLOT_HANDOFF_MODEL = "unknown_class_slot_team_handoff";

const DAY_LETTER_SET = new Set(["א", "ב", "ג", "ד", "ה", "ו", "ש"]);

type DayLetter = "א" | "ב" | "ג" | "ד" | "ה" | "ו" | "ש";

const DAY_PATTERNS: { day: DayLetter; re: RegExp }[] = [
  { day: "ג", re: /(?:יום\s*)?שלישי/u },
  { day: "ד", re: /(?:יום\s*)?רביעי/u },
  { day: "א", re: /(?:יום\s*)?ראשון/u },
  { day: "ה", re: /(?:יום\s*)?חמישי/u },
  { day: "ו", re: /(?:יום\s*)?שישי/u },
  { day: "ש", re: /(?:^|[^\p{L}])(?:ב)?שבת(?:[^\p{L}]|$)|סופ["׳״']?ש|סופש/u },
  { day: "ב", re: /(?:יום\s*)?שני(?!שי)/u },
  { day: "א", re: /יום\s*א['׳]?(?!\p{L})/u },
  { day: "ב", re: /יום\s*ב['׳]?(?!\p{L})/u },
  { day: "ג", re: /יום\s*ג['׳]?(?!\p{L})/u },
  { day: "ד", re: /יום\s*ד['׳]?(?!\p{L})/u },
  { day: "ה", re: /יום\s*ה['׳]?(?!\p{L})/u },
  { day: "ו", re: /יום\s*ו['׳]?(?!\p{L})/u },
  { day: "ש", re: /יום\s*ש['׳]?(?!\p{L})/u },
];

function foldClassName(raw: string): string {
  let t = String(raw ?? "")
    .toLowerCase()
    .replace(/[׳״"'`]/g, "")
    .replace(/[&+]/g, " ")
    .replace(/[()]/g, " ");
  t = t.replace(/פוואר/gu, "power").replace(/פאוור/gu, "power");
  t = t.replace(/הייט/gu, "hiit").replace(/היט/gu, "hiit");
  t = t.replace(/כיסאות/gu, "כסא").replace(/כיסא/gu, "כסא");
  t = t.replace(/\bchairs?\b/gi, "כסא");
  t = t.replace(/\bאנד\b/gu, " ").replace(/\band\b/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

const RELATIVE_DAY_RES: { delta: 0 | 1 | 2; re: RegExp }[] = [
  { delta: 2, re: /(?:^|[^\p{L}])ו?מחרתיים(?:[^\p{L}]|$)/u },
  { delta: 1, re: /(?:^|[^\p{L}])ו?(?:מחר|למחר|tomorrow)(?:[^\p{L}]|$)/iu },
  {
    delta: 0,
    re: /(?:^|[^\p{L}])ו?(?:הערב|להערב|הלילה|הבוקר|הצהריים|היום|להיום|tonight|today)(?:[^\p{L}]|$)/iu,
  },
];

function relativeDayLettersFromText(text: string, now: Date): DayLetter[] {
  const today = ISRAEL_DAY_LETTERS[getIsraelWeekday(now)] as DayLetter;
  const found = new Set<DayLetter>();
  for (const { delta, re } of RELATIVE_DAY_RES) {
    if (!re.test(text)) continue;
    found.add(addIsraelDayLetter(today, delta) as DayLetter);
  }
  return [...found];
}

/** ימים שצוינו בטקסט: שלישי / הערב / מחר — לפי שעון ישראל. */
export function parseRequestedClassDays(text: string, now: Date = new Date()): DayLetter[] {
  const found = new Set<DayLetter>(relativeDayLettersFromText(text, now));
  for (const { day, re } of DAY_PATTERNS) {
    if (re.test(text)) found.add(day);
  }
  return [...found];
}

function parseRequestedTimes(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const hh = String(Number(m[1])).padStart(2, "0");
    const mm = m[2];
    out.push(`${hh}:${mm}`);
  }
  // «ב-9» / «ב9» / «ב 9» → 09:00 (שעה עגולה בלי דקות)
  const bareHour = /(?:^|[^\d\p{L}])(?:ב[-–—\s]?)([1-9]|1\d|2[0-3])(?:[^\d]|$)/gu;
  let hm: RegExpExecArray | null;
  while ((hm = bareHour.exec(text))) {
    out.push(`${String(Number(hm[1])).padStart(2, "0")}:00`);
  }
  return [...new Set(out)];
}

function normalizeSlotTime(raw: string): string {
  const t = String(raw ?? "").trim();
  const m = t.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return "";
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

function slotDay(slot: WaSchedulePickSlot): string {
  const d = String(slot.day ?? "").trim();
  return DAY_LETTER_SET.has(d) ? d : "";
}

function serviceHasDay(service: SfServiceRow, day: DayLetter): boolean {
  return (service.scheduleSlots ?? []).some((s) => slotDay(s) === day);
}

function serviceHasTime(service: SfServiceRow, time: string, day?: DayLetter): boolean {
  const want = normalizeSlotTime(time);
  if (!want) return false;
  return (service.scheduleSlots ?? []).some((s) => {
    if (day && slotDay(s) !== day) return false;
    return normalizeSlotTime(s.time) === want;
  });
}

function looksLikeNamedClass(text: string): boolean {
  const t = foldClassName(text);
  if (!t) return false;
  return /(?:^|[^\p{L}])(?:power|hiit|pilates|yoga|יוגה|פילאטיס|כוח|מוביליטי|mobility|פונקציונלי|אשטנגה|ויניאסה)(?:[^\p{L}]|$)/u.test(
    t
  );
}

function looksLikeClassTimeQuestion(text: string): boolean {
  return /להצטרף|להגיע|לבוא|נרשמ|מתי\s+(?:יש\s+)?(?:ה)?(?:שיעור|אימון)|יש\s+(?:שיעור|אימון)|עוד\s+אימון|רוצה.{0,40}(?:שיעור|אימון)|באיזו\s+שעה|באיזה\s+שעה|מועד/u.test(
    text
  );
}

export function matchCatalogServicesFromFreeText(
  text: string,
  services: Pick<SfServiceRow, "name">[]
): string[] {
  const foldedUser = foldClassName(text);
  if (!foldedUser || foldedUser.length < 3) return [];

  type Hit = { name: string; extra: number };
  const hits: Hit[] = [];
  for (const s of services) {
    const name = String(s.name ?? "").trim();
    if (!name) continue;
    const foldedName = foldClassName(name);
    if (!foldedName || foldedName.length < 3) continue;
    const nameInUser = foldedUser.includes(foldedName);
    const userInName = foldedName.includes(foldedUser) && foldedUser.length >= 8;
    const nameTokens = foldedName.split(" ").filter((w) => w.length >= 3);
    const userBlob = foldedUser
      .split(" ")
      .map((w) => foldHebrewServiceToken(w))
      .join(" ");
    const foldedNameTokens = nameTokens.map((w) => foldHebrewServiceToken(w)).filter((w) => w.length >= 3);
    const tokenHits = foldedNameTokens.filter((w) => userBlob.includes(w) || foldedUser.includes(w)).length;
    const userHasTokens =
      foldedNameTokens.length >= 2
        ? tokenHits >= Math.min(2, foldedNameTokens.length)
        : foldedNameTokens.length === 1 &&
          foldedNameTokens[0]!.length >= 5 &&
          (userBlob.includes(foldedNameTokens[0]!) || foldedUser.includes(foldedNameTokens[0]!));
    if (!nameInUser && !userInName && !userHasTokens) continue;
    const extra = foldedNameTokens.filter((w) => !userBlob.includes(w) && !foldedUser.includes(w)).length;
    hits.push({ name, extra });
  }
  if (!hits.length) {
    const distinctive = foldedUser
      .split(" ")
      .map((w) => foldHebrewServiceToken(w))
      .filter((w) => w.length >= 3);
    const uniqueHits: string[] = [];
    for (const tok of distinctive) {
      const names = services
        .map((s) => String(s.name ?? "").trim())
        .filter((name) => {
          if (!name) return false;
          const folded = foldClassName(name);
          const foldedToks = folded
            .split(" ")
            .map((w) => foldHebrewServiceToken(w))
            .join(" ");
          return folded.includes(tok) || foldedToks.includes(tok);
        });
      if (names.length === 1) uniqueHits.push(names[0]!);
    }
    return [...new Set(uniqueHits)];
  }
  hits.sort((a, b) => a.extra - b.extra || a.name.length - b.name.length);
  // התאמה ברורה: הכי פחות טוקנים חסרים — אחרת כמה בראש הרשימה = מעורפל
  const bestExtra = hits[0]!.extra;
  const top = hits.filter((h) => h.extra === bestExtra);
  return [...new Set(top.map((h) => h.name))];
}

/** התאמה חד־משמעית בלבד — כמה התאמות → null (לא בוחרים בשקט את הראשונה). */
export function matchCatalogServiceFromFreeText(
  text: string,
  services: Pick<SfServiceRow, "name">[]
): string | null {
  const matches = matchCatalogServicesFromFreeText(text, services);
  return matches.length === 1 ? matches[0]! : null;
}

export function assistantReplyIsUnknownClassSlotHandoff(text: string): boolean {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t === UNKNOWN_CLASS_SLOT_HANDOFF_REPLY || t.startsWith(UNKNOWN_CLASS_SLOT_HANDOFF_REPLY);
}

export function shouldHandoffUnknownClassSlot(input: {
  text: string;
  services: SfServiceRow[];
  committedServiceName?: string | null;
  sessionPhase?: string | null;
  now?: Date;
}): boolean {
  const phase = String(input.sessionPhase ?? "").trim();
  if (phase === "schedule_date" || phase === "schedule_time") return false;

  const text = String(input.text ?? "").trim();
  if (!text || text.length > 500) return false;

  const days = parseRequestedClassDays(text, input.now ?? new Date());
  const times = parseRequestedTimes(text);
  const matchedName = matchCatalogServiceFromFreeText(text, input.services);
  const committed = String(input.committedServiceName ?? "").trim();
  const serviceName = matchedName || committed;
  const service = serviceName
    ? input.services.find((s) => s.name === serviceName) ?? null
    : null;

  const timeQuestion = looksLikeClassTimeQuestion(text);

  if (service && days.length) {
    for (const day of days) {
      if (times.length) {
        if (!times.some((tm) => serviceHasTime(service, tm, day))) return true;
      } else if (!serviceHasDay(service, day)) {
        return true;
      }
    }
    return false;
  }

  if (service && times.length && !days.length) {
    return !times.some((tm) => serviceHasTime(service, tm));
  }

  if (service && !days.length && !times.length && timeQuestion) {
    return (service.scheduleSlots ?? []).length === 0;
  }

  if (!service && days.length && looksLikeNamedClass(text) && timeQuestion) {
    return true;
  }

  if (!service && days.length && timeQuestion && !looksLikeNamedClass(text)) {
    return !input.services.some((s) => days.some((d) => serviceHasDay(s, d)));
  }

  return false;
}
