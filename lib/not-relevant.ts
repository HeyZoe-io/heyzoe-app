import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_WHATSAPP_MODEL,
  CLAUDE_WHATSAPP_MAX_TOKENS,
  formatUserFacingClaudeError,
  isRetryableClaudeError,
  resolveClaudeApiKey,
  sleepMs,
} from "@/lib/claude";
import { SALES_FLOW_START_BUTTON_LABEL_HE } from "@/lib/sales-flow-start-triggers";
import { buildWaSessionId, contactPhoneLookupVariants } from "@/lib/phone-normalize";

/** כפתור והודעת המשך אחרי שאלה פתוחה מליד «לא רלוונטי». */
export const NOT_RELEVANT_FLOW_RESTART_BUTTON = SALES_FLOW_START_BUTTON_LABEL_HE;
export const NOT_RELEVANT_FLOW_RESTART_CTA_BODY =
  "להתחלת שיחה, קבלת פרטים ושריון אימון ניסיון לחצו על הכפתור";

const NOT_RELEVANT_SHORT_DISMISSALS = new Set([
  "תודה",
  "תודה רבה",
  "תודה!",
  "אוקיי",
  "אוקי",
  "ok",
  "okay",
  "בסדר",
  "יופי",
  "מעולה",
  "הבנתי",
  "סבבה",
  "נשמע טוב",
]);

const OPEN_QUESTION_HINTS = [
  "מה ",
  "איך ",
  "כמה ",
  "מתי ",
  "איפה ",
  "למה ",
  "האם ",
  "מי ",
  "what ",
  "how ",
  "when ",
  "where ",
  "why ",
  "can i ",
  "do you ",
  "is there ",
];

function hasObviousOpenQuestionShape(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  if (raw.includes("?")) return true;
  const t = normalizeNotRelevantToken(raw);
  return OPEN_QUESTION_HINTS.some((hint) => t.includes(hint.trim()));
}

async function classifyNotRelevantOpenQuestionWithClaude(input: {
  apiKey: string;
  text: string;
}): Promise<boolean> {
  const apiKey = input.apiKey.trim();
  const text = input.text.trim();
  if (!apiKey || text.length < 4 || text.length > 500) return false;

  try {
    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: CLAUDE_WHATSAPP_MODEL,
      max_tokens: 8,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `האם המשפט הוא שאלה או בקשה למידע שסוכנת מכירות לסטודיו יכולה לענות עליה — ולא רק תודה, אישור קצר, או ברכה?
ענה רק "YES" או "NO" (בדיוק, בלי טקסט נוסף).

משפט: "${text}"`,
        },
      ],
    });
    const out = ( resp.content ?? [])
      .map((c) => ("text" in c ? String((c as { text?: string }).text ?? "") : ""))
      .join("\n")
      .trim()
      .toUpperCase();
    if (out.startsWith("NO")) return false;
    return out.startsWith("YES");
  } catch (e) {
    console.warn("[not-relevant] open-question classify failed (continuing):", e);
    return false;
  }
}

/** האם לענות על שאלה פתוחה (במקום הודעת חסימה) לליד «לא רלוונטי». */
export async function shouldAnswerNotRelevantLeadOpenQuestion(input: {
  apiKey: string;
  text: string;
}): Promise<boolean> {
  const text = input.text.trim();
  if (!text || text.length < 4 || text.length > 500) return false;
  if (matchesNotRelevantKeyword(text)) return false;

  const normalized = normalizeNotRelevantToken(text);
  if (NOT_RELEVANT_SHORT_DISMISSALS.has(normalized)) return false;

  if (hasObviousOpenQuestionShape(text)) return true;

  const apiKey = input.apiKey.trim();
  if (!apiKey) return false;
  return classifyNotRelevantOpenQuestionWithClaude({ apiKey, text });
}

/** תשובת AI + הודעת CTA נפרדת עם כפתור «אשמח לפרטים» — הליד נשאר «לא רלוונטי» עד לחיצה. */
export async function answerNotRelevantLeadOpenQuestion(input: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  businessId: number;
  businessSlug: string;
  phone: string;
  text: string;
  sessionId: string;
  waFromNumber: string;
  accountSid: string;
  authToken: string;
  claudeApiKey: string;
}): Promise<void> {
  const businessSlug = String(input.businessSlug ?? "").trim();
  const userText = input.text.trim();
  if (!businessSlug || !userText) return;

  const { logMessage, fetchRecentSessionMessages } = await import("@/lib/analytics");
  await logMessage({
    business_slug: businessSlug,
    role: "user",
    content: userText,
    session_id: input.sessionId,
  }).catch((e) => console.error("[not-relevant] user log failed:", e));

  const { getBusinessKnowledgePack, buildSystemPrompt } = await import("@/lib/business-context");
  const { loadZoePlatformGuidelines } = await import("@/lib/business-zoe-platform");
  const { applyKnownAssistantReplyFixes } = await import("@/lib/wa-assistant-reply-fixes");
  const { stripTrailingFollowUpQuestion } = await import("@/lib/wa-split-answer");
  const { sendWhatsAppMessage, sendWhatsAppTextOrMenu } = await import("@/lib/whatsapp");

  const [knowledge, platformGuidelines] = await Promise.all([
    getBusinessKnowledgePack(businessSlug),
    loadZoePlatformGuidelines(),
  ]);

  const systemPrompt = buildSystemPrompt(
    knowledge,
    businessSlug,
    "whatsapp",
    {
      sessionPhase: "opening",
      trialRegistered: false,
      suppressFollowUpQuestion: true,
    },
    platformGuidelines,
    userText
  );

  const history = await fetchRecentSessionMessages({
    business_slug: businessSlug,
    session_id: input.sessionId,
    limit: 10,
  });
  const claudeMessages =
    history.length > 0
      ? history.map((m) => ({ role: m.role, content: m.content }))
      : [];
  const lastHistoryMessage = claudeMessages[claudeMessages.length - 1];
  if (
    userText &&
    (!lastHistoryMessage ||
      lastHistoryMessage.role !== "user" ||
      String(lastHistoryMessage.content ?? "").trim() !== userText)
  ) {
    claudeMessages.push({ role: "user" as const, content: userText });
  }

  let replyCore = "";
  let replyModelUsed = CLAUDE_WHATSAPP_MODEL;
  let replyErrorCode: string | null = null;
  let isFallbackErrorReply = false;

  const apiKey = input.claudeApiKey.trim();
  if (!apiKey) {
    replyCore = formatUserFacingClaudeError(new Error("Missing ANTHROPIC_API_KEY"));
    isFallbackErrorReply = true;
    replyErrorCode = "missing_api_key";
  } else {
    const client = new Anthropic({ apiKey });
    try {
      const runClaude = async () =>
        client.messages.create({
          model: CLAUDE_WHATSAPP_MODEL,
          max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
          system: systemPrompt,
          messages: claudeMessages,
        });

      let response: Awaited<ReturnType<typeof runClaude>> | null = null;
      try {
        response = await runClaude();
      } catch (e) {
        if (isRetryableClaudeError(e)) {
          await sleepMs(900);
          response = await runClaude();
        } else {
          throw e;
        }
      }

      const extractCombinedText = (resObj: unknown) => {
        const content = (resObj as { content?: unknown[] })?.content;
        const textBlocks = Array.isArray(content)
          ? content
              .filter(
                (b) =>
                  b &&
                  typeof b === "object" &&
                  (b as { type?: string }).type === "text" &&
                  typeof (b as { text?: string }).text === "string"
              )
              .map((b) => String((b as { text?: string }).text ?? "").trim())
              .filter(Boolean)
          : [];
        return textBlocks.join("\n").trim();
      };

      replyCore = extractCombinedText(response);
      if (!replyCore) {
        await sleepMs(700);
        const retryResp = await runClaude();
        replyCore = extractCombinedText(retryResp);
      }
      if (!replyCore) throw new Error("Claude empty response");
    } catch (e) {
      console.error("[not-relevant] open-question Claude failed:", e);
      replyCore = formatUserFacingClaudeError(e);
      isFallbackErrorReply = true;
      replyErrorCode = "claude_failed";
    }
  }

  const answerOnly = isFallbackErrorReply
    ? replyCore
    : stripTrailingFollowUpQuestion(
        applyKnownAssistantReplyFixes(replyCore, {
          knowledge,
          phase: "opening",
          multiServiceAwaitingPick: false,
        })
      );

  try {
    await sendWhatsAppMessage(
      input.waFromNumber,
      input.phone,
      answerOnly,
      input.accountSid,
      input.authToken
    );
  } catch (e) {
    console.error("[not-relevant] open-question answer send failed:", e);
    return;
  }

  await logMessage({
    business_slug: businessSlug,
    role: "assistant",
    content: answerOnly,
    model_used: replyModelUsed,
    session_id: input.sessionId,
    error_code: replyErrorCode,
  }).catch((e) => console.error("[not-relevant] answer log failed:", e));

  if (isFallbackErrorReply) return;

  await sleepMs(650);

  try {
    await sendWhatsAppTextOrMenu(
      input.waFromNumber,
      input.phone,
      NOT_RELEVANT_FLOW_RESTART_CTA_BODY,
      [NOT_RELEVANT_FLOW_RESTART_BUTTON],
      input.accountSid,
      input.authToken
    );
  } catch (e) {
    console.error("[not-relevant] flow-restart CTA send failed:", e);
    return;
  }

  await logMessage({
    business_slug: businessSlug,
    role: "assistant",
    content: `${NOT_RELEVANT_FLOW_RESTART_CTA_BODY}\n[כפתורים: ${NOT_RELEVANT_FLOW_RESTART_BUTTON}]`,
    model_used: "not_relevant_flow_restart_cta",
    session_id: input.sessionId,
  }).catch((e) => console.error("[not-relevant] CTA log failed:", e));
}

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
  /** מזהה contact מה-upsert — עדיף על phone (פורמט 972… לעומת +972…). */
  contactId?: string | number | null;
}): Promise<boolean> {
  const businessId = Number(input.businessId);
  const phone = String(input.phone ?? "").trim();
  const contactId = input.contactId;
  if (!businessId || (!phone && (contactId === undefined || contactId === null))) return false;

  const patch = buildLeadReactivationPatch();
  let updated: { id?: unknown }[] | null = null;
  let error: { message?: string } | null = null;

  if (contactId !== undefined && contactId !== null) {
    const result = await input.supabase
      .from("contacts")
      .update(patch)
      .eq("id", contactId)
      .eq("business_id", businessId)
      .select("id");
    updated = result.data;
    error = result.error;
  } else {
    const phoneVariants = contactPhoneLookupVariants(phone);
    if (!phoneVariants.length) return false;
    const result = await input.supabase
      .from("contacts")
      .update(patch)
      .eq("business_id", businessId)
      .in("phone", phoneVariants)
      .select("id");
    updated = result.data;
    error = result.error;
  }

  if (error) {
    console.error("[not-relevant] reactivation update failed:", error.message);
    return false;
  }
  if (!updated?.length) {
    console.warn("[not-relevant] reactivation matched 0 rows", {
      businessId,
      contactId: contactId ?? null,
      phone,
    });
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
  const phoneVariants = contactPhoneLookupVariants(input.phone);
  if (!phoneVariants.length) {
    console.warn("[not-relevant] mark skipped — invalid phone", { phone: input.phone });
    return;
  }
  const { data: marked, error: markErr } = await input.supabase
    .from("contacts")
    .update(patch)
    .eq("business_id", input.businessId)
    .in("phone", phoneVariants)
    .select("id");
  if (markErr) {
    console.error("[not-relevant] mark update failed:", markErr.message);
  } else if (!marked?.length) {
    console.warn("[not-relevant] mark matched 0 rows", {
      businessId: input.businessId,
      phone: input.phone,
    });
  }

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
