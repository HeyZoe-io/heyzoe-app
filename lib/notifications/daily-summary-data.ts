import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { formatLeadPhoneDisplay, type IdleLeadRow } from "@/lib/notifications/owner-email-context";
import { sanitizeMetaOwnerTemplateParam } from "@/lib/notifications/owner-template-params";

/** מקסימום לידים ברשימה אחת בפרמטר WA (חיתוך ~900 תווים) */
const DAILY_SUMMARY_WA_LIST_LIMIT = 16;

/** בין טלפון לשם בתוך ליד אחד — לדוגמה: 0508318162 - ליאור */
export const DAILY_SUMMARY_PHONE_NAME_SEP = " - ";

/** בין לידים ברשימה — לדוגמה: ...ליאור | 0546758590 - אופיר */
export const DAILY_SUMMARY_LEADS_SEP = " | ";

export function dailySummaryDashboardUrl(businessSlug: string): string {
  const slug = String(businessSlug ?? "").trim().toLowerCase();
  if (!slug) return "https://heyzoe.io";
  return `https://heyzoe.io/${encodeURIComponent(slug)}/conversations`;
}

/** מספרים ייחודיים עם פעילות ליד אתמול (last_contact_at בחלון אתמול). */
export async function fetchConversationsHeldYesterday(input: {
  businessId: number;
  periodStartIso: string;
  periodEndIso: string;
}): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", input.businessId)
    .eq("source", "whatsapp")
    .gte("last_contact_at", input.periodStartIso)
    .lt("last_contact_at", input.periodEndIso);

  if (error) {
    console.warn("[daily-summary] conversationsHeld count failed:", error.message);
    return 0;
  }
  return Math.max(0, count ?? 0);
}

/** לידים שנרשמו אתמול (trial_registered_at בחלון). */
export type NotRelevantLeadRow = IdleLeadRow & { not_relevant_reason?: string | null };

export async function fetchNotRelevantYesterdayLeads(input: {
  businessId: number;
  periodStartIso: string;
  periodEndIso: string;
}): Promise<NotRelevantLeadRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("contacts")
    .select("full_name, phone, not_relevant_reason")
    .eq("business_id", input.businessId)
    .not("not_relevant_at", "is", null)
    .gte("not_relevant_at", input.periodStartIso)
    .lt("not_relevant_at", input.periodEndIso)
    .order("not_relevant_at", { ascending: false })
    .limit(500);

  if (error) {
    console.warn("[daily-summary] not relevant yesterday query failed:", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => ({
      full_name: String((row as { full_name?: string }).full_name ?? "").trim() || null,
      phone: String((row as { phone?: string }).phone ?? "").trim(),
      not_relevant_reason: String((row as { not_relevant_reason?: string }).not_relevant_reason ?? "").trim() || null,
    }))
    .filter((r) => r.phone);
}

export function formatDailySummaryNotRelevantLeadEntry(lead: NotRelevantLeadRow): string {
  const base = formatDailySummaryLeadEntry(lead);
  const reason = String(lead.not_relevant_reason ?? "").trim();
  return reason ? `${base} (${reason})` : base;
}

export function formatDailySummaryNotRelevantLeadListLine(leads: NotRelevantLeadRow[]): string {
  if (!leads.length) return "אין";
  const total = leads.length;
  const shown = leads.slice(0, DAILY_SUMMARY_WA_LIST_LIMIT);
  const parts = shown.map(formatDailySummaryNotRelevantLeadEntry);
  const remaining = total - shown.length;
  if (remaining > 0) parts.push(`ועוד ${remaining}`);
  return parts.join(DAILY_SUMMARY_LEADS_SEP);
}

export function formatDailySummaryNotRelevantLeadListForWa(leads: NotRelevantLeadRow[]): string {
  const line = formatDailySummaryNotRelevantLeadListLine(leads);
  if (line === "אין") return line;
  const sanitized = sanitizeMetaOwnerTemplateParam(line);
  return sanitized || "אין";
}

export async function fetchRegisteredYesterdayLeads(input: {
  businessId: number;
  periodStartIso: string;
  periodEndIso: string;
}): Promise<IdleLeadRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("contacts")
    .select("full_name, phone")
    .eq("business_id", input.businessId)
    .eq("trial_registered", true)
    .gte("trial_registered_at", input.periodStartIso)
    .lt("trial_registered_at", input.periodEndIso)
    .order("trial_registered_at", { ascending: false })
    .limit(500);

  if (error) {
    console.warn("[daily-summary] registered yesterday query failed:", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => ({
      full_name: String((row as { full_name?: string }).full_name ?? "").trim() || null,
      phone: String((row as { phone?: string }).phone ?? "").trim(),
    }))
    .filter((r) => r.phone);
}

export function formatDailySummaryLeadEntry(lead: IdleLeadRow): string {
  const phone = formatLeadPhoneDisplay(lead.phone);
  const name = String(lead.full_name ?? "").trim() || "ליד";
  return `${phone}${DAILY_SUMMARY_PHONE_NAME_SEP}${name}`;
}

/** רשימת לידים — טלפון - שם | טלפון - שם; מעל 16 לידים: | ועוד X */
export function formatDailySummaryLeadListLine(leads: IdleLeadRow[]): string {
  if (!leads.length) return "אין";
  const total = leads.length;
  const shown = leads.slice(0, DAILY_SUMMARY_WA_LIST_LIMIT);
  const parts = shown.map(formatDailySummaryLeadEntry);
  const remaining = total - shown.length;
  if (remaining > 0) {
    parts.push(`ועוד ${remaining}`);
  }
  return parts.join(DAILY_SUMMARY_LEADS_SEP);
}

export function formatDailySummaryLeadListForWa(leads: IdleLeadRow[]): string {
  const line = formatDailySummaryLeadListLine(leads);
  if (line === "אין") return line;
  const sanitized = sanitizeMetaOwnerTemplateParam(line);
  return sanitized || "אין";
}
