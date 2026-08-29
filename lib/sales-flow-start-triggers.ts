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
 * הודעת ברירת מחדל של Click-to-WhatsApp («שלום! אפשר לקבל מידע נוסף על זה?») כן מתחילה פלואו.
 */
export const SALES_FLOW_START_TRIGGERS = new Set([
  SALES_FLOW_START_BUTTON_LABEL_HE,
  "בוא נתחיל",
  "אשמח לפרטים",
  "הצטרפות למנוי",
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

const RESTART_TAIL = String.raw`(?:מהה?תחלה|להתחלה|מחדש)`;
const RESTART_POLITE = String.raw`(?:אפשר(?:\s+בבקשה)?|בבקשה|רוצה|אשמח)`;
const RESTART_VERB = String.raw`(?:בוא(?:י|ו)?\s+)?(?:(?:ל)?התחיל|נתחיל|תתחיל(?:י|ו)?|נחזור|לחזור)`;
const RESTART_OBJECT = String.raw`(?:את\s+)?(?:ה)?(?:תפריט|שיחה|פלואו)`;

const SALES_FLOW_RESTART_PATTERNS: RegExp[] = [
  new RegExp(`^${RESTART_TAIL}$`, "u"),
  new RegExp(`^${RESTART_POLITE}\\s+${RESTART_TAIL}$`, "u"),
  new RegExp(`^${RESTART_POLITE}\\s+${RESTART_VERB}\\s+${RESTART_TAIL}$`, "u"),
  new RegExp(`^${RESTART_POLITE}\\s+${RESTART_VERB}\\s+${RESTART_OBJECT}\\s+${RESTART_TAIL}$`, "u"),
  new RegExp(`^${RESTART_POLITE}\\s+${RESTART_OBJECT}\\s+${RESTART_TAIL}$`, "u"),
  new RegExp(`^${RESTART_VERB}\\s+${RESTART_TAIL}$`, "u"),
  new RegExp(`^${RESTART_VERB}\\s+${RESTART_OBJECT}\\s+${RESTART_TAIL}$`, "u"),
];

/**
 * «אפשר מהתחלה?» / «להתחיל מחדש» / «היי אפשר להתחיל את התפריט מהתחלה»
 * — איפוס והתחלת פלואו מכירה מחדש. לא על משפט ארוך שרק מזכיר התחלה.
 */
export function matchesSalesFlowRestartIntent(raw: string): boolean {
  const normalized = normalizeSalesFlowGreetingToken(raw);
  const t = stripLeadingCasualGreeting(normalized);
  if (!t || t.length > 72) return false;
  return SALES_FLOW_RESTART_PATTERNS.some((re) => re.test(t));
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

/** יגאל ארביב (IKMA) בלבד — השוואת slug מדויקת, בלי התאמת שם. */
export const IKMA_YIGAL_ARBIV_BUSINESS_SLUG = "master-yigal-arbiv-ikma-israel";

/**
 * יגאל בלבד: פנייה חדשה (הודעת טקסט ראשונה לפני שהפלואו התחיל) נכנסת לפלואו מכירה
 * בלי «אשמח לפרטים» / «בואו נתחיל». לא מאפס פלואו שכבר רץ, לא משנה טריגרים גלובליים.
 */
export function businessStartsSalesFlowOnAnyNewInbound(opts?: SalesFlowStartTriggerOpts): boolean {
  return String(opts?.slug ?? "").trim().toLowerCase() === IKMA_YIGAL_ARBIV_BUSINESS_SLUG;
}

export function shouldAutoStartSalesFlowOnNewInbound(input: {
  salesFlowAlreadyStarted: boolean;
  isFreeTextInbound: boolean;
  hasSalesFlowConfig: boolean;
  inboundText?: string;
  opts?: SalesFlowStartTriggerOpts;
}): boolean {
  if (input.salesFlowAlreadyStarted) return false;
  if (!input.hasSalesFlowConfig) return false;
  if (!input.isFreeTextInbound) return false;
  if (!String(input.inboundText ?? "").trim()) return false;
  return businessStartsSalesFlowOnAnyNewInbound(input.opts);
}

/**
 * בקשת מידע כללית בסגנון מודעת Click-to-WhatsApp —
 * «שלום! אפשר לקבל מידע נוסף על זה?» / "Can I get more information about this?"
 * לא על שאלה ספציפית («מידע על ביטול», «אפשר לקבל החזר»).
 */
export function matchesSalesFlowMoreInfoIntent(raw: string): boolean {
  const normalized = normalizeSalesFlowGreetingToken(raw)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const t = stripLeadingCasualGreeting(normalized)
    .replace(/\s+(?:בבקשה|please)$/u, "")
    .trim();
  if (!t || t.length > 80) return false;

  const he = [
    /^(?:אפשר|אשמח|רוצה)\s+(?:לקבל\s+)?מידע(?:\s+נוסף)?(?:\s+(?:על|לגבי)\s+זה)?$/u,
    /^(?:אפשר|אשמח|רוצה)\s+(?:לקבל\s+)?(?:פרטים|מידע)\s+נוסף(?:ים)?(?:\s+(?:על|לגבי)\s+זה)?$/u,
    /^(?:אפשר|אשמח|רוצה)\s+לקבל\s+(?:פרטים|מידע)\s+(?:על|לגבי)\s+זה$/u,
    /^מידע\s+נוסף(?:\s+(?:על|לגבי)\s+זה)?$/u,
    /^פרטים\s+נוספים(?:\s+(?:על|לגבי)\s+זה)?$/u,
  ];
  if (he.some((re) => re.test(t))) return true;

  const en = [
    /^(?:can i (?:please )?get|can i have|id like|i would like|i want)\s+(?:some\s+)?(?:more\s+)?(?:info|information)(?:\s+about this)?$/u,
    /^more (?:info|information)(?: about this)?$/u,
  ];
  return en.some((re) => re.test(t));
}

export function isSalesFlowStartTrigger(text: string, opts?: SalesFlowStartTriggerOpts): boolean {
  const normalized = normalizeSalesFlowGreetingToken(text);
  if (SALES_FLOW_START_TRIGGERS.has(normalized)) return true;
  if (businessStartsSalesFlowOnHi(opts) && normalized === "היי") return true;
  const withoutGreeting = stripLeadingCasualGreeting(normalized);
  if (withoutGreeting !== normalized && SALES_FLOW_START_TRIGGERS.has(withoutGreeting)) return true;
  if (matchesSalesFlowRestartIntent(text)) return true;
  return matchesSalesFlowMoreInfoIntent(text);
}

/** «היי» לבד — ברכת זהות, בלי פלואו מכירה. */
export function isCasualHiGreeting(text: string): boolean {
  const normalized = normalizeSalesFlowGreetingToken(text);
  if (normalized === "היי") return true;
  return isCasualHowAreYouGreeting(text);
}

const HOW_ARE_YOU_CORES = new Set([
  "מה קורה",
  "מה נשמע",
  "מה המצב",
  "מה הולך",
  "מה העניינים",
]);

const SMALL_TALK_GREETING_PREFIXES = [
  "היוש ",
  "הייי ",
  "היי ",
  "הי ",
  "אהלן ",
  "שלום ",
  "שלומות ",
  "הלו ",
  "hello ",
  "hi ",
  "hey ",
  "בוקר טוב ",
  "ערב טוב ",
] as const;

function normalizeCasualSmallTalkToken(raw: string): string {
  return normalizeSalesFlowGreetingToken(raw)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSmallTalkGreetingPrefix(normalized: string): string {
  for (const prefix of SMALL_TALK_GREETING_PREFIXES) {
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length).trim();
  }
  return normalized;
}

/** «היי מה קורה» / «מה נשמע» / «מה המצב» — ברכת חולין, לא שאלה לא ברורה. */
export function isCasualHowAreYouGreeting(text: string): boolean {
  const normalized = normalizeCasualSmallTalkToken(text);
  if (!normalized || normalized.length > 40) return false;
  const core = stripSmallTalkGreetingPrefix(normalized).replace(
    /\s+(?:אצלך|אצלכם|אצלכן|איתך|איתכם)$/u,
    ""
  );
  return HOW_ARE_YOU_CORES.has(core);
}

export const CASUAL_HOW_ARE_YOU_REPLY_HE = "היי! מעולה, איך אפשר לעזור?";

export function buildCasualHiGreetingReply(
  botName: string,
  businessName: string,
  inboundText?: string
): string {
  if (inboundText && isCasualHowAreYouGreeting(inboundText)) {
    return CASUAL_HOW_ARE_YOU_REPLY_HE;
  }
  const bot = String(botName ?? "").trim() || "זואי";
  const biz = String(businessName ?? "").trim() || "העסק";
  return `היי! כאן ${bot}, הבוטית של ${biz} איך אפשר לעזור?`;
}

/**
 * תפריט בחירת מוצר בפתיחה — לחיצה עליו חייבת להיחשב לפלואו מכירה פעיל,
 * גם אם לא נרשם סמן `greeting` / `signup_intent_flow_entry` לפני השליחה.
 */
export const OPENING_SERVICE_PICK_MENU_MODELS = [
  "flow_continuation_opening_service_pick",
  "sales_flow_opening_service_pick_resend",
  "sales_flow_cs_redirect_service_pick",
] as const;

export function isOpeningServicePickMenuModel(model: string | null | undefined): boolean {
  const m = String(model ?? "").trim();
  return (OPENING_SERVICE_PICK_MENU_MODELS as readonly string[]).includes(m);
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
    modelUsed === "trial_topic_flow_entry" ||
    modelUsed === "closed_playbook_catalog_group"
  ) {
    return true;
  }
  if (isOpeningServicePickMenuModel(modelUsed)) return true;
  if (modelUsed !== "default_opening") return false;
  return isSalesFlowStartTrigger(input.precedingUserText ?? "");
}

/** פלואו התחיל מברכה, או שההודעה האחרונה של זואי היא תפריט בחירת מוצר. */
export function sessionCountsAsSalesFlowStarted(input: {
  greetingMarkerModel: string | null;
  precedingUserText: string | null;
  lastAssistantModel: string | null;
}): boolean {
  const marker = String(input.greetingMarkerModel ?? "").trim();
  if (
    marker &&
    salesFlowGreetingMarkerCountsAsStarted({
      modelUsed: marker,
      precedingUserText: input.precedingUserText,
    })
  ) {
    return true;
  }
  return isOpeningServicePickMenuModel(input.lastAssistantModel);
}
