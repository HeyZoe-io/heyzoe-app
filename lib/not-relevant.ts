import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_WHATSAPP_MODEL, resolveClaudeApiKey } from "@/lib/claude";
import { buildWaSessionId, contactPhoneLookupVariants } from "@/lib/phone-normalize";

const NOT_RELEVANT_EXACT = new Set([
  "לא רלוונטי",
  "לא מעוניין",
  "לא מעוניינת",
  "לא תודה",
  "ביי",
  "בביי",
]);

const NOT_RELEVANT_CONTAINS = ["לא רלוונטי", "לא מעוניין", "לא מעוניינת"];

/** סיבה מזוהה בוודאות — כרגע רק מיקום/מרחק */
export const NOT_RELEVANT_REASON_LOCATION = "מיקום" as const;

const LOCATION_HINTS = [
  "רחוק לי",
  "רחוק ממני",
  "רחוק מ",
  "רחוק מדי",
  "לא קרוב",
  "לא באזור",
  "לא באיזור",
  "מיקום",
  "מרחק",
  "רחוק",
  "רחוקה",
  "רחוקים",
  "לא מתאים מבחינת מיקום",
  "רחוק מהבית",
  "רחוק מהעבודה",
];

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

function matchesLocationHint(text: string): boolean {
  const t = normalizeNotRelevantToken(text);
  if (!t) return false;
  return LOCATION_HINTS.some((hint) => t.includes(hint));
}

/** Claude — רק כשיש רמז למיקום/מרחק; אחרת null (לא מנחשים סיבות אחרות). */
async function classifyLocationReasonWithClaude(input: {
  apiKey: string;
  text: string;
}): Promise<string | null> {
  const apiKey = input.apiKey.trim();
  const text = input.text.trim();
  if (!apiKey || text.length < 4 || text.length > 400) return null;

  try {
    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: CLAUDE_WHATSAPP_MODEL,
      max_tokens: 12,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `האם המשפט מביע שהשירות לא רלוונטי בגלל מיקום / מרחק / ריחוק גיאוגרפי?
ענה רק "מיקום" אם כן, או "NONE" אם לא ברור / סיבה אחרת / אין סיבה.
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
    return out.includes(NOT_RELEVANT_REASON_LOCATION) ? NOT_RELEVANT_REASON_LOCATION : null;
  } catch (e) {
    console.warn("[not-relevant] location classify failed:", e);
    return null;
  }
}

/** מחזיר "מיקום" רק בזיהוי ודאי; אחרת null → «לא רלוונטי» בלבד */
export async function resolveNotRelevantReason(input: {
  text: string;
}): Promise<string | null> {
  const text = input.text.trim();
  if (!text) return null;

  if (matchesLocationHint(text)) return NOT_RELEVANT_REASON_LOCATION;

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return null;
  return classifyLocationReasonWithClaude({ apiKey, text });
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

/** איפוס סימון «לא רלוונטי» — מחזיר את הליד לפעיל ומאפשר חידוש פולואפים. */
export function buildLeadReactivationPatch(): Record<string, unknown> {
  return {
    not_relevant_at: null,
    not_relevant_reason: "",
    wa_followup_stage: 0,
    wa_followup_1_sent_at: null,
    wa_followup_2_sent_at: null,
    wa_followup_3_sent_at: null,
    followup_sent: false,
  };
}

/**
 * הפעלה מחדש של ליד שסומן «לא רלוונטי» אחרי שהתחיל פלואו מחדש
 * («אשמח לפרטים» / כוונת פתיחת פלואו). מנקה את הסטטוס בלבד —
 * אתחול פלואו המכירה עצמו נעשה ב-flow הרגיל בהמשך.
 */
export async function reactivateNotRelevantLead(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  sessionId: string;
}): Promise<boolean> {
  const businessId = Number(input.businessId);
  const phone = String(input.phone ?? "").trim();
  if (!businessId || !phone) return false;

  const { error } = await input.supabase
    .from("contacts")
    .update(buildLeadReactivationPatch())
    .eq("business_id", businessId)
    .eq("phone", phone);

  if (error) {
    console.error("[not-relevant] reactivation update failed:", error.message);
    return false;
  }

  const { logMessage } = await import("@/lib/analytics");
  await logMessage({
    business_slug: input.businessSlug,
    role: "event",
    content: "[heyzoe:lead_reactivated]",
    model_used: "lead_reactivated",
    session_id: input.sessionId,
  }).catch((e) => console.error("[not-relevant] reactivation log failed:", e));

  return true;
}

/** סימון ידני מדשבורד — עוצר פולואפים, ללא הודעה לליד */
export async function markContactNotRelevantManually(input: {
  admin: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  reason?: string | null;
  fullName?: string | null;
}): Promise<{ ok: true; not_relevant_at: string } | { ok: false; error: string }> {
  const businessId = Number(input.businessId);
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  if (!businessId || !phoneVariants.length) {
    return { ok: false, error: "invalid_phone" };
  }

  const nowIso = new Date().toISOString();
  const reason = String(input.reason ?? "").trim().slice(0, 120) || null;
  const patch = buildNotRelevantContactPatch(reason, nowIso);

  const { data: updated, error } = await input.admin
    .from("contacts")
    .update(patch)
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .select("id");

  if (error) {
    console.error("[not-relevant] manual mark failed:", error.message);
    return { ok: false, error: "update_failed" };
  }
  if (!updated?.length) {
    return { ok: false, error: "contact_not_found" };
  }

  const slug = String(input.businessSlug ?? "").trim().toLowerCase();
  const { data: channel } = await input.admin
    .from("whatsapp_channels")
    .select("phone_number_id")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  const phoneNumberId = String((channel as { phone_number_id?: string } | null)?.phone_number_id ?? "").trim();
  const sessionId = phoneNumberId ? buildWaSessionId(phoneNumberId, input.phone) : null;

  const { logMessage } = await import("@/lib/analytics");
  const reasonSuffix = reason ? ` — ${reason}` : "";
  await logMessage({
    business_slug: slug,
    role: "event",
    content: `[heyzoe:not_relevant:manual]${reasonSuffix}`,
    model_used: "not_relevant_manual",
    session_id: sessionId,
  });

  const { dispatchCrmEvent } = await import("@/lib/crm/dispatch");
  void dispatchCrmEvent({
    businessId,
    leadPhone: input.phone,
    kind: "not_relevant",
    fullName: input.fullName,
    eventAtIso: nowIso,
    notRelevantReason: reason,
  });

  return { ok: true, not_relevant_at: nowIso };
}

/** עדכון DB + הודעה לליד + CRM */
export async function handleLeadNotRelevant(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  text: string;
  nowIso: string;
  waFromNumber: string;
  accountSid: string;
  authToken: string;
  sessionId: string;
  fullName?: string | null;
}): Promise<void> {
  const reason = await resolveNotRelevantReason({ text: input.text });

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
}
