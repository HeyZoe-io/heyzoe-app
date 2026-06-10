import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { computeContactStatus, type ContactStatusKey } from "@/lib/contact-status";
import { isLeadTemplateOnlyContact } from "@/lib/lead-template";
import { buildWaSessionId, normalizePhone } from "@/lib/phone-normalize";

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
    .select(
      "phone, opted_out, not_relevant_at, trial_registered, session_phase, source, wa_followup_stage, last_contact_at, wa_no_response_at"
    )
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

/** PostgREST מגביל ~1,000 שורות לבקשה — שליפה בדפים כדי לא לפספס הודעות חדשות. */
const MESSAGES_PAGE_SIZE = 1000;
const MESSAGES_PAGE_SAFETY_CAP = 100_000;

async function fetchAllBusinessMessagesForSessions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slugVariants: string[],
  phoneNumberIds: string[]
): Promise<{ session_id?: string | null; role?: string | null; created_at?: string | null }[]> {
  const filtered: { session_id?: string | null; role?: string | null; created_at?: string | null }[] = [];

  for (let offset = 0; offset < MESSAGES_PAGE_SAFETY_CAP; offset += MESSAGES_PAGE_SIZE) {
    const { data, error } = await admin
      .from("messages")
      .select("session_id, role, created_at, business_slug")
      .in("business_slug", slugVariants)
      .order("created_at", { ascending: true })
      .range(offset, offset + MESSAGES_PAGE_SIZE - 1);

    if (error) {
      console.warn("[conversations-sessions] messages page load:", error.message);
      break;
    }

    const batch = data ?? [];
    for (const m of batch) {
      if (sessionIdMatchesWaPhoneNumberIds(String((m as { session_id?: string }).session_id ?? ""), phoneNumberIds)) {
        filtered.push(m);
      }
    }

    if (batch.length < MESSAGES_PAGE_SIZE) break;
  }

  return filtered;
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

function appendTemplateOnlySessions(
  sessions: SessionSummary[],
  contacts: Record<string, unknown>[],
  phoneNumberIds: string[]
): SessionSummary[] {
  const primaryPid = String(phoneNumberIds[0] ?? "").trim();
  if (!primaryPid) return sessions;

  const existingPhones = new Set(sessions.map((s) => phoneLookupKey(s.phone)));
  const extra: SessionSummary[] = [];

  for (const row of contacts) {
    if (!isLeadTemplateOnlyContact(row as Parameters<typeof isLeadTemplateOnlyContact>[0])) continue;

    const phone = String((row as { phone?: string }).phone ?? "").trim();
    const key = phoneLookupKey(phone);
    if (!key || existingPhones.has(key)) continue;

    const sessionId = buildWaSessionId(primaryPid, phone);
    if (!sessionId) continue;

    const createdAt = String((row as { created_at?: string }).created_at ?? new Date().toISOString());
    extra.push({
      session_id: sessionId,
      lastAt: createdAt,
      count: 1,
      isOpen: false,
      isPaused: false,
      phone: extractPhoneFromSessionId(sessionId) || key,
      contactStatus: "template",
    });
    existingPhones.add(key);
  }

  if (!extra.length) return sessions;
  const merged = [...sessions, ...extra];
  merged.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return merged;
}

export async function loadBusinessConversationSessions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string
): Promise<SessionSummary[]> {
  const slugVariants = await resolveBusinessSlugVariants(admin, slug);
  if (!slugVariants.length) return [];

  const phoneNumberIds = await resolveBusinessWaPhoneNumberIds(admin, slug);
  if (!phoneNumberIds.length) return [];

  const norm = String(slug ?? "").trim().toLowerCase();
  const { data: biz } = await admin.from("businesses").select("id").ilike("slug", norm).maybeSingle();
  const businessId = Number((biz as { id?: number } | null)?.id ?? 0);

  const [{ data: pausedRows }, filteredMessages, { data: templateContacts }] = await Promise.all([
    admin
      .from("paused_sessions")
      .select("session_id, paused_until, business_slug")
      .in("business_slug", slugVariants)
      .gt("paused_until", new Date().toISOString()),
    fetchAllBusinessMessagesForSessions(admin, slugVariants, phoneNumberIds),
    Number.isFinite(businessId) && businessId > 0
      ? admin
          .from("contacts")
          .select(
            "phone, created_at, source, session_phase, opted_out, not_relevant_at, trial_registered, wa_followup_stage, last_contact_at, wa_no_response_at"
          )
          .eq("business_id", businessId)
          .eq("source", "meta_lead_ad")
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const pausedSet = new Set(
    (pausedRows ?? [])
      .filter((p) =>
        sessionIdMatchesWaPhoneNumberIds(String((p as { session_id?: string }).session_id ?? ""), phoneNumberIds)
      )
      .map((p) => String((p as { session_id?: string }).session_id ?? ""))
  );
  let sessions = aggregateSessionsFromMessages(filteredMessages, pausedSet);
  sessions = appendTemplateOnlySessions(sessions, (templateContacts ?? []) as Record<string, unknown>[], phoneNumberIds);

  if (!Number.isFinite(businessId) || businessId <= 0) return sessions;

  const statusByPhone = await loadContactStatusByPhoneForBusiness(admin, businessId);
  return enrichSessionsWithContactStatus(sessions, statusByPhone);
}
