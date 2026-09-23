import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  aggregateSessionsFromMessages,
  extractPhoneFromSessionId,
  sortSessionsByRecentActivity,
  type SessionSummary,
} from "@/lib/conversations-sessions";
import { marketingLeadConversationAt } from "@/lib/lead-activity";
import { toPipelineDateOnly, toPipelineTime } from "@/lib/marketing-next-call";
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
  /** פגישה מדף הלידים. קיים רק בשיחות שיווק; null = לא נקבעה. */
  nextCallAt?: string | null;
  nextCallTime?: string | null;
};

export function isZoeAdminAllConversationsSlug(slug: string): boolean {
  return String(slug ?? "").trim().toLowerCase() === ZOE_ADMIN_ALL_CONVERSATIONS_SLUG;
}

/** מפתח השוואת טלפון אחיד (9 ספרות אחרונות) להתאמת שם ליד בין פורמטים */
function leadPhoneKey(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : d;
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
      .select("phone, updated_at, created_at, full_name, last_user_message_at, next_call_at, next_call_time")
      .order("updated_at", { ascending: false })
      .limit(5000),
  ]);

  const pausedUntilBySlug = new Map<string, Map<string, string>>();
  for (const p of pausedRows ?? []) {
    const bs = String((p as { business_slug?: string }).business_slug ?? "").trim().toLowerCase();
    const sid = String((p as { session_id?: string }).session_id ?? "");
    const until = String((p as { paused_until?: string }).paused_until ?? "").trim();
    if (!bs || !sid || !until) continue;
    const set = pausedUntilBySlug.get(bs) ?? new Map<string, string>();
    const prev = set.get(sid);
    if (!prev || until > prev) set.set(sid, until);
    pausedUntilBySlug.set(bs, set);
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
    const pausedForSlug = pausedUntilBySlug.get(bs) ?? new Map<string, string>();
    const sessions = aggregateSessionsFromMessages(slugMsgs, pausedForSlug);
    bySlugSession.set(bs, sessions);
  }

  const marketingNameByPhoneKey = new Map<string, string>();
  const marketingActivityByPhoneKey = new Map<string, string>();
  const marketingCallByPhoneKey = new Map<string, { date: string | null; time: string | null }>();
  for (const s of flowSessions ?? []) {
    const row = s as {
      phone?: string;
      full_name?: string | null;
      last_user_message_at?: string | null;
      updated_at?: string | null;
      created_at?: string | null;
      next_call_at?: string | null;
      next_call_time?: string | null;
    };
    const phone = String(row.phone ?? "").trim();
    if (!phone) continue;
    const fullName = String(row.full_name ?? "").trim();
    const key = leadPhoneKey(phone);
    if (fullName && key && !marketingNameByPhoneKey.has(key)) marketingNameByPhoneKey.set(key, fullName);
    const activity = marketingLeadConversationAt(row);
    if (activity && key) {
      const prev = marketingActivityByPhoneKey.get(key);
      if (!prev || new Date(activity).getTime() > new Date(prev).getTime()) {
        marketingActivityByPhoneKey.set(key, activity);
      }
    }
    if (key) {
      const next = {
        date: toPipelineDateOnly(row.next_call_at),
        time: toPipelineTime(row.next_call_time),
      };
      const prev = marketingCallByPhoneKey.get(key);
      if (!prev || (!prev.date && next.date)) marketingCallByPhoneKey.set(key, next);
    }
  }

  const marketingSid = new Set((bySlugSession.get(MARKETING_CONVERSATIONS_SLUG) ?? []).map((s) => s.session_id));
  for (const s of flowSessions ?? []) {
    const phone = String((s as { phone?: string }).phone ?? "").trim();
    if (!phone) continue;
    const sid = marketingWaSessionId(phone);
    if (marketingSid.has(sid)) continue;
    const at = new Date(
      marketingLeadConversationAt(
        s as {
          last_user_message_at?: string | null;
          updated_at?: string | null;
          created_at?: string | null;
        }
      ) ?? ""
    );
    if (Number.isNaN(at.getTime())) continue;
    const pausedUntil = (pausedUntilBySlug.get(MARKETING_CONVERSATIONS_SLUG) ?? new Map()).get(sid) ?? null;
    const list = bySlugSession.get(MARKETING_CONVERSATIONS_SLUG) ?? [];
    list.push({
      session_id: sid,
      lastAt: at.toISOString(),
      count: 0,
      isOpen: false,
      lastFromUser: false,
      isPaused: Boolean(pausedUntil),
      pausedUntil,
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
      const phoneKey = leadPhoneKey(extractLeadPhoneFromMarketingSession(s.session_id) || phone);
      const fullName =
        bs === MARKETING_CONVERSATIONS_SLUG
          ? marketingNameByPhoneKey.get(phoneKey) ?? s.fullName ?? null
          : s.fullName ?? null;
      const leadAt = bs === MARKETING_CONVERSATIONS_SLUG ? marketingActivityByPhoneKey.get(phoneKey) : undefined;
      const call = bs === MARKETING_CONVERSATIONS_SLUG ? marketingCallByPhoneKey.get(phoneKey) : undefined;
      out.push({
        ...s,
        phone,
        fullName,
        lastAt: leadAt || s.lastAt,
        ...(bs === MARKETING_CONVERSATIONS_SLUG
          ? { nextCallAt: call?.date ?? null, nextCallTime: call?.time ?? null }
          : {}),
        source_slug: bs,
        source_name: label,
      });
    }
  }

  return sortSessionsByRecentActivity(out);
}
