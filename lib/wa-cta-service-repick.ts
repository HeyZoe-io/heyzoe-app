import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { fetchLastAssistantModelUsed } from "@/lib/analytics";

/** גשר קבוע — חייב להופיע בדיוק כך (גם לזיהוי «כן» בהודעה הבאה). */
export const CTA_SERVICE_REPICK_BRIDGE_QUESTION =
  "תרצו שנבחר יחד אימון אחר מהרשימה?";

/** תפריט repick אחרי CTA בלבד — לא תפריט בחירת אימון רגיל אחרי חימום (`flow_continuation_opening_service_pick`). */
const SERVICE_REPICK_MENU_MODELS = new Set(["sales_flow_cta_repick_service_menu"]);

const NEGATIVE_REPLY =
  /^(לא\b|לא[,.!?\s]|אין\s|לא\s+תודה|לא\s+כרגע|לא\s+מעוניין|לא\s+רוצ)/iu;

const AFFIRMATIVE_REPLY =
  /^(כן\b|כן[,.!?\s]|בטח|יאללה|אשמח|בואו|בוא\b|אוקי|אוקיי|ok\b|yes\b|מעוניין|מעוניינת|רוצה\s+לשנות|רוצה\s+אימון\s+אחר)/iu;

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
