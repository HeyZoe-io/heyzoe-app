import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { fetchLastAssistantModelUsed } from "@/lib/analytics";
import { userRequestedHumanAgent } from "@/lib/notifications/detect-human-request";
import type { OfferKind } from "@/lib/sales-flow";
import { foldHebrewServiceToken } from "@/lib/hebrew-service-token";

/** גשר קבוע — חייב להופיע בדיוק כך (גם לזיהוי «כן» בהודעה הבאה). */
export const CTA_SERVICE_REPICK_BRIDGE_QUESTION =
  "תרצו שנבחר יחד אימון אחר מהרשימה?";
export const SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE =
  "אני מבינה שמעניין אותך אימון אחר, אין בעיה";

/** שורת אישור + טקסט בחירת מוצר מהדשבורד — הודעה אחת. */
export function withServiceRepickAckPrefix(menuBody: string): string {
  const body = String(menuBody ?? "").trim();
  const ack = SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE;
  if (!body) return ack;
  if (body.startsWith(ack)) return body;
  return `${ack}\n${body}`;
}

/** תפריט repick אחרי CTA בלבד — לא תפריט בחירת אימון רגיל אחרי חימום (`flow_continuation_opening_service_pick`). */
const SERVICE_REPICK_MENU_MODELS = new Set(["sales_flow_cta_repick_service_menu"]);

const NEGATIVE_REPLY =
  /^(לא\b|לא[,.!?\s]|אין\s|לא\s+תודה|לא\s+כרגע|לא\s+מעוניין|לא\s+רוצ)/iu;

/** תשובות «כן» לגשר repick — gated ב-shouldHandleCtaServiceRepickYes (cta + שאלת bridge).
 * לא לכלול «רוצה אימון אחר» — זו בקשת החלפה מפורשת (isExplicitOtherServiceRequest), לא אישור גשר. */
const AFFIRMATIVE_REPLY =
  /^(כן\b|כן[,.!?\s]|בטח|יאללה|אשמח|בואו|בוא\b|אוקי|אוקיי|ok\b|yes\b|מעוניין|מעוניינת|רוצה\s+לשנות)/iu;

function normalizeServiceNameKey(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[׳״"']/g, "")
    .replace(/\s+/g, " ");
}

/** נרמול טקסט נכנס לזיהוי שם אימון (טעויות נפוצות). */
function normalizeInboundForServiceMatch(text: string): string {
  return normalizeServiceNameKey(text).replace(/הירשמ/gu, "הרשמ").replace(/נירשמ/gu, "נרשמ");
}

function serviceTokens(key: string): string[] {
  return key
    .split(/[\s\-–—]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

/** שמות קטגוריה כלליים — לא מזהים משפחת מוצר (פילאטיס / יוגה / אקרו). */
const PARTIAL_AMBIGUITY_SKIP_TOKENS = new Set([
  "שיעור",
  "אימון",
  "אימוני",
  "סדנה",
  "סדנת",
  "קורס",
  "מפגש",
  "מפגשים",
  "לאחר",
  "אפשר",
  "אפשרי",
  "ניתן",
]);

function splitCatalogTokens(key: string): string[] {
  return key
    .split(/[\s\-–—&,/+]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);
}

function inboundSignificantTokens(text: string): string[] {
  return splitCatalogTokens(normalizeInboundForServiceMatch(text))
    .map((w) => w.replace(/^[?!.,;:]+|[?!.,;:]+$/g, ""))
    .filter((w) => w.length >= 4 && !PARTIAL_AMBIGUITY_SKIP_TOKENS.has(w));
}

/** התאמת טוקן חלקי לשם קטלוג — בלי לשנות את serviceNameMatchesInUserText (חד-משמעי נשאר כפי שהוא). */
function sharesPartialCatalogToken(menuName: string, userText: string): boolean {
  if (serviceNameMatchesInUserText(menuName, userText)) return false;
  const key = normalizeServiceNameKey(menuName);
  const userToks = inboundSignificantTokens(userText);
  if (!key || !userToks.length) return false;
  const catToks = splitCatalogTokens(key);
  for (const ut of userToks) {
    if (key.includes(ut)) return true;
    for (const ct of catToks) {
      if (ct === ut) return true;
      if (ct.startsWith(ut) || ut.startsWith(ct)) return true;
    }
  }
  return false;
}

function serviceNameMatchesInUserText(menuName: string, userText: string): boolean {
  const key = normalizeServiceNameKey(menuName);
  const t = normalizeInboundForServiceMatch(userText);
  if (!key || !t || key.length < 3) return false;
  if (t.includes(key)) return true;
  if (key.includes(t) && t.length >= 8) return true;
  const tokens = serviceTokens(key);
  const userBlob = t
    .split(/[\s\-–—]+/)
    .map((w) => foldHebrewServiceToken(w))
    .join(" ");
  const foldedTokens = tokens.map((w) => foldHebrewServiceToken(w)).filter((w) => w.length >= 3);
  if (foldedTokens.length >= 2) {
    const hits = foldedTokens.filter((w) => userBlob.includes(w) || t.includes(w)).length;
    if (hits >= 2 && hits >= foldedTokens.length - 1) return true;
  }
  if (
    foldedTokens.length === 1 &&
    foldedTokens[0]!.length >= 6 &&
    (userBlob.includes(foldedTokens[0]!) || t.includes(foldedTokens[0]!))
  ) {
    return true;
  }
  return false;
}

/** הטקסט מזכיר שם אימון מהרשימה שאינו הבחירה האחרונה בכפתורים. */
export function textMentionsOtherServiceFromMenu(
  text: string,
  lastPickedServiceName: string,
  serviceNames: string[]
): boolean {
  const lastKey = normalizeServiceNameKey(lastPickedServiceName);
  if (!normalizeInboundForServiceMatch(text) || !lastKey) return false;
  for (const name of serviceNames) {
    const key = normalizeServiceNameKey(name);
    if (!key || key === lastKey) continue;
    if (serviceNameMatchesInUserText(name, text)) return true;
  }
  return false;
}

/** כוונת הרשמה — בלי «אשמח» (מילת נימוס, לא סימן למעבר). */
const WANTS_REGISTRATION_FOR_SERVICE_RE =
  /(?:רוצה|רוצים|מעוניין|מעוניינת|מעדיף|מעדיפה).{0,35}(?:לה?רשם|הרשמה|לרשום|להרשם|להירשם|להרשמה)/iu;

export type FreeTextServiceSwitchCandidate = {
  name: string;
  offerKind?: OfferKind | string | null;
};

export type FreeTextServiceSwitchResolution =
  | { mode: "switch"; serviceName: string }
  | { mode: "ambiguous" };

/** מילות שאלה — בלי \\b (ב-JS לא עובד טוב בעברית). */
const OPEN_QUESTION_LEAD_RE = /^(?:מה|איך|כמה|מתי|איפה|האם|למה|מי)(?:\s|[?!.,]|$)/u;

function hasExplicitServiceSwitchIntent(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (userRequestedHumanAgent(t)) return false;
  if (WANTS_REGISTRATION_FOR_SERVICE_RE.test(t)) return true;
  if (isExplicitOtherServiceRequest(t)) return true;
  if (
    /(?:רוצה|רוצים|מעוניין|מעוניינת|מעדיף|מעדיפה|לעשות|להצטרף|לקחת|עדיף)/u.test(t)
  ) {
    return true;
  }
  if (/(?:במקום|במקום\s+ה)/u.test(t)) return true;
  if (/(?:אימון|שיעור)\s+אחר|משהו\s+אחר|במקום\s+(?:האימון|השיעור|זה)/iu.test(t)) {
    return true;
  }
  return false;
}

/** רשת ביטחון — לא מנגנון ראשי לזיהוי מעבר. */
export function isSalesFlowOpenKnowledgeQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || hasExplicitServiceSwitchIntent(t) || isExplicitOtherServiceRequest(t)) return false;
  if (OPEN_QUESTION_LEAD_RE.test(t)) return true;
  if (/כמה\s+(?:מתאמנים|משתתפים|אנשים|מקומות|נשים|גברים|ילדים)/iu.test(t)) {
    return true;
  }
  if (isCatalogSpecificKnowledgeQuestion(t)) return true;
  return false;
}

function findUnambiguousOtherServiceByFullName(
  text: string,
  lastPickedServiceName: string,
  services: FreeTextServiceSwitchCandidate[]
): FreeTextServiceSwitchResolution | null {
  const lastKey = normalizeServiceNameKey(lastPickedServiceName);
  if (!lastKey) return null;
  const matches = services.filter((service) => {
    const name = String(service.name ?? "").trim();
    if (!name) return false;
    const key = normalizeServiceNameKey(name);
    if (!key || key === lastKey) return false;
    return serviceNameMatchesInUserText(name, text);
  });
  if (matches.length === 1) return { mode: "switch", serviceName: matches[0]!.name };
  if (matches.length > 1) return { mode: "ambiguous" };
  return null;
}

/**
 * מעבר שירות מפורש — phase-agnostic (כל שלב בפלואו).
 * repick menu; לא Claude.
 */
export function isPhaseAgnosticExplicitServiceSwitch(
  text: string,
  lastPickedServiceName: string | null,
  serviceNames: string[]
): boolean {
  const last = String(lastPickedServiceName ?? "").trim();
  const t = String(text ?? "").trim();
  if (!t || t.length > 400 || isNumericServicePickReply(t)) return false;
  if (isSalesFlowOpenKnowledgeQuestion(t)) return false;
  if (isCtaServiceFitQuestion(t)) return false;
  if (isExplicitOtherServiceRequest(t)) return true;
  if (!last) return false;
  if (/(?:במקום|במקום\s+ה)/u.test(t) && textMentionsOtherServiceFromMenu(t, last, serviceNames)) {
    return true;
  }
  if (hasExplicitServiceSwitchIntent(t) && textMentionsOtherServiceFromMenu(t, last, serviceNames)) {
    return true;
  }
  if (
    WANTS_REGISTRATION_FOR_SERVICE_RE.test(t) &&
    textMentionsOtherServiceFromMenu(t, last, serviceNames)
  ) {
    return true;
  }
  return false;
}

/**
 * שמות קטלוג שחולקים טוקן חלקי עם הטקסט (2+), בלי התאמה חד-משמעית לפי serviceNameMatchesInUserText.
 */
export function findAmbiguousPartialCatalogMatches(text: string, serviceNames: string[]): string[] {
  const names = [...new Set(serviceNames.map((n) => String(n ?? "").trim()).filter(Boolean))];
  const uniqueHits = names.filter((n) => serviceNameMatchesInUserText(n, text));
  if (uniqueHits.length === 1) return [];
  const partials = names.filter((n) => sharesPartialCatalogToken(n, text));
  return partials.length >= 2 ? partials : [];
}

/** «מה זה פילאטיס» — ידע, לא בחירת מוצר. */
function isDefinitionalCatalogQuestion(text: string): boolean {
  return /^(?:מה\s+זה|מהו|מה\s+הוא|איך\s+עובד)/u.test(String(text ?? "").trim());
}

/** «עמידות ידיים זה שיעור קבוצתי??» — פורמט השיעור, לא בקשה להחליף מוצר. */
function isClassFormatKnowledgeQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (/(?:זה|האם(?:\s+זה)?)\s+(?:שיעור|אימון)?\s*(?:קבוצתי|אישי|פרטי|זוגי)/u.test(t)) {
    return true;
  }
  if (/(?:קבוצתי|אישי|פרטי)\s+או\s+(?:קבוצתי|אישי|פרטי)/u.test(t)) return true;
  if (/(?:זה|האם)\s+(?:אחד\s+על\s+אחד|1\s*על\s*1|1\s*[-/]\s*1)/u.test(t)) return true;
  if (/\bis\s+(?:this|it).{0,40}\b(?:a\s+)?group\s+class\b/i.test(t)) return true;
  return false;
}

const CATALOG_KNOWLEDGE_SUITABILITY_RE =
  /מתאים|מתאימה|מתאימים|מיועד|מיועדת|מומלץ|מותר|אסור|בטוח(?:ה)?/u;
const CATALOG_KNOWLEDGE_AUDIENCE_RE =
  /הריון|היריון|בהריון|בהיריון|נשים|גברים|ילדים|גיל|פציע|ניתוח|שיקום|אוסטאו|לחץ\s+דם|(?:^|[\s,])גב(?:\s|$|[?!.,])/u;

/**
 * שאלה ספציפית על המוצר (התאמה / הריון / מה זה / קבוצתי) — לא התעניינות להחליף אימון.
 * דוגמה: «האם פילאטיס מתאים לנשים בהיריון?» / «העמידות ידיים זה שיעור קבוצתי??»
 */
export function isCatalogSpecificKnowledgeQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (isDefinitionalCatalogQuestion(t)) return true;
  if (isClassFormatKnowledgeQuestion(t)) return true;
  if (/מה\s+ההבדל|למי\s+(?:זה\s+)?(?:מתאים|מיועד)|איך\s+(?:זה\s+)?עובד/u.test(t)) return true;
  if (CATALOG_KNOWLEDGE_SUITABILITY_RE.test(t) && CATALOG_KNOWLEDGE_AUDIENCE_RE.test(t)) return true;
  if (/(?:הריון|היריון|בהריון|בהיריון)/u.test(t) && /(?:אפשר|ניתן|מותר|אסור|מתאים)/u.test(t)) {
    return true;
  }
  if (
    /(מתאים|מתאימה|מתאימים|מיועד|מיועדת).*(מתחיל|מתקדמ|רמה|רמת|beginner|advanced)/iu.test(t)
  ) {
    return true;
  }
  if (/(מתחיל|מתקדמ|רמת\s+כושר|רמות).*(מתאים|מתאימ)/iu.test(t)) return true;
  return false;
}

function mentionsOtherCatalogService(
  text: string,
  lastPickedServiceName: string,
  serviceNames: string[]
): boolean {
  const lastKey = normalizeServiceNameKey(lastPickedServiceName);
  if (!lastKey) return false;
  if (textMentionsOtherServiceFromMenu(text, lastPickedServiceName, serviceNames)) return true;
  if (findAmbiguousPartialCatalogMatches(text, serviceNames).length >= 2) return true;
  const others = serviceNames
    .map((n) => String(n ?? "").trim())
    .filter((n) => n && normalizeServiceNameKey(n) !== lastKey);
  const partialOthers = others.filter((n) => sharesPartialCatalogToken(n, text));
  return partialOthers.length === 1;
}

/**
 * באמצע פלואו: אזכור אימון אחר (משפחה או שם מלא) → תפריט בחירת מוצר.
 * בלי דרישה לפועל («רוצה» / «יש» / «אפשר»). שאלת ידע ספציפית לא נחשבת.
 */
export function isAmbiguousPartialCatalogServiceSwitch(
  text: string,
  lastPickedServiceName: string | null,
  serviceNames: string[]
): boolean {
  const t = String(text ?? "").trim();
  const last = String(lastPickedServiceName ?? "").trim();
  if (!t || !last || t.length > 400 || isNumericServicePickReply(t)) return false;
  if (isCatalogSpecificKnowledgeQuestion(t)) return false;
  if (isPhaseAgnosticExplicitServiceSwitch(t, last, serviceNames)) return false;
  // Exact single catalog name is a direct switch, not an ambiguous family token (פילאטיס).
  if (exactTypedCatalogServiceName(t, serviceNames)) return false;
  return mentionsOtherCatalogService(t, last, serviceNames);
}

/**
 * Typed (not a button) free text that is exactly a catalog service name
 * after trim/whitespace-normalization. Longer sentences still need a verb
 * via isPhaseAgnosticExplicitServiceSwitch. Webhook commits this name
 * (does not open the repick menu) so CTA pricing follows the named service.
 */
export function exactTypedCatalogServiceName(
  text: string,
  serviceNames: string[]
): string | null {
  const t = normalizeServiceNameKey(text);
  if (!t || t.length > 120) return null;
  const hits = serviceNames
    .map((name) => String(name ?? "").trim())
    .filter((name) => name && normalizeServiceNameKey(name) === t);
  const unique = [...new Set(hits)];
  if (unique.length !== 1) return null;
  return unique[0]!;
}

/**
 * Exact closed catalog name to commit via implicit switch.
 * Same product as last pick → null (already on it). Different product, or no last pick → that name.
 */
export function exactTypedCatalogSwitchTarget(
  text: string,
  lastPickedServiceName: string | null,
  serviceNames: string[]
): string | null {
  const exact = exactTypedCatalogServiceName(text, serviceNames);
  if (!exact) return null;
  const lastKey = normalizeServiceNameKey(lastPickedServiceName ?? "");
  if (lastKey && lastKey === normalizeServiceNameKey(exact)) return null;
  return exact;
}

/**
 * מעבר שקט/מחדש — רק כשממתינים לבחירת שירות מהתפריט.
 * רק התאמת שם מלא/חד-משמעי; בלי טוקן חלקי / offer-kind.
 */
export function resolveImplicitServiceSwitchFromFreeText(input: {
  text: string;
  lastPickedServiceName: string | null;
  services: FreeTextServiceSwitchCandidate[];
  awaitingServicePick: boolean;
}): FreeTextServiceSwitchResolution | null {
  if (!input.awaitingServicePick) return null;
  const last = String(input.lastPickedServiceName ?? "").trim();
  if (!last || input.services.length < 2) return null;
  const t = String(input.text ?? "").trim();
  if (!t || t.length > 400 || isNumericServicePickReply(t)) return null;
  if (isCtaServiceFitQuestion(t)) return null;
  if (isSalesFlowOpenKnowledgeQuestion(t)) return null;
  if (isPhaseAgnosticExplicitServiceSwitch(t, last, input.services.map((s) => s.name))) {
    return null;
  }
  return findUnambiguousOtherServiceByFullName(t, last, input.services);
}

/** בקשה מפורשת להחליף אימון — מפנה ישר לתפריט (בלי Claude + בלי גשר). */
export function isExplicitOtherServiceRequest(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 120) return false;
  if (NEGATIVE_REPLY.test(t)) return false;
  // בדיקת דפוס לפני affirmative — «רוצה אימון אחר» הוא החלפה, לא «כן» לגשר.
  return (
    /(?:אפשר|אפשרי|רוצה|רוצים|לעבור|להחליף).{0,40}(?:אימון|שיעור)\s+אחר/u.test(t) ||
    /^(?:אימון|שיעור)\s+אחר/u.test(t) ||
    /^אפשר\s+אימון\s+אחר/u.test(t)
  );
}

/** תשובה מספרית לבחירה מתפריט שירותים (1–12). */
export function isNumericServicePickReply(text: string): boolean {
  const t = String(text ?? "").trim();
  return /^[1-9]$|^1[0-2]$/.test(t);
}

/** שאלה פתוחה על התאמה לרמה (לא בקשה מפורשת להחליף אימון). */
export function isCtaServiceFitQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 400) return false;
  if (
    isExplicitOtherServiceRequest(t) ||
    isAffirmativeServiceRepickYes(t) ||
    NEGATIVE_REPLY.test(t)
  ) {
    return false;
  }
  if (
    /(מתאים|מתאימה|מתאימים|מיועד|מיועדת).*(מתחיל|מתקדמ|רמה|רמת|beginner|advanced)/iu.test(
      t
    )
  ) {
    return true;
  }
  if (
    /(מתחיל|מתקדמ|רמת\s+כושר|רמות).*(מתאים|מתאימ)/iu.test(t) ||
    /זה\s+שיעור\s+(ש)?(מתאים|מיועד)/iu.test(t)
  ) {
    return true;
  }
  if (/(לא\s+)?(מתאים|מתאימ).*(לי|לנו|בשבילי)/iu.test(t)) return true;
  if (/להחליף\s+אימון|לשנות\s+אימון/u.test(t)) return true;
  return false;
}

export function assistantAwaitingServiceRepickPickFromSnapshot(
  content: string,
  modelUsed?: string | null
): boolean {
  const model = String(modelUsed ?? "").trim();
  if (model && SERVICE_REPICK_MENU_MODELS.has(model)) return true;
  const c = String(content ?? "");
  if (replyContainsServiceRepickBridge(c)) return true;
  if (c.includes("[כפתורים:")) return true;
  if (/כתבו\s+רק\s+את\s+המספר/u.test(c)) return true;
  if (/איזה אימון.*קורץ|מהרשימה/u.test(c)) return true;
  return false;
}

export async function assistantAwaitingServiceRepickPick(input: {
  business_slug: string;
  session_id: string;
}): Promise<boolean> {
  const [content, modelUsed] = await Promise.all([
    fetchLastAssistantMessageContent(input),
    fetchLastAssistantModelUsed(input),
  ]);
  return assistantAwaitingServiceRepickPickFromSnapshot(content, modelUsed);
}

export function replyContainsServiceRepickBridge(text: string): boolean {
  return String(text ?? "").includes(CTA_SERVICE_REPICK_BRIDGE_QUESTION);
}

export function isAffirmativeServiceRepickYes(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 80) return false;
  if (NEGATIVE_REPLY.test(t)) return false;
  if (userRequestedHumanAgent(t)) return false;
  return AFFIRMATIVE_REPLY.test(t);
}

export function ensureCtaServiceRepickBridge(text: string): string {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return CTA_SERVICE_REPICK_BRIDGE_QUESTION;
  if (replyContainsServiceRepickBridge(raw)) return raw;
  return `${raw}\n\n${CTA_SERVICE_REPICK_BRIDGE_QUESTION}`;
}

export function buildCtaServiceRepickPromptAddon(): string {
  return `
כללי אי-התאמה / שינוי אימון (רק בשאלה פתוחה על התאמה לרמה):
- עני כנה על התאמה לפי הידע והשירות שנבחר בפועל למעלה
- אם נראה שאין התאמה — סיימי במשפט זה בלבד (מילה במילה): «${CTA_SERVICE_REPICK_BRIDGE_QUESTION}»
- אם הלקוח מבקש במפורש אימון אחר — אל תפרטי רשימה בטקסט; המערכת תשלח תפריט כפתורים
- אל תשני את השיבוץ עד שהלקוח מאשר או בוחר מחדש מהתפריט`;
}

export async function fetchLastAssistantMessageContent(input: {
  business_slug: string;
  session_id: string;
}): Promise<string> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("messages")
      .select("content")
      .eq("business_slug", input.business_slug)
      .eq("session_id", input.session_id)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || data == null) return "";
    return String(data.content ?? "").trim();
  } catch {
    return "";
  }
}

export async function shouldHandleCtaServiceRepickYes(input: {
  phase: string;
  multiService: boolean;
  lastPickedServiceName: string | null;
  scheduleDate: string;
  scheduleTime: string;
  inboundText: string;
  business_slug: string;
  session_id: string;
}): Promise<boolean> {
  if (input.phase !== "cta") return false;
  if (!input.multiService) return false;
  if (!input.lastPickedServiceName?.trim()) return false;
  if (!input.scheduleDate.trim() && !input.scheduleTime.trim()) return false;
  if (!isAffirmativeServiceRepickYes(input.inboundText)) return false;
  const lastAssistant = await fetchLastAssistantMessageContent({
    business_slug: input.business_slug,
    session_id: input.session_id,
  });
  return replyContainsServiceRepickBridge(lastAssistant);
}
