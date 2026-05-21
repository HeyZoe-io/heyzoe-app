import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { extractPhoneFromSessionId, sessionIdMatchesWaPhoneNumberIds } from "@/lib/conversations-sessions";
import { logMessage } from "@/lib/analytics";
import { normalizePhone } from "@/lib/phone-normalize";
import { sendMetaWhatsAppMessage, type MetaWhatsAppOutgoing } from "@/lib/whatsapp";

/** Meta phone_number_id לקו שיווקי HeyZoe */
export const MARKETING_WA_PHONE_NUMBER_ID = "1179786855208358";

export const MARKETING_PHONE_DISPLAY = "+972 3-382-4981";

/** ספרות בלבד ל־wa.me — קו זואי שיווק אדמין */
export const MARKETING_PHONE_WA_ME = "97233824981";

/** טקסט מוכן מדף הנחיתה — מפעיל/מאפס את פלואו השיווק */
export const MARKETING_FLOW_START_PREFILL = "היי זואי!";

/** נרמול טקסט נכנס לפלואו (מרכאות, רווחים, bidi) */
export function normalizeMarketingInboundText(text: string): string {
  return String(text ?? "")
    .trim()
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/["""''‚`´״׳«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** הודעה שמתחילה/מאפסת את פלואו השיווק — רק ברכה בלבד, בלי שאלה או משפט נוסף */
export function isMarketingFlowStartMessage(text: string): boolean {
  const n = normalizeMarketingInboundText(text).toLowerCase();
  if (!n) return false;
  // פסיק / נקודתיים / סימן שיש המשך אחרי הברכה
  if (/[,،;:]/u.test(n)) return false;
  const core = n.replace(/[!?.…]+$/gu, "").trim();
  return core === "היי" || core === "היי זואי";
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
  const payload: MetaWhatsAppOutgoing =
    typeof outgoing === "string" ? { type: "text", text: outgoing } : outgoing;
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
  isPaused: boolean;
  phone: string;
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
  const fromUser = String(row.role ?? "") === "user";
  const phone = formatMarketingPhoneDisplay(
    extractLeadPhoneFromMarketingSession(rawSid) || marketingPhoneDigits(rawSid) || rawSid
  );
  const existing = bySession.get(sid);
  if (!existing) {
    bySession.set(sid, { lastAt: at, count: 1, lastFromUser: fromUser, phone });
    return;
  }
  existing.lastAt = at > existing.lastAt ? at : existing.lastAt;
  existing.count += 1;
  existing.lastFromUser = fromUser;
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
      .select("phone, updated_at, created_at")
      .order("updated_at", { ascending: false })
      .limit(5000),
  ]);

  if (slugErr) console.error("[marketing-whatsapp] slug messages:", slugErr.message);
  if (lineErr) console.error("[marketing-whatsapp] line messages:", lineErr.message);
  if (flowErr) console.error("[marketing-whatsapp] flow_sessions:", flowErr.message);

  const seenMsgKeys = new Set<string>();
  const allMessages: MarketingMessageRow[] = [];
  mergeMarketingMessageRows(allMessages, seenMsgKeys, slugMessages);
  mergeMarketingMessageRows(allMessages, seenMsgKeys, lineMessages);

  const pausedCanonical = new Set<string>();
  for (const p of pausedRows ?? []) {
    const rawSid = String((p as { session_id?: string }).session_id ?? "").trim();
    if (!rawSid) continue;
    pausedCanonical.add(canonicalMarketingSessionId(rawSid));
  }

  const bySession = new Map<string, { lastAt: Date; count: number; lastFromUser: boolean; phone: string }>();

  for (const m of allMessages) {
    ingestMarketingMessage(bySession, m);
  }

  for (const s of flowSessions ?? []) {
    const row = s as { phone?: string; updated_at?: string; created_at?: string };
    const phoneRaw = String(row.phone ?? "").trim();
    if (!phoneRaw) continue;
    const sid = canonicalMarketingSessionId(phoneRaw);
    const at = new Date(String(row.updated_at ?? row.created_at ?? ""));
    if (Number.isNaN(at.getTime())) continue;
    const phone = formatMarketingPhoneDisplay(marketingPhoneDigits(phoneRaw) || phoneRaw);
    const existing = bySession.get(sid);
    if (!existing) {
      bySession.set(sid, { lastAt: at, count: 0, lastFromUser: false, phone });
    } else {
      if (at > existing.lastAt) existing.lastAt = at;
      if (!existing.phone && phone) existing.phone = phone;
    }
  }

  const sessions: MarketingSessionSummary[] = [...bySession.entries()].map(([sid, data]) => ({
    session_id: sid,
    lastAt: data.lastAt.toISOString(),
    count: data.count,
    isOpen: data.lastFromUser && Date.now() - data.lastAt.getTime() < 24 * 60 * 60 * 1000,
    isPaused: pausedCanonical.has(sid),
    phone: data.phone,
  }));

  sessions.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return sessions;
}
