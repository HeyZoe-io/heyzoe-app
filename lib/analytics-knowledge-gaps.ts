import type { SupabaseClient } from "@supabase/supabase-js";
import type { DetectedMessageLanguage } from "@/lib/language-detect";
import {
  assistantAskedMembershipOrTrialClarify,
  assistantReplyDumpsAccountAccessToSelfServeCall,
  BOOKING_LOOKUP_MEMBERSHIP_HANDOFF_MODEL,
} from "@/lib/wa-booking-lookup";
import { FREEZE_BILLING_HANDOFF_MODEL } from "@/lib/wa-freeze-billing-handoff";
import { UNKNOWN_CLASS_SLOT_HANDOFF_MODEL } from "@/lib/wa-unknown-class-slot";
import { UNKNOWN_OFFER_POLICY_HANDOFF_MODEL } from "@/lib/wa-unknown-offer-policy";
import { isUnclearClarifyAsk } from "@/lib/wa-unclear-intent";

/** ניסוחי חוסר-ידע של זואי (עברית + אנגלית) — לא כולל מגבלת 24ש׳ / redirect כללי. */
export const KNOWLEDGE_GAP_NEEDLES = [
  "אין לי את הפרטים",
  "אין לי כרגע מידע",
  "אין לי כרגע את המידע",
  "אין לי מידע",
  "אין לי את המידע",
  "לא מצאתי את המידע",
  "לא מצאתי מידע",
  "אני מתנצלת, אין לי",
  "זה משהו שצריך לברר מול הצוות",
  "צריך לברר מול הצוות",
  "i don't have the details",
  "i don't currently have information",
  "i don't have information",
  "i don't have the membership pricing details",
  "i couldn't find the information",
  "i could not find the information",
] as const;

export const KNOWLEDGE_GAP_NO_DETAILS_MODEL = "knowledge_gap_no_details";
export const KNOWLEDGE_GAP_NO_DETAILS_HE = "אין לי את הפרטים על כך.";
export const KNOWLEDGE_GAP_NO_DETAILS_EN = "I don't have the details on that.";

const EXCLUDED_MODELS = new Set(["claude_limit_24h"]);

/** העברות לצוות שמייצגות חוסר ידע (מועד/מדיניות שאין בידע) — לא handoff תפעולי. */
const KNOWLEDGE_GAP_MODELS = new Set([
  UNKNOWN_CLASS_SLOT_HANDOFF_MODEL,
  UNKNOWN_OFFER_POLICY_HANDOFF_MODEL,
  KNOWLEDGE_GAP_NO_DETAILS_MODEL,
]);

/** יומן/חיוב/הקפאה — העברה תפעולית, לא מידע חסר להוסיף לזואי. */
const OPERATIONAL_HANDOFF_MODELS = new Set([
  BOOKING_LOOKUP_MEMBERSHIP_HANDOFF_MODEL,
  FREEZE_BILLING_HANDOFF_MODEL,
]);

const MESSAGE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** חלון סריקה — מונע table scan מלא. ~1 שאילתה + סינון בזיכרון. */
const SCAN_DAYS = 90;
const ASSISTANT_SCAN_LIMIT = 1500;
const RESULT_LIMIT = 20;

export type KnowledgeGapKind = "question" | "schedule_request";

export type KnowledgeGapItem = {
  id: string;
  assistantMessageId: string;
  sessionId: string;
  kind: KnowledgeGapKind;
  question: string;
  assistantSnippet: string;
  createdAt: string;
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function parseMessageUuid(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return MESSAGE_UUID_RE.test(s) ? s.toLowerCase() : "";
}

const QUESTION_MARK_RE = /[?؟]/;
const INTERROGATIVE_RE =
  /(?<![\u0590-\u05FF])(?:מה|איך|האם|כמה|מתי|למה|למי|איפה|מדוע|כיצד|מי)(?![\u0590-\u05FF])|\b(?:why|what|how|when|where|does)\b/iu;
const SCHEDULE_TIME_RE =
  /(?:בשעה|לשעה)\s*\d{1,4}|(?:[01]?\d|2[0-3])[:.][0-5]\d/u;

/** בקשת מועד/שיעור (בחירה או הקלדה) — לא שאלת ידע. */
export function looksLikeScheduleRequest(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (QUESTION_MARK_RE.test(t)) return false;
  if (INTERROGATIVE_RE.test(t)) return false;
  if (/^(?:אפשר|ניתן|יש)(?![\u0590-\u05FF])/u.test(t)) return false;
  return SCHEDULE_TIME_RE.test(t);
}

export function resolveKnowledgeGapKind(input: {
  question: string;
  modelUsed?: string | null;
}): KnowledgeGapKind {
  if (String(input.modelUsed ?? "").trim() === UNKNOWN_CLASS_SLOT_HANDOFF_MODEL) {
    return "schedule_request";
  }
  return looksLikeScheduleRequest(input.question) ? "schedule_request" : "question";
}

function isOperationalTeamHandoffText(content: string, modelUsed?: string | null): boolean {
  const model = String(modelUsed ?? "").trim();
  if (model && OPERATIONAL_HANDOFF_MODELS.has(model)) return true;
  const t = String(content ?? "").trim();
  if (!t) return false;
  if (assistantReplyDumpsAccountAccessToSelfServeCall(t)) return true;
  if (/תודה על הבהרה/u.test(t) && /צוות/u.test(t)) return true;
  if (/בלבול עם (?:החיוב|ההקפאה|הכרטיס)/u.test(t)) return true;
  return false;
}

export function isKnowledgeGapAssistantText(content: string, modelUsed?: string | null): boolean {
  const model = String(modelUsed ?? "").trim();
  if (model && EXCLUDED_MODELS.has(model)) return false;
  if (isOperationalTeamHandoffText(content, modelUsed)) return false;
  if (model && KNOWLEDGE_GAP_MODELS.has(model)) return true;
  const t = String(content ?? "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  return KNOWLEDGE_GAP_NEEDLES.some((n) => lower.includes(n.toLowerCase()));
}

export function pickKnowledgeGapNoDetailsReply(lang: DetectedMessageLanguage): string {
  return lang === "en" ? KNOWLEDGE_GAP_NO_DETAILS_EN : KNOWLEDGE_GAP_NO_DETAILS_HE;
}

function stripQuestionDecor(raw: string): string {
  return String(raw ?? "")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, " ")
    .replace(/[\s!.,?؟:;*\-]+/g, " ")
    .trim();
}

function looksLikeChitchatUserText(content: string): boolean {
  const t = stripQuestionDecor(content);
  if (!t) return true;
  return /^(?:ו?שבוע טוב|ו?שבת שלום|חג שמח|צום קל|גמר חתימה טובה|בוקר טוב|צהריים טובים|ערב טוב|לילה טוב|היי+|שלום(?: רב)?|תודה(?: רבה)?|thanks|thank you|hi+|hello|bye|good (?:week|morning|night))$/iu.test(
    t
  );
}

function looksLikeMembershipClarifyAnswerOnly(content: string): boolean {
  const t = stripQuestionDecor(content);
  if (!t || t.length > 48) return false;
  return /^(?:מנוי קיים|יש לי מנוי|יש לנו מנוי|אימון ניסיון|שיעור ניסיון)$/iu.test(t);
}

function isUsableUserQuestion(content: string): boolean {
  const q = String(content ?? "").trim();
  if (!q) return false;
  if (q.startsWith("[media]") || q.startsWith("[heyzoe:") || q.startsWith("[reaction]")) return false;
  if (looksLikeChitchatUserText(q)) return false;
  if (looksLikeMembershipClarifyAnswerOnly(q)) return false;
  return true;
}

/**
 * שאלת המשתמש שלפני חוסר הידע.
 * אחרי «לא הבנתי» לוקחים את ההודעה המקורית, לא את הניסוח מחדש.
 */
export function pickKnowledgeGapQuestion(
  msgs: Array<{ role: string; content: string; createdAt: string }>,
  gapCreatedAt: string
): string {
  let fallback = "";
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.createdAt >= gapCreatedAt) continue;
    if (m.role !== "user") continue;
    const q = String(m.content ?? "").trim();
    if (!isUsableUserQuestion(q)) continue;

    let replyToClarify = false;
    for (let j = i - 1; j >= 0; j--) {
      const prev = msgs[j]!;
      if (prev.createdAt >= gapCreatedAt) continue;
      if (prev.role === "user") break;
      if (prev.role !== "assistant") continue;
      if (
        isUnclearClarifyAsk(prev.content) ||
        assistantAskedMembershipOrTrialClarify(prev.content)
      ) {
        replyToClarify = true;
        break;
      }
    }
    if (replyToClarify) {
      if (!fallback) fallback = q;
      continue;
    }
    return q;
  }
  return fallback;
}

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isDismissalsSchemaMismatch(message: string): boolean {
  return /analytics_knowledge_gap_dismissals|does not exist|relation|invalid input syntax|uuid|bigint/i.test(
    message
  );
}

/**
 * מוצא שאלות משתמש שלפני תשובת חוסר-ידע של זואי.
 * IO משוער לעסק: 3 שאילתות ממוקדות (assistant scan + dismissals + messages לפי session).
 */
export async function findKnowledgeGaps(input: {
  admin: SupabaseClient;
  businessSlug: string;
}): Promise<KnowledgeGapItem[]> {
  const slug = input.businessSlug.trim().toLowerCase();
  if (!slug) return [];

  const startIso = isoDaysAgo(SCAN_DAYS);

  const { data: assistants, error: aErr } = await input.admin
    .from("messages")
    .select("id, content, session_id, created_at, model_used")
    .eq("business_slug", slug)
    .eq("role", "assistant")
    .gte("created_at", startIso)
    .order("created_at", { ascending: false })
    .limit(ASSISTANT_SCAN_LIMIT);

  if (aErr) {
    console.error("[analytics-knowledge-gaps] assistant scan failed:", aErr.message);
    throw new Error(aErr.message);
  }

  const candidates = (assistants ?? [])
    .map((row) => ({
      id: parseMessageUuid((row as { id?: unknown }).id),
      content: String((row as { content?: unknown }).content ?? ""),
      sessionId: String((row as { session_id?: unknown }).session_id ?? "").trim(),
      createdAt: String((row as { created_at?: unknown }).created_at ?? ""),
      modelUsed: ((row as { model_used?: unknown }).model_used as string | null) ?? null,
    }))
    .filter(
      (r) => r.id && r.sessionId && r.createdAt && isKnowledgeGapAssistantText(r.content, r.modelUsed)
    );

  if (!candidates.length) return [];

  const candidateIds = candidates.map((c) => c.id);
  const { data: dismissedRows, error: dErr } = await input.admin
    .from("analytics_knowledge_gap_dismissals")
    .select("assistant_message_id")
    .eq("business_slug", slug)
    .in("assistant_message_id", candidateIds);

  if (dErr) {
    // טבלה עדיין לא קיימת / טיפוס ישן (bigint) / שגיאת הרשאה — לא נכשלים בשקט בלי לוג
    console.error("[analytics-knowledge-gaps] dismissals fetch failed:", dErr.message);
    if (!isDismissalsSchemaMismatch(dErr.message)) {
      throw new Error(dErr.message);
    }
  }

  const dismissed = new Set(
    (dismissedRows ?? [])
      .map((r) => parseMessageUuid((r as { assistant_message_id?: unknown }).assistant_message_id))
      .filter(Boolean)
  );

  const open = candidates.filter((c) => !dismissed.has(c.id)).slice(0, RESULT_LIMIT * 2);
  if (!open.length) return [];

  const sessionIds = [...new Set(open.map((c) => c.sessionId))];
  const oldest = open.reduce((min, c) => (c.createdAt < min ? c.createdAt : min), open[0]!.createdAt);
  // מרווח קטן אחורה כדי לתפוס את שאלת היוזר שלפני
  const padMs = 7 * 24 * 60 * 60 * 1000;
  const padStart = new Date(new Date(oldest).getTime() - padMs).toISOString();

  const { data: sessionMsgs, error: sErr } = await input.admin
    .from("messages")
    .select("session_id, role, content, created_at")
    .eq("business_slug", slug)
    .in("session_id", sessionIds)
    .in("role", ["user", "assistant"])
    .gte("created_at", padStart)
    .order("created_at", { ascending: true })
    .limit(8000);

  if (sErr) {
    console.error("[analytics-knowledge-gaps] session messages failed:", sErr.message);
    throw new Error(sErr.message);
  }

  const bySession = new Map<string, { role: string; content: string; createdAt: string }[]>();
  for (const m of sessionMsgs ?? []) {
    const sid = String((m as { session_id?: unknown }).session_id ?? "").trim();
    if (!sid) continue;
    const list = bySession.get(sid) ?? [];
    list.push({
      role: String((m as { role?: unknown }).role ?? ""),
      content: String((m as { content?: unknown }).content ?? ""),
      createdAt: String((m as { created_at?: unknown }).created_at ?? ""),
    });
    bySession.set(sid, list);
  }

  const out: KnowledgeGapItem[] = [];
  for (const gap of open) {
    if (out.length >= RESULT_LIMIT) break;
    const msgs = bySession.get(gap.sessionId) ?? [];
    const question = pickKnowledgeGapQuestion(msgs, gap.createdAt);
    if (!question) continue;
    out.push({
      id: gap.id,
      assistantMessageId: gap.id,
      sessionId: gap.sessionId,
      kind: resolveKnowledgeGapKind({ question, modelUsed: gap.modelUsed }),
      question: truncate(question, 280),
      assistantSnippet: truncate(gap.content, 160),
      createdAt: gap.createdAt,
    });
  }

  return out;
}

export async function dismissKnowledgeGap(input: {
  admin: SupabaseClient;
  businessSlug: string;
  assistantMessageId: string;
  dismissedBy?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const slug = input.businessSlug.trim().toLowerCase();
  const mid = parseMessageUuid(input.assistantMessageId);
  if (!slug || !mid) {
    return { ok: false, error: "invalid_input", status: 400 };
  }

  const { error } = await input.admin.from("analytics_knowledge_gap_dismissals").upsert(
    {
      business_slug: slug,
      assistant_message_id: mid,
      dismissed_at: new Date().toISOString(),
      dismissed_by: input.dismissedBy ?? null,
    },
    { onConflict: "business_slug,assistant_message_id" }
  );

  if (error) {
    console.error("[analytics-knowledge-gaps] dismiss failed:", error.message);
    if (isDismissalsSchemaMismatch(error.message)) {
      return {
        ok: false,
        error: "migration_required",
        status: 503,
      };
    }
    return { ok: false, error: error.message, status: 500 };
  }

  return { ok: true };
}
