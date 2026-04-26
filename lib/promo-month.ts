const HEBREW_MONTH_NAMES = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

const IL_TZ = "Asia/Jerusalem";

function calendarMonthIndexIsrael(at: Date = new Date()): number {
  const monthStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: IL_TZ,
    month: "numeric",
  }).format(at);
  const m = parseInt(monthStr, 10);
  if (m >= 1 && m <= 12) return m - 1;
  return at.getMonth();
}

/** שם חודש בעברית. לפי **לוח שנה בישראל** (Asia/Jerusalem) — ב־1 לכל חודש המבצע משתנה אוטומטית. */
export function hebrewMonthName(date: Date = new Date()): string {
  return HEBREW_MONTH_NAMES[calendarMonthIndexIsrael(date)] ?? "ינואר";
}

/** e.g. "מבצע חודש יוני!" */
export function promoMonthExclaim(date: Date = new Date()): string {
  return `מבצע חודש ${hebrewMonthName(date)}!`;
}

/** שורה לתצוגה ליד מחירים: כולל מע״מ + שם מבצע החודש */
export function promoVatAndMonthLine(date: Date = new Date()): string {
  return `כולל מע״מ · מבצע חודש ${hebrewMonthName(date)}!`;
}
