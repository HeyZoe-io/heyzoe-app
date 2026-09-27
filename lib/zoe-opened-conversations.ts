/**
 * שיחות שנפתחו = מספרים ייחודיים שזואי דיברה איתם בחודש הקלנדרי (ישראל).
 * הודעה אחת מספיקה; כמות ההודעות לא משנה.
 * שיחה שנוהלה רק כשזואי כבויה (אין הודעת assistant של זואי) לא נספרת.
 * נציג אנושי (wa_business_app / manual_handoff) ותבנית (lead_template) לא נספרים.
 *
 * IO לדשבורד: COUNT ממוקד על contacts לפי (business_id, last_zoe_reply_at) — לא סריקת messages.
 * IO לכל הודעת זואי: עדכון שורה אחת ב-contacts (אחרי חיפוש business id שממוזער בזיכרון).
 * בלי העמודה: נפילה חד-פעמית לסריקה חסומה של הודעות assistant מהחודש (לא cron, לא טבלה שלמה).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getIsraelMonthStartUtc } from "@/lib/israel-time";
import { isZoeAssistantModel } from "@/lib/leads/no-response-audience";
import {
  canonicalContactPhone,
  contactPhoneLookupVariants,
  waSessionIdParts,
} from "@/lib/phone-normalize";

/** תואם ל-STARTER_MONTHLY_CONTACT_LIMIT ב-conversation-quota ולעמוד החיוב. */
export const STARTER_MONTHLY_CONVERSATION_LIMIT = 100;
export const PRO_MONTHLY_CONVERSATION_LIMIT = 500;

const MESSAGE_PAGE = 1000;
/** תקרת בטיחות לפני שהמיגרציה רצה. 12k הודעות assistant בחודש לעסק אחד. */
const MESSAGE_SCAN_MAX_PAGES = 12;

const businessIdBySlug = new Map<string, number>();
let missingColumnLogged = false;

export function countsAsOpenedZoeConversation(model: string | null | undefined): boolean {
  return isZoeAssistantModel(model);
}

export function monthlyConversationLimitForPlan(plan: unknown): number {
  const p = String(plan ?? "").trim().toLowerCase();
  if (p === "premium" || p === "pro" || p === "intro") return PRO_MONTHLY_CONVERSATION_LIMIT;
  return STARTER_MONTHLY_CONVERSATION_LIMIT;
}

/** תחילת החודש הקלנדרי בישראל — אותו חלון כמו מכסת החבילה. */
export function openedConversationsSinceIso(now: Date = new Date()): string {
  return getIsraelMonthStartUtc(now).toISOString();
}

/** מפתח מספר אחד ל-session, בלי קשר לכמה קווי וואטסאפ או לכמות ההודעות. */
export function openedConversationPhoneKey(sessionId: string | null | undefined): string | null {
  const parts = waSessionIdParts(String(sessionId ?? ""));
  if (!parts?.phone) return null;
  const canonical = canonicalContactPhone(parts.phone);
  if (canonical) return canonical;
  const digits = parts.phone.replace(/\D/g, "");
  return digits || null;
}

function logMissingColumn(where: string, message: string) {
  if (missingColumnLogged) return;
  missingColumnLogged = true;
  console.error(
    `[zoe-opened] missing contacts.last_zoe_reply_at (${where}) — run supabase/contacts_last_zoe_reply_at.sql:`,
    message
  );
}

async function resolveBusinessId(admin: SupabaseClient, slug: string): Promise<number | null> {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  const cached = businessIdBySlug.get(key);
  if (cached != null) return cached;
  const { data, error } = await admin.from("businesses").select("id").eq("slug", key).maybeSingle();
  if (error) {
    console.warn("[zoe-opened] business lookup:", error.message);
    return null;
  }
  const id = Number((data as { id?: unknown } | null)?.id);
  if (!Number.isFinite(id)) return null;
  businessIdBySlug.set(key, id);
  return id;
}

/** אחרי הודעת assistant של זואי — כדי שהדשבורד יישאר על אינדקס ולא יסרוק messages. */
export async function touchContactLastZoeReply(input: {
  admin: SupabaseClient;
  businessSlug: string;
  sessionId?: string | null;
  modelUsed?: string | null;
}): Promise<void> {
  try {
    if (!countsAsOpenedZoeConversation(input.modelUsed)) return;
    const phoneKey = openedConversationPhoneKey(input.sessionId);
    const variants = contactPhoneLookupVariants(phoneKey ?? "");
    if (!variants.length) return;
    const businessId = await resolveBusinessId(input.admin, input.businessSlug);
    if (businessId == null) return;
    const { error } = await input.admin
      .from("contacts")
      .update({ last_zoe_reply_at: new Date().toISOString() })
      .eq("business_id", businessId)
      .in("phone", variants);
    if (!error) return;
    if (/last_zoe_reply_at/i.test(error.message)) {
      logMissingColumn("touch", error.message);
      return;
    }
    console.warn("[zoe-opened] touch failed:", error.message);
  } catch (e) {
    console.error("[zoe-opened] touch failed:", e);
  }
}

async function countOpenedZoeConversationsFromMessages(
  admin: SupabaseClient,
  businessSlug: string,
  sinceIso: string
): Promise<number> {
  const slug = businessSlug.trim().toLowerCase();
  const phones = new Set<string>();
  for (let page = 0; page < MESSAGE_SCAN_MAX_PAGES; page += 1) {
    const from = page * MESSAGE_PAGE;
    const { data, error } = await admin
      .from("messages")
      .select("session_id, model_used")
      .eq("business_slug", slug)
      .eq("role", "assistant")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, from + MESSAGE_PAGE - 1);
    if (error) {
      console.error("[zoe-opened] messages scan failed:", error.message);
      return phones.size;
    }
    const rows = data ?? [];
    for (const row of rows) {
      const model = (row as { model_used?: string | null }).model_used;
      if (!countsAsOpenedZoeConversation(model)) continue;
      const phone = openedConversationPhoneKey((row as { session_id?: string | null }).session_id);
      if (phone) phones.add(phone);
    }
    if (rows.length < MESSAGE_PAGE) return phones.size;
  }
  console.warn("[zoe-opened] messages scan hit page cap; count may be low until migration runs:", slug);
  return phones.size;
}

export async function countOpenedZoeConversations(input: {
  admin: SupabaseClient;
  businessId: number;
  businessSlug: string;
  now?: Date;
}): Promise<number> {
  const since = openedConversationsSinceIso(input.now);
  const { count, error } = await input.admin
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", input.businessId)
    .gte("last_zoe_reply_at", since);
  if (!error) return Number(count ?? 0) || 0;
  if (/last_zoe_reply_at/i.test(error.message)) {
    logMissingColumn("count", error.message);
    return countOpenedZoeConversationsFromMessages(input.admin, input.businessSlug, since);
  }
  console.warn("[zoe-opened] count failed:", error.message);
  return 0;
}
