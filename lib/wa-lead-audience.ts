import { resolveKnowledgeCatalogServices } from "@/lib/trial-service";

/** קהל יעד שהליד נעל בשיחה: מבוגרים / ילדים / נוער. */
export type LeadAgeBand = "adults" | "kids" | "youth";

type CatalogSource = {
  knowledgeCatalogServices?: { name?: string | null }[] | null;
  salesFlowServices?: { name?: string | null }[] | null;
};

const BAND_PATTERNS: { band: LeadAgeBand; re: RegExp }[] = [
  { band: "adults", re: /מבוגר(?:ים|ות)?|בוגרים/gu },
  { band: "kids", re: /ילדים|לילדים/gu },
  { band: "youth", re: /נוער|לנוער|נערים|נערות/gu },
];

const CLOCK_THEN_MINOR =
  /(?:[,:;]?\s*)?(?:בשעה\s*)?(?:ב[-–]?\s*)?\d{1,2}:\d{2}\s*ל(?:ילדים|נוער)(?:\s*\(\s*גילאי[^)]{0,24}\))?/gu;

const MINOR_AGE_PAREN = /\(\s*גילאי\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*\)/gu;

/** ההודעה האחרונה שמציינת קהל יעד מנצחת. הודעה בלי קהל לא מוחקת נעילה קודמת. */
export function inferLeadAgeBandFromUserTexts(texts: string[]): LeadAgeBand | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const band = inferLeadAgeBandInText(texts[i] ?? "");
    if (band) return band;
  }
  return null;
}

export function inferLeadAgeBandInText(text: string): LeadAgeBand | null {
  const raw = String(text ?? "");
  let best: { index: number; band: LeadAgeBand } | null = null;
  for (const { band, re } of BAND_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw))) {
      const index = match.index;
      if (!best || index >= best.index) best = { index, band };
    }
  }
  return best?.band ?? null;
}

/** «למבוגרים» / «בוגרים» — הבהרת קהל, לא שאלה חדשה. */
export function isLeadAgeBandRestatement(text: string): boolean {
  const t = String(text ?? "")
    .trim()
    .replace(/[!?.]+$/u, "")
    .trim();
  if (!t || t.length > 28) return false;
  return /^(?:אימונים\s+)?ל?(?:מבוגרים|מבוגרות|בוגרים|ילדים|נוער)$/u.test(t);
}

export function buildLeadAgeBandPromptRule(band: LeadAgeBand | null | undefined): string {
  if (band === "adults") {
    return "- הליד כבר אמר שהוא מחפש אימונים למבוגרים. אסור להזכיר קבוצות ילדים או נוער, גילאים שלהן, שעות או מחירים שלהן — גם בשאלה על אימון קבוצתי. אם אין בידע שעות לקבוצת מבוגרים, אל תמלאי משעות הילדים או הנוער ואל תכתבי שאין לך מידע. עני רק על המסלולים למבוגרים.";
  }
  if (band === "kids") {
    return "- הליד כבר אמר שהאימונים לילדים. אסור להזכיר קבוצות נוער או מבוגרים, או את השעות שלהן.";
  }
  if (band === "youth") {
    return "- הליד כבר אמר שהאימונים לנוער. אסור להזכיר קבוצות ילדים או מבוגרים, או את השעות שלהן.";
  }
  return "";
}

function catalogNames(source: CatalogSource | null | undefined): string[] {
  const rows = resolveKnowledgeCatalogServices({
    knowledgeCatalog: source?.knowledgeCatalogServices,
    salesFlow: source?.salesFlowServices,
  });
  const names: string[] = [];
  for (const row of rows) {
    const name = String(row?.name ?? "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function nameBand(name: string): LeadAgeBand | "general" {
  if (/ילדים/.test(name)) return "kids";
  if (/נוער/.test(name)) return "youth";
  if (/מבוגר|בוגרים/.test(name)) return "adults";
  return "general";
}

function joinHebrewList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ו${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ו${items[items.length - 1]}`;
}

/** רשימת מסלולים מהקטלוג שמתאימים לקהל שננעל. בלי שעות מומצאות. */
export function buildAgeBandCatalogReply(
  source: CatalogSource | null | undefined,
  band: LeadAgeBand
): string {
  const names = catalogNames(source).filter((name) => {
    const rowBand = nameBand(name);
    if (band === "adults") return rowBand === "adults" || rowBand === "general";
    return rowBand === band;
  });
  if (!names.length) return "";
  const list = joinHebrewList(names);
  if (band === "adults") return `למבוגרים יש אצלנו ${list}.`;
  if (band === "kids") return `לילדים יש אצלנו ${list}.`;
  return `לנוער יש אצלנו ${list}.`;
}

function sentenceCitesForbiddenBand(sentence: string, band: LeadAgeBand): boolean {
  const hasKids = /ילדים|נוער/.test(sentence);
  const hasAdults = /מבוגר|בוגרים/.test(sentence);
  if (band === "adults") return hasKids && !hasAdults;
  if (band === "kids") return /נוער|מבוגר|בוגרים/.test(sentence) && !/ילדים/.test(sentence);
  return /ילדים|מבוגר|בוגרים/.test(sentence) && !/נוער/.test(sentence);
}

function tidyAudienceReply(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .replace(/([.!?])\1+/g, "$1")
    .replace(/\s+:/g, ":")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** מוריד מהתשובה שעות ותיאור של קהל יעד אחר מזה שהליד נעל. */
export function stripOffAudienceGroupFacts(text: string, band: LeadAgeBand | null | undefined): string {
  if (!band) return String(text ?? "");
  let s = String(text ?? "");
  if (!s.trim()) return s;
  s = s.replace(CLOCK_THEN_MINOR, "");
  s = s.replace(MINOR_AGE_PAREN, (full, a: string, b: string) => {
    const max = Math.max(Number(a), Number(b));
    return Number.isFinite(max) && max <= 15 ? "" : full;
  });
  s = s.replace(/האימונים מתקיימים[^:.!?\n]{0,120}:\s*/gu, (clause) =>
    /\d{1,2}:\d{2}/.test(clause) ? clause : ""
  );
  const kept = s
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter((part) => part && !sentenceCitesForbiddenBand(part, band));
  return tidyAudienceReply(kept.join(" "));
}

export function applyLeadAgeBandToReply(
  text: string,
  band: LeadAgeBand | null | undefined,
  source: CatalogSource | null | undefined
): string {
  if (!band) return String(text ?? "");
  const stripped = stripOffAudienceGroupFacts(text, band);
  if (stripped.trim()) return stripped;
  return buildAgeBandCatalogReply(source, band) || String(text ?? "").trim();
}
