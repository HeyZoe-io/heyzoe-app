import { getBusinessKnowledgePack } from "@/lib/business-context";
import { formatDateDdMmYyyy } from "@/lib/email";
import { fetchLastSfServiceEventName } from "@/lib/analytics";
import { formatScheduleForOwnerNotification } from "@/lib/notifications/owner-template-params";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";

const NO_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type IdleLeadRow = {
  full_name: string | null;
  phone: string;
};

export function formatLeadPhoneDisplay(phone: string): string {
  const d = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) return `0${d.slice(3)}`;
  return phone.trim() || "—";
}

/** שם + טלפון, או טלפון בלבד אם אין שם */
export function formatLeadIdentityLine(fullName: string | null | undefined, phone: string): string {
  const name = String(fullName ?? "").trim();
  const phoneDisplay = formatLeadPhoneDisplay(phone);
  if (name) return `${name} (${phoneDisplay})`;
  return phoneDisplay;
}

export function formatRegisteredAtHe(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return formatDateDdMmYyyy(iso);
    const date = formatDateDdMmYyyy(d);
    const time = new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `${date} ${time}`;
  } catch {
    return String(iso ?? "").trim();
  }
}

export function formatScheduleLine(input: {
  requestedDate?: string | null;
  requestedTime?: string | null;
  scheduleDirectRegistration?: boolean;
}): string {
  const line = formatScheduleForOwnerNotification({
    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
  });
  if (line) return line;
  if (input.scheduleDirectRegistration === false) return "";
  return "";
}

export async function loadContactFullName(
  businessId: number,
  phone: string
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const normalized = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  const { data } = await admin
    .from("contacts")
    .select("full_name")
    .eq("business_id", businessId)
    .eq("phone", normalized)
    .maybeSingle();
  const name = String((data as { full_name?: string } | null)?.full_name ?? "").trim();
  return name || null;
}

export async function resolveServiceNameForSession(input: {
  businessSlug: string;
  sessionId: string;
  businessId: number;
}): Promise<string> {
  const fromEvent = await fetchLastSfServiceEventName({
    business_slug: input.businessSlug,
    session_id: input.sessionId,
  });
  if (fromEvent?.trim()) return fromEvent.trim();

  const pack = await getBusinessKnowledgePack(input.businessSlug);
  const first = pack?.openingServices?.[0]?.name?.trim();
  return first ?? "";
}

/** לידים ללא מענה — 24 שעות (כמו daily-no-response-email) */
export async function fetchIdleLeadsLast24h(businessId: number): Promise<IdleLeadRow[]> {
  const admin = createSupabaseAdminClient();
  const sinceIso = new Date(Date.now() - NO_RESPONSE_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from("contacts")
    .select("full_name, phone")
    .eq("business_id", businessId)
    .eq("source", "whatsapp")
    .not("wa_no_response_at", "is", null)
    .gte("wa_no_response_at", sinceIso)
    .limit(500);

  if (error) {
    if (/wa_no_response_at|column/i.test(String(error.message ?? ""))) {
      console.warn("[owner-email-context] idle leads query skipped:", error.message);
      return [];
    }
    console.warn("[owner-email-context] idle leads query failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    full_name: String((row as { full_name?: string }).full_name ?? "").trim() || null,
    phone: String((row as { phone?: string }).phone ?? "").trim(),
  })).filter((r) => r.phone);
}
