import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { computeContactStatus, type ContactStatusKey } from "@/lib/contact-status";
import { normalizePhone } from "@/lib/phone-normalize";

export type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
  /** סטטוס ליד מטבלת contacts (אותה לוגיקה כמו בדף אנשי קשר) */
  contactStatus?: ContactStatusKey | null;
};

function phoneLookupKey(phone: string): string {
  const p = String(phone ?? "").trim();
  return normalizePhone(p) ?? p.replace(/\D/g, "");
}

async function loadContactStatusByPhoneForBusiness(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<Map<string, ContactStatusKey | null>> {
  const { data, error } = await admin
    .from("contacts")
    .select("phone, opted_out, trial_registered, session_phase, wa_followup_stage")
    .eq("business_id", businessId);

  if (error) {
    console.warn("[conversations-sessions] contacts status load:", error.message);
    return new Map();
  }

  const map = new Map<string, ContactStatusKey | null>();
  for (const row of data ?? []) {
    const phone = String((row as { phone?: string }).phone ?? "").trim();
    const key = phoneLookupKey(phone);
    if (!key) continue;
    map.set(key, computeContactStatus(row as Parameters<typeof computeContactStatus>[0]));
  }
  return map;
}

function enrichSessionsWithContactStatus(
  sessions: SessionSummary[],
  byPhone: Map<string, ContactStatusKey | null>
): SessionSummary[] {
  return sessions.map((s) => ({
    ...s,
    contactStatus: byPhone.get(phoneLookupKey(s.phone)) ?? null,
  }));
}

export function buildWaSessionPrefix(phoneNumberId: string): string {
  const id = String(phoneNumberId ?? "").trim();
  return id ? `wa_${id}_` : "";
}

export function extractPhoneFromSessionId(sessionId: string): string {
  if (!sessionId.startsWith("wa_")) return "";
  const rest = sessionId.slice(3);
  const firstUnderscore = rest.indexOf("_");
  if (firstUnderscore < 0) return "";
  return rest.slice(firstUnderscore + 1) || "";
}

/** session_id = wa_{phone_number_id}_{leadPhone} — מונע ערבוב בין קווי וואטסאפ */
export function sessionIdMatchesWaPhoneNumberIds(sessionId: string, phoneNumberIds: string[]): boolean {
  const sid = String(sessionId ?? "").trim();
  if (!sid.startsWith("wa_")) return false;
  const ids = phoneNumberIds.map((p) => String(p ?? "").trim()).filter(Boolean);
  if (!ids.length) return false;
  return ids.some((pid) => sid.startsWith(buildWaSessionPrefix(pid)));
}

/** מזהי Meta phone_number_id של עסק מ-whatsapp_channels */
export async function resolveBusinessWaPhoneNumberIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string
): Promise<string[]> {
  const slugVariants = await resolveBusinessSlugVariants(admin, slug);
  if (!slugVariants.length) return [];

  const { data: channels } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id, business_slug")
    .in("business_slug", slugVariants);

  const ids = new Set<string>();
  for (const row of channels ?? []) {
    const id = String((row as { phone_number_id?: string }).phone_number_id ?? "").trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/** מחזיר את כל וריאציות ה-slug הרלוונטיות (כולל רישיות שונות ב-messages הישנים) */
export async function resolveBusinessSlugVariants(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string
): Promise<string[]> {
  const norm = String(slug ?? "").trim().toLowerCase();
  if (!norm) return [];

  const variants = new Set<string>([norm]);
  const { data: biz } = await admin.from("businesses").select("slug").ilike("slug", norm).limit(20);
  for (const row of biz ?? []) {
    const s = String((row as { slug?: string }).slug ?? "").trim();
    if (s) {
      variants.add(s);
      variants.add(s.toLowerCase());
    }
  }
  return [...variants];
}

export function aggregateSessionsFromMessages(
  messages: { session_id?: string | null; role?: string | null; created_at?: string | null }[],
  pausedSet: Set<string>
): SessionSummary[] {
  const bySession = new Map<string, { lastAt: Date; count: number; lastFromUser: boolean }>();

  for (const m of messages) {
    const sid = String(m.session_id ?? "anon");
    const at = new Date(String(m.created_at ?? ""));
    if (Number.isNaN(at.getTime())) continue;
    const fromUser = String(m.role ?? "") === "user";
    const existing = bySession.get(sid);
    if (!existing) {
      bySession.set(sid, { lastAt: at, count: 1, lastFromUser: fromUser });
    } else {
      existing.lastAt = at;
      existing.count += 1;
      existing.lastFromUser = fromUser;
    }
  }

  const sessions: SessionSummary[] = [...bySession.entries()].map(([sid, data]) => {
    const isOpen = data.lastFromUser && Date.now() - data.lastAt.getTime() < 24 * 60 * 60 * 1000;
    return {
      session_id: sid,
      lastAt: data.lastAt.toISOString(),
      count: data.count,
      isOpen,
      isPaused: pausedSet.has(sid),
      phone: extractPhoneFromSessionId(sid),
    };
  });

  sessions.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return sessions;
}

export async function loadBusinessConversationSessions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string
): Promise<SessionSummary[]> {
  const slugVariants = await resolveBusinessSlugVariants(admin, slug);
  if (!slugVariants.length) return [];

  const phoneNumberIds = await resolveBusinessWaPhoneNumberIds(admin, slug);
  if (!phoneNumberIds.length) return [];

  const [{ data: messages }, { data: pausedRows }] = await Promise.all([
    admin
      .from("messages")
      .select("session_id, role, created_at, business_slug")
      .in("business_slug", slugVariants)
      .order("created_at", { ascending: true })
      .limit(50_000),
    admin
      .from("paused_sessions")
      .select("session_id, paused_until, business_slug")
      .in("business_slug", slugVariants)
      .gt("paused_until", new Date().toISOString()),
  ]);

  const filteredMessages = (messages ?? []).filter((m) =>
    sessionIdMatchesWaPhoneNumberIds(String((m as { session_id?: string }).session_id ?? ""), phoneNumberIds)
  );
  const pausedSet = new Set(
    (pausedRows ?? [])
      .filter((p) =>
        sessionIdMatchesWaPhoneNumberIds(String((p as { session_id?: string }).session_id ?? ""), phoneNumberIds)
      )
      .map((p) => String((p as { session_id?: string }).session_id ?? ""))
  );
  const sessions = aggregateSessionsFromMessages(filteredMessages, pausedSet);

  const norm = String(slug ?? "").trim().toLowerCase();
  const { data: biz } = await admin.from("businesses").select("id").ilike("slug", norm).maybeSingle();
  const businessId = (biz as { id?: number } | null)?.id;
  if (!businessId) return sessions;

  const statusByPhone = await loadContactStatusByPhoneForBusiness(admin, Number(businessId));
  return enrichSessionsWithContactStatus(sessions, statusByPhone);
}
