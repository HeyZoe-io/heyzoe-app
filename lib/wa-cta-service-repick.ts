import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** גשר קבוע — חייב להופיע בדיוק כך (גם לזיהוי «כן» בהודעה הבאה). */
export const CTA_SERVICE_REPICK_BRIDGE_QUESTION =
  "תרצו שנבחר יחד אימון אחר מהרשימה?";

const NEGATIVE_REPLY =
  /^(לא\b|לא[,.!?\s]|אין\s|לא\s+תודה|לא\s+כרגע|לא\s+מעוניין|לא\s+רוצ)/iu;

const AFFIRMATIVE_REPLY =
  /^(כן\b|כן[,.!?\s]|בטח|יאללה|אשמח|בואו|בוא\b|אוקי|אוקיי|ok\b|yes\b|מעוניין|מעוניינת|רוצה\s+לשנות|רוצה\s+אימון\s+אחר)/iu;

/** שאלה פתוחה על התאמה לרמה / אימון אחר — שלב א (לפני גשר). */
export function isCtaServiceFitQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 400) return false;
  if (isAffirmativeServiceRepickYes(t) || NEGATIVE_REPLY.test(t)) return false;
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
  if (/אימון\s+אחר|שיעור\s+אחר|להחליף\s+אימון|לשנות\s+אימון/u.test(t)) return true;
  return false;
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
כללי אי-התאמה / שינוי אימון (רק בשאלה פתוחה על התאמה לרמה או אימון אחר):
- עני כנה על התאמה לפי הידע והשירות שנבחר בפועל למעלה
- אם נראה שאין התאמה או שהלקוח מחפש אימון אחר — סיימי במשפט זה בלבד (מילה במילה): «${CTA_SERVICE_REPICK_BRIDGE_QUESTION}»
- אל תשלחי רשימת אימונים בטקסט; אל תשני את השיבוץ עד שהלקוח מאשר`;
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
