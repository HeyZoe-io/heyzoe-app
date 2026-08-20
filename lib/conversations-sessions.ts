import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { computeContactStatus, type ContactStatusKey } from "@/lib/contact-status";
import { leadConversationAt } from "@/lib/lead-activity";
import { isLeadTemplateOnlyContact } from "@/lib/lead-template";
import { buildWaSessionId, normalizePhone } from "@/lib/phone-normalize";
import {
  pickDefaultActiveChannel,
  type ActiveWaChannel,
} from "@/lib/wa-resolve-send-channel";

export function sessionRecentActivityMs(session: { lastAt?: string | null }): number {
  const at = String(session.lastAt ?? "").trim();
  if (!at) return 0;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** מיון לפי פעילות אחרונה (לא לפי סטטוס). */
export function sortSessionsByRecentActivity<T extends { lastAt?: string | null }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => sessionRecentActivityMs(b) - sessionRecentActivityMs(a));
}

export type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  /** ISO — from paused_sessions.paused_until when the session is currently paused. */
  pausedUntil?: string | null;
  phone: string;
  /** שם הליד מ-contacts.full_name */
  fullName?: string | null;
  /** סטטוס ליד מטבלת contacts (אותה לוגיקה כמו בדף אנשי קשר) */
  contactStatus?: ContactStatusKey | null;
};

function phoneLookupKey(phone: string): string {
  const p = String(phone ?? "").trim();
  return normalizePhone(p) ?? p.replace(/\D/g, "");
}

type ContactPhoneMeta = {
  status: ContactStatusKey | null;
  fullName: string | null;
  lastContactAt: string | null;
};

const CONTACT_META_PAGE = 1000;
const CONTACT_META_CAP = 2000;
const TEMPLATE_CONTACTS_CAP = 400;
const SESSION_LIST_CAP = 500;
const FALLBACK_MESSAGE_PAGE = 1000;
const FALLBACK_MESSAGE_PAGES = 4;

function mergeContactMetaRow(
  map: Map<string, ContactPhoneMeta>,
  row: Record<string, unknown>
): void {
  const phone = String((row as { phone?: string }).phone ?? "").trim();
  const key = phoneLookupKey(phone);
  if (!key) return;
  const fullName = String((row as { full_name?: string | null }).full_name ?? "").trim();
  const lastContactAt = leadConversationAt(row as Parameters<typeof leadConversationAt>[0]);
  const next: ContactPhoneMeta = {
    status: computeContactStatus(row as Parameters<typeof computeContactStatus>[0]),
    fullName: fullName || null,
    lastContactAt,
  };
  const prev = map.get(key);
  if (!prev) {
    map.set(key, next);
    return;
  }
  const prevAt = sessionRecentActivityMs({ lastAt: prev.lastContactAt });
  const rowAt = sessionRecentActivityMs({ lastAt: lastContactAt });
  map.set(key, rowAt >= prevAt ? next : prev);
}

async function loadContactMetaByPhoneForBusiness(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<Map<string, ContactPhoneMeta>> {
  const map = new Map<string, ContactPhoneMeta>();
  for (let off = 0; off < CONTACT_META_CAP; off += CONTACT_META_PAGE) {
    const { data, error } = await admin
      .from("contacts")
      .select(
        "phone, full_name, opted_out, not_relevant_at, human_requested_at, trial_registered, session_phase, source, wa_followup_stage, last_contact_at, wa_no_response_at"
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .range(off, off + CONTACT_META_PAGE - 1);

    if (error) {
      console.warn("[conversations-sessions] contacts meta load:", error.message);
      break;
    }
    const rows = data ?? [];
    for (const row of rows) mergeContactMetaRow(map, row as Record<string, unknown>);
    if (rows.length < CONTACT_META_PAGE) break;
  }
  return map;
}

async function fetchRecentMessagesForSessions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slugVariants: string[],
  phoneNumberIds: string[]
): Promise<{ session_id?: string | null; role?: string | null; created_at?: string | null }[]> {
  const filtered: { session_id?: string | null; role?: string | null; created_at?: string | null }[] = [];
  for (let page = 0; page < FALLBACK_MESSAGE_PAGES; page += 1) {
    const from = page * FALLBACK_MESSAGE_PAGE;
    const to = from + FALLBACK_MESSAGE_PAGE - 1;
    const { data, error } = await admin
      .from("messages")
      .select("session_id, role, created_at")
      .in("business_slug", slugVariants)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.warn("[conversations-sessions] recent messages fallback:", error.message);
      break;
    }
    const batch = data ?? [];
    for (const m of batch) {
      if (sessionIdMatchesWaPhoneNumberIds(String((m as { session_id?: string }).session_id ?? ""), phoneNumberIds)) {
        filtered.push(m);
      }
    }
    if (batch.length < FALLBACK_MESSAGE_PAGE) break;
  }
  return filtered;
}

function enrichSessionsWithContactMeta(
  sessions: SessionSummary[],
  byPhone: Map<string, ContactPhoneMeta>
): SessionSummary[] {
  const enriched = sessions.map((s) => {
    const meta = byPhone.get(phoneLookupKey(s.phone));
    const contactAt = meta?.lastContactAt ?? null;
    const messageAt = s.lastAt;
    const lastAt =
      contactAt && sessionRecentActivityMs({ lastAt: contactAt }) > sessionRecentActivityMs({ lastAt: messageAt })
        ? contactAt
        : messageAt;
    return {
      ...s,
      fullName: meta?.fullName ?? s.fullName ?? null,
      contactStatus: meta?.status ?? null,
      lastAt,
    };
  });
  return sortSessionsByRecentActivity(enriched);
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

function pausedUntilBySessionFromRows(
  rows: { session_id?: string; paused_until?: string }[] | null | undefined,
  keepSessionId?: (sessionId: string) => boolean
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of rows ?? []) {
    const sid = String((p as { session_id?: string }).session_id ?? "").trim();
    const until = String((p as { paused_until?: string }).paused_until ?? "").trim();
    if (!sid || !until) continue;
    if (keepSessionId && !keepSessionId(sid)) continue;
    const prev = map.get(sid);
    if (!prev || until > prev) map.set(sid, until);
  }
  return map;
}

/**
 * Owner dashboard: current WhatsApp line only (newest active channel).
 * Historical / stale numbers stay out of the conversation list even if still marked active.
 */
export function phoneNumberIdsForOwnerDashboard(channels: ActiveWaChannel[]): string[] {
  const picked = pickDefaultActiveChannel(channels);
  return picked?.phoneNumberId ? [picked.phoneNumberId] : [];
}

/** מזהה Meta phone_number_id של קו הוואטסאפ הנוכחי מ-whatsapp_channels */
export async function resolveBusinessWaPhoneNumberIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string
): Promise<string[]> {
  const slugVariants = await resolveBusinessSlugVariants(admin, slug);
  if (!slugVariants.length) return [];

  const { data: channels } = await admin
    .from("whatsapp_channels")
    .select("id, phone_number_id, business_slug, created_at, is_active")
    .in("business_slug", slugVariants)
    .eq("is_active", true);

  const active: ActiveWaChannel[] = [];
  for (const row of channels ?? []) {
    const phoneNumberId = String((row as { phone_number_id?: string }).phone_number_id ?? "").trim();
    if (!phoneNumberId) continue;
    const channelId = Number((row as { id?: unknown }).id);
    active.push({
      id: Number.isFinite(channelId) ? channelId : 0,
      phoneNumberId,
      businessSlug: String((row as { business_slug?: string }).business_slug ?? "")
        .trim()
        .toLowerCase(),
      createdAt: String((row as { created_at?: string }).created_at ?? "").trim(),
    });
  }
  return phoneNumberIdsForOwnerDashboard(active);
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
  pausedUntilBySession: Map<string, string> = new Map()
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
    const pausedUntil = pausedUntilBySession.get(sid) ?? null;
    return {
      session_id: sid,
      lastAt: data.lastAt.toISOString(),
      count: data.count,
      isOpen,
      isPaused: Boolean(pausedUntil),
      pausedUntil,
      phone: extractPhoneFromSessionId(sid),
    };
  });

  return sortSessionsByRecentActivity(sessions);
}

function appendTemplateOnlySessions(
  sessions: SessionSummary[],
  contacts: Record<string, unknown>[],
  phoneNumberIds: string[],
  pausedUntilBySession: Map<string, string>
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

    const lastAt =
      leadConversationAt(row as Parameters<typeof leadConversationAt>[0]) ??
      new Date().toISOString();
    const fullName = String((row as { full_name?: string | null }).full_name ?? "").trim();
    const pausedUntil = pausedUntilBySession.get(sessionId) ?? null;
    extra.push({
      session_id: sessionId,
      lastAt,
      count: 1,
      isOpen: false,
      isPaused: Boolean(pausedUntil),
      pausedUntil,
      phone: extractPhoneFromSessionId(sessionId) || key,
      fullName: fullName || null,
      contactStatus: "template",
    });
    existingPhones.add(key);
  }

  if (!extra.length) return sessions;
  return sortSessionsByRecentActivity([...sessions, ...extra]);
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

  const [{ data: pausedRows }, recentMessages, { data: templateContacts }] = await Promise.all([
    admin
      .from("paused_sessions")
      .select("session_id, paused_until, business_slug")
      .in("business_slug", slugVariants)
      .gt("paused_until", new Date().toISOString()),
    fetchRecentMessagesForSessions(admin, slugVariants, phoneNumberIds),
    Number.isFinite(businessId) && businessId > 0
      ? admin
          .from("contacts")
          .select(
            "phone, full_name, created_at, source, session_phase, opted_out, not_relevant_at, human_requested_at, trial_registered, wa_followup_stage, last_contact_at, wa_no_response_at"
          )
          .eq("business_id", businessId)
          .in("source", ["meta_lead_ad", "site_lead"])
          .order("created_at", { ascending: false })
          .limit(TEMPLATE_CONTACTS_CAP)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const pausedUntilBySession = pausedUntilBySessionFromRows(pausedRows as { session_id?: string; paused_until?: string }[] | null, (sid) =>
    sessionIdMatchesWaPhoneNumberIds(sid, phoneNumberIds)
  );
  let sessions = aggregateSessionsFromMessages(recentMessages, pausedUntilBySession).slice(0, SESSION_LIST_CAP);
  sessions = appendTemplateOnlySessions(
    sessions,
    (templateContacts ?? []) as Record<string, unknown>[],
    phoneNumberIds,
    pausedUntilBySession
  ).slice(0, SESSION_LIST_CAP);

  if (!Number.isFinite(businessId) || businessId <= 0) return sessions;

  const metaByPhone = await loadContactMetaByPhoneForBusiness(admin, businessId);
  return enrichSessionsWithContactMeta(sessions, metaByPhone).slice(0, SESSION_LIST_CAP);
}
