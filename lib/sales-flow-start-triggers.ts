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

/**
 * איפוס והפעלת פלואו מכירה — בקשת פרטים / «בואו נתחיל» (הקלדה או כפתור).
 * «היי» / «שלום» לבד לא מתחילים פלואו אצל זואי עסק.
 */
export const SALES_FLOW_START_TRIGGERS = new Set([
  SALES_FLOW_START_BUTTON_LABEL_HE,
  "בוא נתחיל",
  "אשמח לפרטים",
  "אשמח לשמוע פרטים",
  "אפשר פרטים",
  "אשמח למידע",
  // English button + details (normalized: apostrophes stripped → i'd → id)
  "lets start",
  "let us start",
  "id like details",
  "i would like details",
]);

/** ברכות קצרות שאפשר להסיר מתחילת המשפט אם אחריהן נשאר טריגר («היי אשמח לפרטים»). */
const LEADING_CASUAL_GREETING_PREFIXES = ["היי ", "הי ", "שלום ", "אהלן ", "hello ", "hi ", "hey "] as const;

function stripLeadingCasualGreeting(normalized: string): string {
  for (const prefix of LEADING_CASUAL_GREETING_PREFIXES) {
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length).trim();
  }
  return normalized;
}

export function isSalesFlowStartTrigger(text: string): boolean {
  const normalized = normalizeSalesFlowGreetingToken(text);
  if (SALES_FLOW_START_TRIGGERS.has(normalized)) return true;
  const withoutGreeting = stripLeadingCasualGreeting(normalized);
  return withoutGreeting !== normalized && SALES_FLOW_START_TRIGGERS.has(withoutGreeting);
}

/**
 * האם סמן ברכה ב־messages נחשב לפתיחת פלואו מכירה.
 * `greeting` = טריגר מפורש. `default_opening` היסטורי נספר רק אם ההודעה שלפניו הייתה טריגר («אשמח לפרטים» וכו׳).
 */
export function salesFlowGreetingMarkerCountsAsStarted(input: {
  modelUsed: string;
  precedingUserText: string | null;
}): boolean {
  const modelUsed = String(input.modelUsed ?? "").trim();
  if (modelUsed === "greeting") return true;
  if (modelUsed !== "default_opening") return false;
  return isSalesFlowStartTrigger(input.precedingUserText ?? "");
}
