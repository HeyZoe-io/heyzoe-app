import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMessage } from "@/lib/analytics";
import { sendMetaWhatsAppMessage, type MetaWhatsAppOutgoing } from "@/lib/whatsapp";

/** Meta phone_number_id לקו שיווקי HeyZoe */
export const MARKETING_WA_PHONE_NUMBER_ID = "1179786855208358";

export const MARKETING_PHONE_DISPLAY = "+972 3-382-4981";

/** slug בטבלת messages / paused_sessions לשיחות הקו השיווקי */
export const MARKETING_CONVERSATIONS_SLUG = "heyzoe-marketing";

export function isMarketingConversationsSlug(slug: string): boolean {
  return String(slug ?? "")
    .trim()
    .toLowerCase() === MARKETING_CONVERSATIONS_SLUG;
}

export function marketingWaSessionId(leadPhone: string): string {
  const digits = String(leadPhone ?? "").replace(/\D/g, "");
  return `wa_${MARKETING_WA_PHONE_NUMBER_ID}_${digits || leadPhone}`;
}

export function extractLeadPhoneFromMarketingSession(sessionId: string): string {
  const prefix = `wa_${MARKETING_WA_PHONE_NUMBER_ID}_`;
  if (sessionId.startsWith(prefix)) return sessionId.slice(prefix.length);
  return "";
}

export async function logMarketingWhatsAppMessage(input: {
  leadPhone: string;
  role: "user" | "assistant";
  content: string;
  model_used?: string | null;
}): Promise<void> {
  const phone = String(input.leadPhone ?? "").trim();
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

/** שיחות קו שיווקי: messages + סשנים מ-marketing_flow_sessions (גם לפני שהתחלנו לרשום הודעות) */
export async function loadMarketingConversationSessions(): Promise<MarketingSessionSummary[]> {
  const admin = createSupabaseAdminClient();
  const slug = MARKETING_CONVERSATIONS_SLUG;

  const [{ data: messages }, { data: pausedRows }, { data: flowSessions }] = await Promise.all([
    admin
      .from("messages")
      .select("session_id, role, created_at")
      .eq("business_slug", slug)
      .order("created_at", { ascending: true })
      .limit(50_000),
    admin
      .from("paused_sessions")
      .select("session_id, paused_until")
      .eq("business_slug", slug)
      .gt("paused_until", new Date().toISOString()),
    admin
      .from("marketing_flow_sessions")
      .select("phone, updated_at, created_at")
      .order("updated_at", { ascending: false })
      .limit(5000),
  ]);

  const pausedSet = new Set<string>((pausedRows ?? []).map((p) => String((p as { session_id?: string }).session_id ?? "")));

  const bySession = new Map<string, { lastAt: Date; count: number; lastFromUser: boolean; phone: string }>();

  for (const m of messages ?? []) {
    const row = m as { session_id?: string; role?: string; created_at?: string };
    const sid = String(row.session_id ?? "anon");
    const at = new Date(String(row.created_at ?? ""));
    const fromUser = String(row.role ?? "") === "user";
    const phone = extractLeadPhoneFromMarketingSession(sid) || sid;
    const existing = bySession.get(sid);
    if (!existing) {
      bySession.set(sid, { lastAt: at, count: 1, lastFromUser: fromUser, phone });
    } else {
      existing.lastAt = at;
      existing.count += 1;
      existing.lastFromUser = fromUser;
    }
  }

  for (const s of flowSessions ?? []) {
    const row = s as { phone?: string; updated_at?: string; created_at?: string };
    const phone = String(row.phone ?? "").trim();
    if (!phone) continue;
    const sid = marketingWaSessionId(phone);
    const at = new Date(String(row.updated_at ?? row.created_at ?? ""));
    const existing = bySession.get(sid);
    if (!existing) {
      bySession.set(sid, { lastAt: at, count: 0, lastFromUser: false, phone });
    } else if (at > existing.lastAt) {
      existing.lastAt = at;
    }
  }

  const sessions: MarketingSessionSummary[] = [...bySession.entries()].map(([sid, data]) => ({
    session_id: sid,
    lastAt: data.lastAt.toISOString(),
    count: data.count,
    isOpen: data.lastFromUser && Date.now() - data.lastAt.getTime() < 24 * 60 * 60 * 1000,
    isPaused: pausedSet.has(sid),
    phone: data.phone,
  }));

  sessions.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return sessions;
}
