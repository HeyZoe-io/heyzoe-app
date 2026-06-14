import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  aggregateSessionsFromMessages,
  extractPhoneFromSessionId,
  sortSessionsByRecentActivity,
  type SessionSummary,
} from "@/lib/conversations-sessions";
import {
  extractLeadPhoneFromMarketingSession,
  MARKETING_CONVERSATIONS_SLUG,
  marketingWaSessionId,
} from "@/lib/marketing-whatsapp";

/** slug מיוחד בטאב זואי אדמין — כל מקורות השיחות */
export const ZOE_ADMIN_ALL_CONVERSATIONS_SLUG = "__all__";

export type ZoeAdminSessionSummary = SessionSummary & {
  source_slug: string;
  source_name: string;
};

export function isZoeAdminAllConversationsSlug(slug: string): boolean {
  return String(slug ?? "").trim().toLowerCase() === ZOE_ADMIN_ALL_CONVERSATIONS_SLUG;
}

function formatPhoneDisplay(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) {
    const local = d.slice(3);
    return local.startsWith("0") ? local : `0${local}`;
  }
  if (d.startsWith("0")) return d;
  return phone || "";
}

/** איחוד שיחות קו שיווקי + כל העסקים לרשימה אחת */
export async function loadAllZoeAdminConversationSessions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businesses: { slug: string; name: string | null }[]
): Promise<ZoeAdminSessionSummary[]> {
  const slugList = [
    MARKETING_CONVERSATIONS_SLUG,
    ...businesses
      .map((b) => String(b.slug ?? "").trim().toLowerCase())
      .filter((s) => s && s !== MARKETING_CONVERSATIONS_SLUG),
  ];
  const nameBySlug = new Map<string, string>([
    [MARKETING_CONVERSATIONS_SLUG, "זואי שיווק"],
    ...businesses.map((b) => [
      String(b.slug).trim().toLowerCase(),
      (b.name || b.slug || "").trim(),
    ] as const),
  ]);

  const [{ data: messages }, { data: pausedRows }, { data: flowSessions }] = await Promise.all([
    admin
      .from("messages")
      .select("session_id, role, created_at, business_slug")
      .in("business_slug", slugList)
      .order("created_at", { ascending: true })
      .limit(50_000),
    admin
      .from("paused_sessions")
      .select("session_id, paused_until, business_slug")
      .in("business_slug", slugList)
      .gt("paused_until", new Date().toISOString()),
    admin
      .from("marketing_flow_sessions")
      .select("phone, updated_at, created_at")
      .order("updated_at", { ascending: false })
      .limit(5000),
  ]);

  const pausedBySlug = new Map<string, Set<string>>();
  for (const p of pausedRows ?? []) {
    const bs = String((p as { business_slug?: string }).business_slug ?? "").trim().toLowerCase();
    const sid = String((p as { session_id?: string }).session_id ?? "");
    if (!bs || !sid) continue;
    const set = pausedBySlug.get(bs) ?? new Set<string>();
    set.add(sid);
    pausedBySlug.set(bs, set);
  }

  const bySlugSession = new Map<string, SessionSummary[]>();

  const msgsBySlug = new Map<string, typeof messages>();
  for (const m of messages ?? []) {
    const bs = String((m as { business_slug?: string }).business_slug ?? "").trim().toLowerCase();
    if (!bs) continue;
    const list = msgsBySlug.get(bs) ?? [];
    list.push(m);
    msgsBySlug.set(bs, list);
  }

  for (const bs of slugList) {
    const slugMsgs = msgsBySlug.get(bs) ?? [];
    const pausedForSlug = pausedBySlug.get(bs) ?? new Set<string>();
    const sessions = aggregateSessionsFromMessages(slugMsgs, pausedForSlug);
    bySlugSession.set(bs, sessions);
  }

  const marketingSid = new Set((bySlugSession.get(MARKETING_CONVERSATIONS_SLUG) ?? []).map((s) => s.session_id));
  for (const s of flowSessions ?? []) {
    const phone = String((s as { phone?: string }).phone ?? "").trim();
    if (!phone) continue;
    const sid = marketingWaSessionId(phone);
    if (marketingSid.has(sid)) continue;
    const at = new Date(String((s as { updated_at?: string }).updated_at ?? (s as { created_at?: string }).created_at ?? ""));
    const list = bySlugSession.get(MARKETING_CONVERSATIONS_SLUG) ?? [];
    list.push({
      session_id: sid,
      lastAt: at.toISOString(),
      count: 0,
      isOpen: false,
      isPaused: (pausedBySlug.get(MARKETING_CONVERSATIONS_SLUG) ?? new Set()).has(sid),
      phone: formatPhoneDisplay(phone) || phone,
    });
    bySlugSession.set(MARKETING_CONVERSATIONS_SLUG, list);
  }

  const out: ZoeAdminSessionSummary[] = [];
  for (const [bs, sessions] of bySlugSession) {
    const label = nameBySlug.get(bs) || bs;
    for (const s of sessions) {
      const phone =
        bs === MARKETING_CONVERSATIONS_SLUG
          ? formatPhoneDisplay(extractLeadPhoneFromMarketingSession(s.session_id) || s.phone) || s.phone
          : formatPhoneDisplay(extractPhoneFromSessionId(s.session_id) || s.phone) || s.phone;
      out.push({
        ...s,
        phone,
        source_slug: bs,
        source_name: label,
      });
    }
  }

  return sortSessionsByRecentActivity(out);
}
