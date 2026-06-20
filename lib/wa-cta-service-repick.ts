import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { fetchLastAssistantModelUsed } from "@/lib/analytics";
import type { OfferKind } from "@/lib/sales-flow";

/** גשר קבוע — חייב להופיע בדיוק כך (גם לזיהוי «כן» בהודעה הבאה). */
export const CTA_SERVICE_REPICK_BRIDGE_QUESTION =
  "תרצו שנבחר יחד אימון אחר מהרשימה?";

/** לפני שליחה מחדש של תפריט בחירת אימון (טקסט חופשי — לא כפתור). */
export const SALES_FLOW_SERVICE_REPICK_ACK_MESSAGE =
  "אוקיי, אני מבינה שיש אימון אחר שמעניין אותך. אני שולחת לך שוב את הרשימה לבחור ממנה";

/** תפריט repick אחרי CTA בלבד — לא תפריט בחירת אימון רגיל אחרי חימום (`flow_continuation_opening_service_pick`). */
const SERVICE_REPICK_MENU_MODELS = new Set(["sales_flow_cta_repick_service_menu"]);

const NEGATIVE_REPLY =
  /^(לא\b|לא[,.!?\s]|אין\s|לא\s+תודה|לא\s+כרגע|לא\s+מעוניין|לא\s+רוצ)/iu;

const AFFIRMATIVE_REPLY =
  /^(כן\b|כן[,.!?\s]|בטח|יאללה|אשמח|בואו|בוא\b|אוקי|אוקיי|ok\b|yes\b|מעוניין|מעוניינת|רוצה\s+לשנות|רוצה\s+אימון\s+אחר)/iu;

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

function serviceNameMatchesInUserText(menuName: string, userText: string): boolean {
  const key = normalizeServiceNameKey(menuName);
  const t = normalizeInboundForServiceMatch(userText);
  if (!key || !t || key.length < 3) return false;
  if (t.includes(key)) return true;
  if (key.includes(t) && t.length >= 8) return true;
  const tokens = serviceTokens(key);
  if (tokens.length >= 2) {
    const hits = tokens.filter((w) => t.includes(w)).length;
    if (hits >= 2 && hits >= tokens.length - 1) return true;
  }
  if (tokens.length === 1 && tokens[0]!.length >= 6 && t.includes(tokens[0]!)) return true;
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

const WANTS_REGISTRATION_FOR_SERVICE_RE =
  /(?:רוצה|רוצים|מעוניין|מעוניינת|אשמח|מעדיף|מעדיפה).{0,35}(?:לה?רשם|הרשמה|לרשום|להרשם|להירשם|להרשמה)/iu;

export type FreeTextServiceSwitchCandidate = {
  name: string;
  offerKind?: OfferKind | string | null;
};

export type FreeTextServiceSwitchResolution =
  | { mode: "switch"; serviceName: string }
  | { mode: "ambiguous" };

const OFFER_KIND_INTEREST_RES: Array<{ kind: OfferKind; re: RegExp }> = [
  { kind: "course", re: /קורס/u },
  { kind: "workshop", re: /סדנ/u },
  { kind: "trial", re: /(?:שיעור\s+)?ניסיון|אימון\s+ניסיון/u },
];

function hasServiceSwitchIntent(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (WANTS_REGISTRATION_FOR_SERVICE_RE.test(t)) return true;
  if (isExplicitOtherServiceRequest(t)) return true;
  if (
    /(?:רוצה|רוצים|מעוניין|מעוניינת|אשמח|מעדיף|מעדיפה|לעשות|להצטרף|לקחת|עדיף)/u.test(t)
  ) {
    return true;
  }
  if (/(?:במקום|במקום\s+ה)/u.test(t)) return true;
  return false;
}

function isLikelySideQuestionWithoutSwitchIntent(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || hasServiceSwitchIntent(t)) return false;
  return /^(?:מה|איך|כמה|מתי|איפה|האם)\b/u.test(t);
}

function findOtherServicesMatchingPartialName(
  text: string,
  lastPickedServiceName: string,
  services: FreeTextServiceSwitchCandidate[]
): string[] {
  const lastKey = normalizeServiceNameKey(lastPickedServiceName);
  const t = normalizeInboundForServiceMatch(text);
  if (!t || !lastKey) return [];
  const hits: string[] = [];
  for (const service of services) {
    const name = String(service.name ?? "").trim();
    const key = normalizeServiceNameKey(name);
    if (!key || key === lastKey) continue;
    if (serviceNameMatchesInUserText(name, text)) {
      hits.push(name);
      continue;
    }
    for (const token of serviceTokens(key)) {
      if (token.length >= 4 && t.includes(token)) {
        hits.push(name);
        break;
      }
    }
  }
  return [...new Set(hits)];
}

function findOtherServicesMatchingOfferKindInterest(
  text: string,
  lastPickedServiceName: string,
  services: FreeTextServiceSwitchCandidate[]
): string[] {
  const lastKey = normalizeServiceNameKey(lastPickedServiceName);
  const t = normalizeInboundForServiceMatch(text);
  if (!t || !lastKey || !hasServiceSwitchIntent(text)) return [];
  const hits: string[] = [];
  for (const { kind, re } of OFFER_KIND_INTEREST_RES) {
    if (!re.test(t)) continue;
    for (const service of services) {
      const name = String(service.name ?? "").trim();
      const key = normalizeServiceNameKey(name);
      if (!key || key === lastKey) continue;
      if (String(service.offerKind ?? "trial").trim().toLowerCase() === kind) {
        hits.push(name);
      }
    }
  }
  return [...new Set(hits)];
}

/**
 * טקסט חופשי אחרי בחירת שירות — האם יש כוונה לשירות/מוצר אחר?
 * switch = יעד יחיד (מעדכנים sf_service בשקט); ambiguous = repick מתפריט.
 */
export function resolveImplicitServiceSwitchFromFreeText(input: {
  text: string;
  lastPickedServiceName: string | null;
  services: FreeTextServiceSwitchCandidate[];
}): FreeTextServiceSwitchResolution | null {
  const last = String(input.lastPickedServiceName ?? "").trim();
  if (!last || input.services.length < 2) return null;
  const t = String(input.text ?? "").trim();
  if (!t || t.length > 400 || isNumericServicePickReply(t)) return null;
  if (isCtaServiceFitQuestion(t)) return null;
  if (isLikelySideQuestionWithoutSwitchIntent(t)) return null;
  if (isExplicitOtherServiceRequest(t)) return { mode: "ambiguous" };

  const serviceNames = input.services.map((s) => String(s.name ?? "").trim()).filter(Boolean);
  if (textMentionsOtherServiceFromMenu(t, last, serviceNames)) {
    const partial = findOtherServicesMatchingPartialName(t, last, input.services);
    if (partial.length === 1) return { mode: "switch", serviceName: partial[0]! };
    return { mode: "ambiguous" };
  }

  const partialMatches = findOtherServicesMatchingPartialName(t, last, input.services);
  const kindMatches = findOtherServicesMatchingOfferKindInterest(t, last, input.services);
  const candidates = [...new Set([...partialMatches, ...kindMatches])];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { mode: "switch", serviceName: candidates[0]! };
  return { mode: "ambiguous" };
}

/** טקסט חופשי: מעוניין באימון אחר ממה שנבחר בכפתורים (לא שאלת התאמה לרמה בלבד). */
export function isFreeTextDifferentServiceInterest(
  text: string,
  lastPickedServiceName: string | null,
  serviceNames: string[],
  services?: FreeTextServiceSwitchCandidate[]
): boolean {
  const last = String(lastPickedServiceName ?? "").trim();
  if (!last) return false;
  const t = String(text ?? "").trim();
  if (!t || t.length > 400 || isNumericServicePickReply(t)) return false;
  if (isExplicitOtherServiceRequest(t)) return true;
  if (isCtaServiceFitQuestion(t)) return false;
  if (textMentionsOtherServiceFromMenu(t, last, serviceNames)) return true;
  if (
    WANTS_REGISTRATION_FOR_SERVICE_RE.test(t) &&
    textMentionsOtherServiceFromMenu(t, last, serviceNames)
  ) {
    return true;
  }
  if (/(?:אימון|שיעור)\s+אחר|משהו\s+אחר|במקום\s+(?:האימון|השיעור|זה)/iu.test(t)) {
    return true;
  }
  if (services && services.length > 1) {
    const implicit = resolveImplicitServiceSwitchFromFreeText({
      text: t,
      lastPickedServiceName: last,
      services,
    });
    if (implicit) return true;
  }
  return false;
}

/** בקשה מפורשת להחליף אימון — מפנה ישר לתפריט (בלי Claude + בלי גשר). */
export function isExplicitOtherServiceRequest(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 120) return false;
  if (isAffirmativeServiceRepickYes(t) || NEGATIVE_REPLY.test(t)) return false;
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
