/** טקסט ברירת מחדל לכפתורי quick-reply / פולואפ שמתניעים פלואו מכירה (עברית). */
export const SALES_FLOW_START_BUTTON_LABEL_HE = "בואו נתחיל";
export const SALES_FLOW_START_BUTTON_LABEL_EN = "Let's start!";

export function normalizeSalesFlowGreetingToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[!.,?;:~'"`\-]+/g, "")
    .replace(/\s+/g, " ");
}

/** איפוס והפעלת פלואו מכירה — הודעות קצרות (הקלדה או לחיצה על כפתור טמפלייט/quick-reply). */
export const SALES_FLOW_START_TRIGGERS = new Set([
  "שלום",
  "היי",
  "הי",
  "אהלן",
  "hello",
  "hi",
  SALES_FLOW_START_BUTTON_LABEL_HE,
  "בוא נתחיל",
  "נתחיל",
  "lets start",
  "let us start",
  "אשמח לשמוע פרטים",
  "היי אשמח לשמוע פרטים",
  "הי אשמח לשמוע פרטים",
  "אשמח לפרטים",
  "היי אשמח לפרטים",
  "הי אשמח לפרטים",
  // English (normalized: apostrophes stripped → i'd → id)
  "id like details",
  "i would like details",
  "id like more info",
  "tell me more",
  "more info",
  "more details",
  "info please",
  "details please",
  "more info please",
  "looking for info",
]);

export function isSalesFlowStartTrigger(text: string): boolean {
  return SALES_FLOW_START_TRIGGERS.has(normalizeSalesFlowGreetingToken(text));
}
