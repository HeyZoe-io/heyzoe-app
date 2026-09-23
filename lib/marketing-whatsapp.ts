import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { extractPhoneFromSessionId, sessionIdMatchesWaPhoneNumberIds } from "@/lib/conversations-sessions";
import { logMessage } from "@/lib/analytics";
import { normalizePhone } from "@/lib/phone-normalize";
import {
  coerceMarketingNoteStatus,
  DEFAULT_MARKETING_NOTE_STATUS,
  sortMarketingSessionsByStatusPriority,
  type MarketingNoteStatus,
} from "@/lib/marketing-conversation-notes";
import {
  isMarketingStage,
  resolveMarketingAdminColumn,
  splitStoredMarketingStatus,
  type MarketingAdminColumn,
  type MarketingRelevance,
} from "@/lib/marketing-admin-status";
import { marketingLeadConversationAt } from "@/lib/lead-activity";
import { toPipelineDateOnly, toPipelineTime } from "@/lib/marketing-next-call";
import type { LeadRow } from "@/lib/leads-types";
import {
  isSalesFlowStartTrigger,
  normalizeSalesFlowGreetingToken,
} from "@/lib/sales-flow-start-triggers";
import { stripAssistantInteractiveButtonsLog } from "@/lib/wa-interactive-log";
import { sendMetaWhatsAppMessage, type MetaWhatsAppOutgoing } from "@/lib/whatsapp";

/** Meta phone_number_id לקו שיווקי HeyZoe */
export const MARKETING_WA_PHONE_NUMBER_ID = "1179786855208358";

export const MARKETING_PHONE_DISPLAY = "+972 3-382-4981";

/** ספרות בלבד ל־wa.me — קו זואי שיווק אדמין */
export const MARKETING_PHONE_WA_ME = "97233824981";

/** טקסט מוכן מדף הנחיתה — מפעיל/מאפס את פלואו השיווק */
export const MARKETING_FLOW_START_PREFILL = "היי זואי!";

/** וריאציות ייחודיות לקו השיווק (מעבר ל־SALES_FLOW_START_TRIGGERS) — כולל ברכות קצרות שזואי עסק כבר לא מתחילה מהן */
const MARKETING_EXTRA_START_TRIGGERS = new Set([
  "היי",
  "הי",
  "שלום",
  "אהלן",
  "hello",
  "hi",
  "hey",
  "היי זואי",
  "הי זואי",
  "היי zoe",
  "הי zoe",
  "hi zoe",
  "hey zoe",
  /** כפתור תפריט אחרי שאלת AI — מאפס ומתחיל פלואו */
  "להתחיל שיחה",
]);

/** נרמול טקסט נכנס לפלואו (מרכאות, רווחים, bidi) */
export function normalizeMarketingInboundText(text: string): string {
  return String(text ?? "")
    .trim()
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/["""''‚`´״׳«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * הודעה שמתחילה/מאפסת את פלואו השיווק —
 * אותן מילות הפעלה כמו זואי עסק + «היי זואי» / prefill מה־LP.
 */
export function isMarketingFlowStartMessage(text: string): boolean {
  const n = normalizeMarketingInboundText(text);
  if (!n) return false;
  if (isSalesFlowStartTrigger(n)) return true;
  return MARKETING_EXTRA_START_TRIGGERS.has(normalizeSalesFlowGreetingToken(n));
}

/** @deprecated use isMarketingFlowStartMessage */
export const isMarketingFlowRestartMessage = isMarketingFlowStartMessage;

/** slug בטבלת messages / paused_sessions לשיחות הקו השיווקי */
export const MARKETING_CONVERSATIONS_SLUG = "heyzoe-marketing";

export function isMarketingConversationsSlug(slug: string): boolean {
  return String(slug ?? "")
    .trim()
    .toLowerCase() === MARKETING_CONVERSATIONS_SLUG;
}

/** מזהי קו שיווקי ב-session_id (Meta phone_number_id + מספר תצוגה wa.me) */
export function marketingWaPhoneNumberIds(): string[] {
  return [MARKETING_WA_PHONE_NUMBER_ID, MARKETING_PHONE_WA_ME];
}

export function sessionIdBelongsToMarketingLine(sessionId: string): boolean {
  const sid = String(sessionId ?? "").trim();
  if (!sid || sid === "anon") return true;
  if (!sid.startsWith("wa_")) return false;
  return sessionIdMatchesWaPhoneNumberIds(sid, marketingWaPhoneNumberIds());
}

function marketingPhoneDigits(phoneOrSessionId: string): string {
  const raw = String(phoneOrSessionId ?? "").trim();
  if (!raw) return "";
  const fromSession = raw.startsWith("wa_") ? extractPhoneFromSessionId(raw) : raw;
  return normalizePhone(fromSession) || fromSession.replace(/\D/g, "") || fromSession;
}

export function marketingWaSessionId(leadPhone: string): string {
  const digits = marketingPhoneDigits(leadPhone);
  return `wa_${MARKETING_WA_PHONE_NUMBER_ID}_${digits || leadPhone}`;
}

/** session_id קנוני אחד לליד — מאחד פורמטי טלפון ומזהי קו ישנים */
export function canonicalMarketingSessionId(phoneOrSessionId: string): string {
  return marketingWaSessionId(marketingPhoneDigits(phoneOrSessionId) || phoneOrSessionId);
}

/** כל וריאציות session_id האפשריות לליד (לטעינת הודעות היסטוריות) */
export function marketingSessionIdVariants(phoneOrSessionId: string): string[] {
  const raw = String(phoneOrSessionId ?? "").trim();
  const digits = marketingPhoneDigits(raw);
  const variants = new Set<string>();
  if (raw.startsWith("wa_")) variants.add(raw);
  if (!digits) return raw ? [raw] : [];

  const digitForms = new Set<string>([digits]);
  if (digits.startsWith("972") && digits.length >= 12) {
    const local = digits.slice(3);
    digitForms.add(local);
    digitForms.add(local.startsWith("0") ? local : `0${local}`);
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    digitForms.add(`972${digits.slice(1)}`);
  }

  for (const pid of marketingWaPhoneNumberIds()) {
    for (const d of digitForms) {
      if (d) variants.add(`wa_${pid}_${d}`);
    }
  }
  variants.add(canonicalMarketingSessionId(raw));
  return [...variants];
}

export function extractLeadPhoneFromMarketingSession(sessionId: string): string {
  const sid = String(sessionId ?? "").trim();
  if (!sid.startsWith("wa_")) return "";
  for (const pid of marketingWaPhoneNumberIds()) {
    const prefix = `wa_${pid}_`;
    if (sid.startsWith(prefix)) return sid.slice(prefix.length);
  }
  return extractPhoneFromSessionId(sid);
}

/** האם השיחה בקו השיווק מושהית (עצור בוט) — לפי paused_sessions */
export async function isMarketingConversationPaused(phoneOrSessionId: string): Promise<boolean> {
  const canonical = canonicalMarketingSessionId(phoneOrSessionId);
  if (!canonical || canonical.endsWith("_")) return false;

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const variants = marketingSessionIdVariants(phoneOrSessionId);
  const { data, error } = await admin
    .from("paused_sessions")
    .select("session_id")
    .ilike("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .gt("paused_until", nowIso)
    .in("session_id", variants.length ? variants : [canonical])
    .limit(1);

  if (error) {
    console.warn("[marketing-whatsapp] pause check failed:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

function formatMarketingPhoneDisplay(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) {
    const local = d.slice(3);
    return local.startsWith("0") ? local : `0${local}`;
  }
  if (d.startsWith("0")) return d;
  return phone || "";
}

export async function logMarketingWhatsAppMessage(input: {
  leadPhone: string;
  role: "user" | "assistant";
  content: string;
  model_used?: string | null;
}): Promise<void> {
  const raw = String(input.leadPhone ?? "").trim();
  const phone = marketingPhoneDigits(raw) || raw.replace(/\D/g, "");
  if (!phone) return;
  await logMessage({
    business_slug: MARKETING_CONVERSATIONS_SLUG,
    role: input.role,
    content: String(input.content ?? "").slice(0, 12_000),
    session_id: marketingWaSessionId(phone),
    model_used: input.model_used ?? (input.role === "assistant" ? "marketing_flow" : null),
  });
}

export async function sendMarketingWhatsApp(
  leadPhone: string,
  outgoing: MetaWhatsAppOutgoing | string,
  opts?: { model_used?: string | null }
): Promise<void> {
  const phone = String(leadPhone ?? "").trim();
  if (!phone) return;
  let payload: MetaWhatsAppOutgoing =
    typeof outgoing === "string" ? { type: "text", text: outgoing } : outgoing;
  // לעולם לא לשלוח סמן לוג `[כפתורים:…]` בגוף טקסט ללקוח
  if (payload.type === "text") {
    const cleaned = stripAssistantInteractiveButtonsLog(payload.text);
    if (!cleaned) return;
    payload = { type: "text", text: cleaned };
  }
  await sendMetaWhatsAppMessage(MARKETING_WA_PHONE_NUMBER_ID, phone, payload);
  const text =
    payload.type === "text"
      ? payload.text
      : payload.type === "interactive"
        ? "[תפריט אינטראקטיבי]"
        : "[הודעה]";
  if (text.trim()) {
    await logMarketingWhatsAppMessage({
      leadPhone: phone,
      role: "assistant",
      content: text.trim(),
      model_used: opts?.model_used ?? "marketing_flow",
    });
  }
}

export type MarketingSessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  lastFromUser?: boolean;
  isPaused: boolean;
  pausedUntil?: string | null;
  phone: string;
  /** שם הליד מ-marketing_flow_sessions.full_name (WhatsApp ProfileName) */
  fullName?: string | null;
  /** סטטוס CRM ידני מ-marketing_conversation_notes (ברירת מחדל: ליד חדש) */
  noteStatus?: MarketingNoteStatus;
  noteRelevance?: MarketingRelevance;
  /** אותה עמודה כמו בדף הלידים */
  adminColumn?: MarketingAdminColumn;
  /** פגישה שנקבעה בדף הלידים — null אם אין, חסר בשדות של עסק שאינו שיווק */
  nextCallAt?: string | null;
  nextCallTime?: string | null;
};

type MarketingMessageRow = {
  session_id?: string | null;
  role?: string | null;
  created_at?: string | null;
};

function mergeMarketingMessageRows(
  target: MarketingMessageRow[],
  seen: Set<string>,
  rows: MarketingMessageRow[] | null | undefined
): void {
  for (const row of rows ?? []) {
    const key = `${String(row.session_id ?? "")}|${String(row.created_at ?? "")}|${String(row.role ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(row);
  }
}

function ingestMarketingMessage(
  bySession: Map<string, { lastAt: Date; count: number; lastFromUser: boolean; phone: string }>,
  row: MarketingMessageRow
): void {
  const rawSid = String(row.session_id ?? "anon").trim() || "anon";
  const sid = rawSid === "anon" ? "anon" : canonicalMarketingSessionId(rawSid);
  const at = new Date(String(row.created_at ?? ""));
  if (Number.isNaN(at.getTime())) return;
  const role = String(row.role ?? "");
  const speaker = role === "user" || role === "assistant";
  const fromUser = role === "user";
  const phone = formatMarketingPhoneDisplay(
    extractLeadPhoneFromMarketingSession(rawSid) || marketingPhoneDigits(rawSid) || rawSid
  );
  const existing = bySession.get(sid);
  if (!existing) {
    bySession.set(sid, { lastAt: at, count: 1, lastFromUser: speaker ? fromUser : false, phone });
    return;
  }
  existing.count += 1;
  if (at >= existing.lastAt) {
    existing.lastAt = at;
    if (speaker) existing.lastFromUser = fromUser;
  }
  if (!existing.phone && phone) existing.phone = phone;
}

/** שיחות קו שיווקי: messages + סשנים מ-marketing_flow_sessions (גם לפני שהתחלנו לרשום הודעות) */
export async function loadMarketingConversationSessions(): Promise<MarketingSessionSummary[]> {
  const admin = createSupabaseAdminClient();
  const slug = MARKETING_CONVERSATIONS_SLUG;

  const sessionIdOrFilter = marketingWaPhoneNumberIds()
    .map((id) => `session_id.like.wa_${id}_%`)
    .join(",");

  const [
    { data: slugMessages, error: slugErr },
    { data: lineMessages, error: lineErr },
    { data: pausedRows },
    { data: flowSessions, error: flowErr },
    { data: noteRows, error: notesErr },
  ] = await Promise.all([
    admin
      .from("messages")
      .select("session_id, role, created_at")
      .ilike("business_slug", slug)
      .order("created_at", { ascending: true })
      .limit(50_000),
    sessionIdOrFilter
      ? admin
          .from("messages")
          .select("session_id, role, created_at")
          .or(sessionIdOrFilter)
          .order("created_at", { ascending: true })
          .limit(50_000)
      : Promise.resolve({ data: [] as MarketingMessageRow[], error: null }),
    admin
      .from("paused_sessions")
      .select("session_id, paused_until")
      .ilike("business_slug", slug)
      .gt("paused_until", new Date().toISOString()),
    admin
      .from("marketing_flow_sessions")
      .select(
        "phone, updated_at, created_at, full_name, pipeline_status, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at, last_user_message_at, human_followup_at, next_call_at, next_call_time"
      )
      .order("updated_at", { ascending: false })
      .limit(5000),
    admin.from("marketing_conversation_notes").select("phone, status, relevance").limit(10_000),
  ]);

  if (slugErr) console.error("[marketing-whatsapp] slug messages:", slugErr.message);
  if (lineErr) console.error("[marketing-whatsapp] line messages:", lineErr.message);
  let resolvedFlowSessions = flowSessions;
  if (flowErr) {
    console.error("[marketing-whatsapp] flow_sessions:", flowErr.message);
    const legacyFlow = await admin
      .from("marketing_flow_sessions")
      .select("phone, updated_at, created_at, full_name")
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (legacyFlow.error) {
      console.error("[marketing-whatsapp] flow_sessions fallback:", legacyFlow.error.message);
    } else {
      resolvedFlowSessions = legacyFlow.data as unknown as typeof flowSessions;
    }
  }
  let resolvedNoteRows = noteRows;
  if (notesErr && /relevance|column|schema cache/i.test(notesErr.message)) {
    console.warn("[marketing-whatsapp] relevance column missing — run supabase/marketing_admin_status_layers.sql");
    const legacyNotes = await admin.from("marketing_conversation_notes").select("phone, status").limit(10_000);
    if (legacyNotes.error) {
      console.error("[marketing-whatsapp] conversation_notes:", legacyNotes.error.message);
    } else {
      resolvedNoteRows = legacyNotes.data as unknown as typeof noteRows;
    }
  } else if (notesErr) {
    console.error("[marketing-whatsapp] conversation_notes:", notesErr.message);
  }

  const noteByPhoneKey = new Map<string, { status: MarketingNoteStatus; relevance: string | null }>();
  for (const row of resolvedNoteRows ?? []) {
    const phoneRaw = String((row as { phone?: string }).phone ?? "").trim();
    if (!phoneRaw) continue;
    const status = coerceMarketingNoteStatus((row as { status?: string }).status);
    const relevance = String((row as { relevance?: string | null }).relevance ?? "").trim() || null;
    const digits = marketingPhoneDigits(phoneRaw) || phoneRaw.replace(/\D/g, "");
    if (digits) {
      noteByPhoneKey.set(digits, { status, relevance });
      if (digits.length >= 9) noteByPhoneKey.set(digits.slice(-9), { status, relevance });
    }
  }

  const flowByPhoneKey = new Map<
    string,
    {
      pipeline_status?: string | null;
      followup_1_sent_at?: string | null;
      followup_2_sent_at?: string | null;
      followup_3_sent_at?: string | null;
      last_user_message_at?: string | null;
      updated_at?: string | null;
      created_at?: string | null;
      human_followup_at?: string | null;
      next_call_at?: string | null;
      next_call_time?: string | null;
    }
  >();
  for (const s of resolvedFlowSessions ?? []) {
    const row = s as {
      phone?: string;
      pipeline_status?: string | null;
      followup_1_sent_at?: string | null;
      followup_2_sent_at?: string | null;
      followup_3_sent_at?: string | null;
      last_user_message_at?: string | null;
      updated_at?: string | null;
      created_at?: string | null;
      human_followup_at?: string | null;
      next_call_at?: string | null;
      next_call_time?: string | null;
    };
    const digits = marketingPhoneDigits(String(row.phone ?? "")) || String(row.phone ?? "").replace(/\D/g, "");
    if (!digits) continue;
    const prev = flowByPhoneKey.get(digits);
    if (prev) {
      const prevAt = new Date(marketingLeadConversationAt(prev) ?? 0).getTime();
      const nextAt = new Date(marketingLeadConversationAt(row) ?? 0).getTime();
      if (nextAt <= prevAt) continue;
    }
    flowByPhoneKey.set(digits, row);
    if (digits.length >= 9) flowByPhoneKey.set(digits.slice(-9), row);
  }

  const seenMsgKeys = new Set<string>();
  const allMessages: MarketingMessageRow[] = [];
  mergeMarketingMessageRows(allMessages, seenMsgKeys, slugMessages);
  mergeMarketingMessageRows(allMessages, seenMsgKeys, lineMessages);

  const pausedUntilByCanonical = new Map<string, string>();
  for (const p of pausedRows ?? []) {
    const rawSid = String((p as { session_id?: string }).session_id ?? "").trim();
    const until = String((p as { paused_until?: string }).paused_until ?? "").trim();
    if (!rawSid || !until) continue;
    const sid = canonicalMarketingSessionId(rawSid);
    const prev = pausedUntilByCanonical.get(sid);
    if (!prev || until > prev) pausedUntilByCanonical.set(sid, until);
  }

  const bySession = new Map<string, { lastAt: Date; count: number; lastFromUser: boolean; phone: string }>();

  for (const m of allMessages) {
    ingestMarketingMessage(bySession, m);
  }

  const nameBySid = new Map<string, string>();
  for (const s of resolvedFlowSessions ?? []) {
    const row = s as {
      phone?: string;
      updated_at?: string;
      created_at?: string;
      full_name?: string | null;
      last_user_message_at?: string | null;
    };
    const phoneRaw = String(row.phone ?? "").trim();
    if (!phoneRaw) continue;
    const sid = canonicalMarketingSessionId(phoneRaw);
    const fullName = String(row.full_name ?? "").trim();
    if (fullName && !nameBySid.has(sid)) nameBySid.set(sid, fullName);
    const activityRaw = marketingLeadConversationAt(row);
    const at = activityRaw ? new Date(activityRaw) : new Date(NaN);
    if (Number.isNaN(at.getTime())) continue;
    const phone = formatMarketingPhoneDisplay(marketingPhoneDigits(phoneRaw) || phoneRaw);
    const existing = bySession.get(sid);
    if (!existing) {
      bySession.set(sid, { lastAt: at, count: 0, lastFromUser: false, phone });
    } else if (!existing.phone && phone) {
      existing.phone = phone;
    }
  }

  function lookupPhone<T>(map: Map<string, T>, phoneDisplay: string, sessionId: string): T | undefined {
    const fromSid = extractLeadPhoneFromMarketingSession(sessionId);
    const candidates = [
      marketingPhoneDigits(phoneDisplay),
      marketingPhoneDigits(fromSid),
      String(phoneDisplay ?? "").replace(/\D/g, ""),
      String(fromSid ?? "").replace(/\D/g, ""),
    ].filter(Boolean);
    for (const c of candidates) {
      const hit = map.get(c) ?? (c.length >= 9 ? map.get(c.slice(-9)) : undefined);
      if (hit) return hit;
    }
    return undefined;
  }

  const sessions: MarketingSessionSummary[] = [...bySession.entries()].map(([sid, data]) => {
    const note = lookupPhone(noteByPhoneKey, data.phone, sid);
    const flow = lookupPhone(flowByPhoneKey, data.phone, sid);
    const crm = splitStoredMarketingStatus({
      status: note?.status,
      relevance: note?.relevance,
      hasNote: Boolean(note),
    });
    const followupStage = flow?.followup_3_sent_at ? 3 : flow?.followup_2_sent_at ? 2 : flow?.followup_1_sent_at ? 1 : 0;
    const messageAt = data.lastAt;
    const leadAtRaw = marketingLeadConversationAt(flow);
    const leadAt = leadAtRaw ? new Date(leadAtRaw) : null;
    const displayAt = leadAt && !Number.isNaN(leadAt.getTime()) ? leadAt : messageAt;
    const column = resolveMarketingAdminColumn({
      phone: data.phone,
      full_name: null,
      source: null,
      created_at: null,
      opted_out: flow?.pipeline_status === "opted_out",
      not_relevant_at: null,
      not_relevant_reason: null,
      human_requested_at: null,
      human_followup_at: flow?.human_followup_at ?? null,
      next_call_at: null,
      session_phase: null,
      trial_registered: false,
      wa_no_response_at: null,
      no_response_notified_at: null,
      wa_followup_stage: followupStage,
      last_contact_at: leadAtRaw ?? messageAt.toISOString(),
      cta_clicked_at: null,
      pipeline_status: flow?.pipeline_status ?? null,
      marketing_relevance: crm?.relevance ?? null,
      marketing_stage: crm?.stage ?? null,
    } satisfies LeadRow);
    const noteRelevance: MarketingRelevance = column === "not_relevant" ? "not_relevant" : "relevant";
    const noteStatus: MarketingNoteStatus = isMarketingStage(column)
      ? column
      : column === "not_relevant"
        ? "not_relevant"
        : DEFAULT_MARKETING_NOTE_STATUS;
    return {
      session_id: sid,
      lastAt: displayAt.toISOString(),
      count: data.count,
      isOpen: data.lastFromUser && Date.now() - messageAt.getTime() < 24 * 60 * 60 * 1000,
      lastFromUser: data.lastFromUser,
      isPaused: pausedUntilByCanonical.has(sid),
      pausedUntil: pausedUntilByCanonical.get(sid) ?? null,
      phone: data.phone,
      fullName: nameBySid.get(sid) ?? null,
      noteStatus,
      noteRelevance,
      adminColumn: column,
      nextCallAt: toPipelineDateOnly(flow?.next_call_at),
      nextCallTime: toPipelineTime(flow?.next_call_time),
    };
  });

  return sortMarketingSessionsByStatusPriority(sessions);
}
