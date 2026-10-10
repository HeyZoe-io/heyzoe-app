import { parseModelUsed } from "@/lib/wa-reply-route";

/** טקסט ברירת מחדל לכפתורי quick-reply / פולואפ שמתניעים פלואו מכירה (עברית). */
export const SALES_FLOW_START_BUTTON_LABEL_HE = "בואו נתחיל";
export const SALES_FLOW_START_BUTTON_LABEL_EN = "Let's start!";
export const SALES_FLOW_START_BUTTON_LABEL_RU = "Давайте начнём";

export function normalizeSalesFlowGreetingToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ")
    .replace(/[!.,?;:~'"`\-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * איפוס והפעלת פלואו מכירה — בקשת פרטים / «בואו נתחיל» (הקלדה או כפתור).
 * «היי» / «שלום» לבד לא מתחילים פלואו אצל זואי עסק (ברכת זהות נפרדת),
 * חוץ מסאנגה שגם «היי» מתחיל פלואו.
 */
export const SALES_FLOW_START_TRIGGERS = new Set([
  SALES_FLOW_START_BUTTON_LABEL_HE,
  "בוא נתחיל",
  // A7 lost_lead (and no_response) QUICK_REPLY — do not change this string
  // without adding the new copy here, or the tap will not start sales flow.
  // See lib/leads/REPORT_TRIGGER_PATTERN.md (A7).
  "אשמח לפרטים",
  "הצטרפות למנוי",
  "אשמח לשמוע",
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
  SALES_FLOW_START_BUTTON_LABEL_RU,
  "давайте начнём",
  "давайте начнем",
  "хочу подробности",
  "можно подробности",
  "начать",
]);

/** ברכות קצרות שאפשר להסיר מתחילת המשפט אם אחריהן נשאר טריגר («היי אשמח לפרטים»). */
const LEADING_CASUAL_GREETING_PREFIXES = [
  "היי ",
  "הי ",
  "שלום ",
  "אהלן ",
  "hello ",
  "hi ",
  "hey ",
  "привет ",
  "здравствуйте ",
] as const;

/** «היי» / «הי» / «הייי» לפני טריגר — כולל הארכת יו״ד. */
const LEADING_ELONGATED_HI_RE = /^הי+\s+/u;

export function stripLeadingCasualGreeting(normalized: string): string {
  const withoutElongatedHi = normalized.replace(LEADING_ELONGATED_HI_RE, "").trim();
  if (withoutElongatedHi !== normalized) return withoutElongatedHi;
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

/** פיפמן: כל הודעה מליד שעוד לא נכנס לפלואו פותחת את פלואו המכירה, לא רק «אשמח לפרטים». */
export function businessOpensSalesFlowOnAnyNewLeadMessage(slug?: string | null): boolean {
  return String(slug ?? "").trim().toLowerCase() === "pipman-team";
}

/**
 * Omers Place: משפט הפתיחה של מודעת אינסטגרם, בנוסף לטריגרים המשותפים.
 * אחרי נרמול (בלי סימני פיסוק): hello can i get more info on this
 */
const OMERS_PLACE_EXTRA_START_TRIGGERS = new Set(["hello can i get more info on this"]);

function matchesOmersPlaceExtraStartTrigger(
  normalized: string,
  opts?: SalesFlowStartTriggerOpts
): boolean {
  const slug = String(opts?.slug ?? "").trim().toLowerCase();
  if (slug !== "omers-place") return false;
  return OMERS_PLACE_EXTRA_START_TRIGGERS.has(normalized);
}

/** משפט המודעה של עומר פותח את הפלואו בעברית, בלי שהאנגלית תחליף את שפת הממשק. */
export function isOmersPlaceHebrewIcebreaker(text: string, slug?: string | null): boolean {
  return matchesOmersPlaceExtraStartTrigger(normalizeSalesFlowGreetingToken(text), {
    slug: slug ?? "",
  });
}

/**
 * SportyKef: משפט הפתיחה שמגיע מהקמפיין, בנוסף לטריגרים המשותפים.
 * אחרי נרמול (בלי סימני פיסוק): שלום אפשר לקבל מידע נוסף על זה
 */
const SPORTYKEF_EXTRA_START_TRIGGERS = new Set(["שלום אפשר לקבל מידע נוסף על זה"]);

function matchesSportykefExtraStartTrigger(
  normalized: string,
  opts?: SalesFlowStartTriggerOpts
): boolean {
  const slug = String(opts?.slug ?? "").trim().toLowerCase();
  if (slug !== "sportykef-1589") return false;
  return SPORTYKEF_EXTRA_START_TRIGGERS.has(normalized);
}

const NODE_CONVERSATION_SLUGS = new Set(["pipman-team", "acrobyjoe"]);

/** דף «שיחה» בתיבות במקום סקריפט המכירה. */
export function businessUsesNodeConversation(slug?: string | null): boolean {
  return NODE_CONVERSATION_SLUGS.has(String(slug ?? "").trim().toLowerCase());
}

/** פיפמן: פולואפים הם תיבות במסלול, לא דף הפולואפ הכללי. */
export function businessUsesConversationFollowupNodes(slug?: string | null): boolean {
  return String(slug ?? "").trim().toLowerCase() === "pipman-team";
}

/** בקשת פרטים שאפשר לזהות גם בסוף הודעה ארוכה, לא רק כשהיא כל ההודעה. */
const DETAILS_ASK_TAILS = [
  "אשמח לשמוע פרטים",
  "אשמח לשמוע",
  "אשמח לפרטים",
  "אפשר פרטים",
  "אשמח למידע",
  "רוצה פרטים",
  "id like details",
  "i would like details",
  "хочу подробности",
  "можно подробности",
] as const;

/** «על האימונים/השיעורים שלכם» אחרי בקשת פרטים — עדיין פתיחת פלואו, לא סקירת סטודיו. */
const CLASS_DETAILS_SUFFIX_RE =
  /\s+על\s+(?:ה)?(?:אימונים|שיעורים)(?:\s+(?:של(?:כם|כן|ך)|אצל(?:כם|כן)))?$/u;

function stripTrailingMessageDecor(normalized: string): string {
  return normalized
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D()[\]/\\|]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function endsWithDetailsAsk(text: string): boolean {
  return DETAILS_ASK_TAILS.some((trigger) => text === trigger || text.endsWith(` ${trigger}`));
}

/**
 * «… אשמח לשמוע פרטים על האימונים שלכם» בסוף הודעת היכרות.
 * בלי «על האימונים/השיעורים» נשאר ההתאמה המדויקת הקיימת.
 * «אשמח לשמוע על הסטודיו» / «רק רוצה פרטים» נשארים סקירת סטודיו.
 */
export function messageEndsWithClassDetailsAsk(raw: string): boolean {
  const t = stripTrailingMessageDecor(normalizeSalesFlowGreetingToken(raw));
  if (!t || t.length > 500) return false;
  const withoutClass = t.replace(CLASS_DETAILS_SUFFIX_RE, "").trim();
  if (withoutClass === t) return false;
  return endsWithDetailsAsk(withoutClass);
}

export function isSalesFlowStartTrigger(text: string, opts?: SalesFlowStartTriggerOpts): boolean {
  const normalized = normalizeSalesFlowGreetingToken(text);
  if (SALES_FLOW_START_TRIGGERS.has(normalized)) return true;
  if (matchesOmersPlaceExtraStartTrigger(normalized, opts)) return true;
  if (matchesSportykefExtraStartTrigger(normalized, opts)) return true;
  if (businessStartsSalesFlowOnHi(opts) && normalized === "היי") return true;
  const withoutGreeting = stripLeadingCasualGreeting(normalized);
  if (withoutGreeting !== normalized && SALES_FLOW_START_TRIGGERS.has(withoutGreeting)) return true;
  if (messageEndsWithClassDetailsAsk(text)) return true;
  return matchesSalesFlowRestartIntent(text);
}

/**
 * Whole message only. A details ask at the end of a longer sentence stays with Claude.
 * Restart phrases are already capped at 72 characters inside matchesSalesFlowRestartIntent.
 */
export function isWholeMessageSalesFlowStart(text: string, opts?: SalesFlowStartTriggerOpts): boolean {
  const normalized = normalizeSalesFlowGreetingToken(text);
  if (!normalized || normalized.length > 80) return false;
  if (SALES_FLOW_START_TRIGGERS.has(normalized)) return true;
  if (matchesOmersPlaceExtraStartTrigger(normalized, opts)) return true;
  if (matchesSportykefExtraStartTrigger(normalized, opts)) return true;
  if (businessStartsSalesFlowOnHi(opts) && normalized === "היי") return true;
  const withoutGreeting = stripLeadingCasualGreeting(normalized);
  if (
    withoutGreeting !== normalized &&
    withoutGreeting.length > 0 &&
    SALES_FLOW_START_TRIGGERS.has(withoutGreeting)
  ) {
    return true;
  }
  return matchesSalesFlowRestartIntent(text);
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
  "registration_cta_ask_class",
  "sales_flow_catalog_family_pick",
  "sales_flow_catalog_family_reask",
  "sales_flow_catalog_family_hold",
  "sales_flow_catalog_family_reask_hold",
  "opening_service_menu_reask",
  "opening_service_menu_hold",
  "opening_service_menu_reask_hold",
] as const;

export function isOpeningServicePickMenuModel(model: string | null | undefined): boolean {
  const m = parseModelUsed(model).model;
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
  const modelUsed = parseModelUsed(input.modelUsed).model;
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

const TRAININGS_PRESENTED_MODELS = new Set<string>([
  ...OPENING_SERVICE_PICK_MENU_MODELS,
  "sales_flow_cta",
  "sales_flow_cta_compact",
  "flow_continuation_cta",
]);

/** האימונים כבר הוצגו בסשן: תפריט מוצרים, או כפתורי המוצר היחיד. */
export function assistantModelsShowTrainingsPresented(models: readonly string[]): boolean {
  return models.some((model) => TRAININGS_PRESENTED_MODELS.has(parseModelUsed(model).model));
}

/**
 * האימונים הוצגו בפלואו הנוכחי. הרשימה מהחדש לישן.
 * wa_followup_3 לפני ההצגה סוגר את הפלואו הקודם, והתפריט הישן לא נספר.
 */
export function assistantModelsShowCurrentFlowTrainings(models: readonly string[]): boolean {
  for (const model of models) {
    const name = parseModelUsed(model).model;
    if (name === "wa_followup_3") return false;
    if (TRAININGS_PRESENTED_MODELS.has(name)) return true;
  }
  return false;
}

/**
 * תפריט «שנשריין» וכפתורי אחרי ההצגה — רק אחרי שהפלואו נפתח
 * והאימונים הוצגו בסשן. לא לפי session_phase לבד.
 */
export function mayHandleSalesFlowCtaMenu(input: {
  sessionPhase: string;
  salesFlowStarted: boolean;
  productsPresented: boolean;
}): boolean {
  if (input.sessionPhase === "warmup") return false;
  return input.salesFlowStarted === true && input.productsPresented === true;
}

/**
 * Known members do not start or reset a sales flow.
 * An in-progress flow is left to its current step. false and null stay on today's path.
 */
export type MemberSalesFlowStartGate = "allow" | "block_start" | "leave_in_progress";

export function memberSalesFlowStartGate(input: {
  arboxIsMember?: boolean | null;
  salesFlowInProgress: boolean;
}): MemberSalesFlowStartGate {
  if (input.arboxIsMember !== true) return "allow";
  if (input.salesFlowInProgress) return "leave_in_progress";
  return "block_start";
}

/**
 * Global opening phrases and a business's own extra phrases.
 * A known member never starts or resets. false and null stay on today's path.
 */
export function salesFlowOpeningMayStart(input: {
  text: string;
  arboxIsMember?: boolean | null;
  salesFlowInProgress: boolean;
  opts?: SalesFlowStartTriggerOpts;
  extraStart?: boolean;
}): boolean {
  const trigger =
    input.extraStart === true || isSalesFlowStartTrigger(input.text, input.opts);
  if (!trigger) return false;
  return (
    memberSalesFlowStartGate({
      arboxIsMember: input.arboxIsMember,
      salesFlowInProgress: input.salesFlowInProgress,
    }) === "allow"
  );
}
