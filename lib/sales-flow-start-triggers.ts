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
 * «היי» / «שלום» לבד לא מתחילים פלואו אצל זואי עסק (ברכת זהות נפרדת),
 * חוץ מסאנגה שגם «היי» מתחיל פלואו.
 */
export const SALES_FLOW_START_TRIGGERS = new Set([
  SALES_FLOW_START_BUTTON_LABEL_HE,
  "בוא נתחיל",
  "אשמח לפרטים",
  "אשמח לשמוע פרטים",
  "אפשר פרטים",
  "אשמח למידע",
  "פרטים",
  "רוצה פרטים",
  "מהתחלה",
  "התחלה",
  "להתחיל מהתחלה",
  // English button + details (normalized: apostrophes stripped → i'd → id)
  "lets start",
  "let us start",
  "id like details",
  "i would like details",
]);

/** ברכות קצרות שאפשר להסיר מתחילת המשפט אם אחריהן נשאר טריגר («היי אשמח לפרטים»). */
const LEADING_CASUAL_GREETING_PREFIXES = ["היי ", "הי ", "שלום ", "אהלן ", "hello ", "hi ", "hey "] as const;

export function stripLeadingCasualGreeting(normalized: string): string {
  for (const prefix of LEADING_CASUAL_GREETING_PREFIXES) {
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length).trim();
  }
  return normalized;
}

export type SalesFlowStartTriggerOpts = {
  slug?: string;
  businessName?: string;
};

/**
 * סאנגה בלבד: גם «היי» מתחיל פלואו מכירה (בנוסף לטריגרי ברירת המחדל).
 * שאר העסקים: «היי» = ברכת זהות בלבד.
 */
export function businessStartsSalesFlowOnHi(opts?: SalesFlowStartTriggerOpts): boolean {
  const slug = String(opts?.slug ?? "").trim().toLowerCase();
  const name = String(opts?.businessName ?? "").trim().toLowerCase();
  if (slug === "info-2815") return true;
  if (slug.includes("sanga") || slug.includes("sangha")) return true;
  if (name.includes("סאנגה") || name.includes("sanga") || name.includes("sangha")) return true;
  return false;
}

export function isSalesFlowStartTrigger(text: string, opts?: SalesFlowStartTriggerOpts): boolean {
  const normalized = normalizeSalesFlowGreetingToken(text);
  if (SALES_FLOW_START_TRIGGERS.has(normalized)) return true;
  if (businessStartsSalesFlowOnHi(opts) && normalized === "היי") return true;
  const withoutGreeting = stripLeadingCasualGreeting(normalized);
  return withoutGreeting !== normalized && SALES_FLOW_START_TRIGGERS.has(withoutGreeting);
}

/** «היי» לבד — ברכת זהות, בלי פלואו מכירה. */
export function isCasualHiGreeting(text: string): boolean {
  return normalizeSalesFlowGreetingToken(text) === "היי";
}

export function buildCasualHiGreetingReply(botName: string, businessName: string): string {
  const bot = String(botName ?? "").trim() || "זואי";
  const biz = String(businessName ?? "").trim() || "העסק";
  return `היי! כאן ${bot}, הבוטית של ${biz} איך אפשר לעזור?`;
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
  if (
    modelUsed === "greeting" ||
    modelUsed === "registration_intent_no_member" ||
    modelUsed === "signup_intent_flow_entry" ||
    modelUsed === "closed_playbook_catalog_group"
  ) {
    return true;
  }
  if (modelUsed !== "default_opening") return false;
  return isSalesFlowStartTrigger(input.precedingUserText ?? "");
}
