import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_WHATSAPP_MODEL, resolveClaudeApiKey } from "@/lib/claude";

const NOT_RELEVANT_EXACT = new Set([
  "לא רלוונטי",
  "לא מעוניין",
  "לא מעוניינת",
  "לא תודה",
  "ביי",
  "בביי",
]);

const NOT_RELEVANT_CONTAINS = ["לא רלוונטי", "לא מעוניין", "לא מעוניינת"];

export const NOT_RELEVANT_REPLY_MESSAGE =
  "הבנתי, תודה שעדכנת 🙏 אם תרצו בעתיד — אנחנו כאן. יום נעים!";

export function normalizeNotRelevantToken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[!.,?;:~'"`\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** זיהוי מילות מפתח מפורשות — לפני opt-out / אוטומציה. */
export function matchesNotRelevantKeyword(text: string): boolean {
  const t = normalizeNotRelevantToken(text);
  if (!t) return false;
  if (NOT_RELEVANT_EXACT.has(t)) return true;
  if (t === "לא תודה" || t.startsWith("לא תודה ")) return true;
  return NOT_RELEVANT_CONTAINS.some((phrase) => t === phrase || t.startsWith(`${phrase} `));
}

const REASON_CATEGORIES = [
  "מיקום",
  "מחיר",
  "זמן",
  "גיל",
  "סוג אימון",
  "מרחק",
  "אחר",
] as const;

/** חילוץ קטגוריה קצרה (מיקום / מחיר…) — רק כשיש הקשר מעבר למילת מפתח. */
export async function classifyNotRelevantReasonWithClaude(input: {
  apiKey: string;
  text: string;
}): Promise<string | null> {
  const apiKey = input.apiKey.trim();
  const text = input.text.trim();
  if (!apiKey || text.length < 4 || text.length > 400) return null;

  try {
    const anthropic = new Anthropic({ apiKey });
    const categories = REASON_CATEGORIES.join(", ");
    const resp = await anthropic.messages.create({
      model: CLAUDE_WHATSAPP_MODEL,
      max_tokens: 24,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `הלקוח כתב שהשירות לא רלוונטי / לא מעוניין. אם יש סיבה קצרה במשפט — החזר מילה אחת מהרשימה: ${categories}.
אם אין סיבה ברורה — החזר בדיוק: NONE
בלי טקסט נוסף.

משפט: "${text}"`,
        },
      ],
    });
    const out = (resp.content ?? [])
      .map((c) => ("text" in c ? String((c as { text?: string }).text ?? "") : ""))
      .join("\n")
      .trim();
    if (!out || out.toUpperCase() === "NONE") return null;
    const hit = REASON_CATEGORIES.find((c) => out.includes(c));
    return hit ?? out.slice(0, 32);
  } catch (e) {
    console.warn("[not-relevant] reason classify failed:", e);
    return null;
  }
}

export async function resolveNotRelevantReason(input: {
  text: string;
  keywordMatched: boolean;
}): Promise<string | null> {
  const text = input.text.trim();
  if (!text) return null;

  const tail = text
    .replace(/^(לא רלוונטי|לא מעוניין|לא מעוניינת|לא תודה)\s*/i, "")
    .trim();
  if (tail && tail.length <= 40 && tail !== text) {
    return tail.slice(0, 40);
  }

  if (!input.keywordMatched) return null;

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return null;
  return classifyNotRelevantReasonWithClaude({ apiKey, text });
}

export function buildNotRelevantContactPatch(reason: string | null, atIso: string): Record<string, unknown> {
  return {
    not_relevant_at: atIso,
    not_relevant_reason: String(reason ?? "").trim().slice(0, 120),
    wa_next_followup_at: null,
    wa_no_response_due_at: null,
    wa_followup_stage: 3,
    followup_sent: true,
  };
}

export function formatNotRelevantCrmNote(reason: string | null): string {
  const r = String(reason ?? "").trim();
  return r ? `זואי - לא רלוונטי - ${r}` : "זואי - לא רלוונטי";
}

export function formatNotRelevantOwnerReasonLine(reason: string | null): string {
  const r = String(reason ?? "").trim();
  return r ? `לא רלוונטי - ${r}` : "לא רלוונטי";
}

/** עדכון DB + הודעה לליד + CRM + התראה לבעלים */
export async function handleLeadNotRelevant(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  text: string;
  keywordMatched: boolean;
  nowIso: string;
  waFromNumber: string;
  accountSid: string;
  authToken: string;
  sessionId: string;
  fullName?: string | null;
}): Promise<void> {
  const reason = await resolveNotRelevantReason({
    text: input.text,
    keywordMatched: input.keywordMatched,
  });

  const patch = buildNotRelevantContactPatch(reason, input.nowIso);
  await input.supabase
    .from("contacts")
    .update(patch)
    .eq("business_id", input.businessId)
    .eq("phone", input.phone);

  const { sendWhatsAppMessage } = await import("@/lib/whatsapp");
  await sendWhatsAppMessage(
    input.waFromNumber,
    input.phone,
    NOT_RELEVANT_REPLY_MESSAGE,
    input.accountSid,
    input.authToken
  ).catch((e) => console.error("[not-relevant] reply send failed:", e));

  const { logMessage } = await import("@/lib/analytics");
  const reasonSuffix = reason ? ` — ${reason}` : "";
  await logMessage({
    business_slug: input.businessSlug,
    role: "event",
    content: `[heyzoe:not_relevant]${reasonSuffix}`,
    model_used: "not_relevant",
    session_id: input.sessionId,
  });

  const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
  void dispatchCrmEvent({
    businessId: input.businessId,
    leadPhone: input.phone,
    kind: "not_relevant",
    fullName: input.fullName,
    eventAtIso: input.nowIso,
    notRelevantReason: reason,
  });

  const { triggerLeadNotRelevantNotification } = await import("@/lib/notifications/triggers");
  void triggerLeadNotRelevantNotification({
    businessId: input.businessId,
    leadPhone: input.phone,
    reason,
    atIso: input.nowIso,
  });
}
