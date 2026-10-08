/**
 * Legacy /api/leads/incoming fallback (businesses.lead_template_name, no rule; Sanga / Zapier).
 * One opening template per business + phone per 24 hours, claimed before the Graph call.
 * IO per webhook: one indexed read (business_id, phone, processed_at) + the claim insert + the settle.
 * Before incoming_lead_fallback_send_log.sql runs, the read fails with a missing table and the
 * route keeps the old unclaimed send (logged), so Sanga is not cut off.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { formatDateYmdIsrael } from "@/lib/leads/arbox-trial-attended";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const INCOMING_FALLBACK_LOG = "incoming_lead_fallback_send_log";
export const INCOMING_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A send that may have reached the lead closes the 24h window. */
const WINDOW_STATUSES = ["sent", "sending", "unknown"];

export function incomingFallbackClaimKey(
  businessId: number,
  phone: string,
  templateName: string,
  now: Date,
  attempts = 0
): { table: string; row: Record<string, unknown>; filters: Array<[string, string | number]> } {
  const sentDay = formatDateYmdIsrael(now);
  return {
    table: INCOMING_FALLBACK_LOG,
    row: {
      business_id: businessId,
      phone,
      sent_day: sentDay,
      template_name: templateName,
      attempts,
      processed_at: now.toISOString(),
    },
    filters: [
      ["business_id", businessId],
      ["phone", phone],
      ["sent_day", sentDay],
    ],
  };
}

/**
 * Last 24h for this business + phone.
 * blocked: an opening template already went out (or may have).
 * attempts: Meta failures on today's row, so the claim reaches the cap.
 * missing_table: the SQL has not run yet.
 */
export async function incomingFallbackWindow(
  admin: Admin,
  businessId: number,
  phone: string,
  now: Date
): Promise<{ state: "open"; attempts: number } | { state: "blocked" } | { state: "missing_table" } | { state: "error"; error: string }> {
  const since = new Date(now.getTime() - INCOMING_FALLBACK_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from(INCOMING_FALLBACK_LOG)
    .select("status, attempts, sent_day, processed_at")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .gte("processed_at", since)
    .order("processed_at", { ascending: false })
    .limit(5);
  if (error) {
    if (/does not exist|42P01|PGRST205|schema cache/i.test(error.message)) return { state: "missing_table" };
    return { state: "error", error: error.message };
  }
  const rows = (data ?? []) as Array<{ status?: unknown; attempts?: unknown; sent_day?: unknown }>;
  if (rows.some((row) => WINDOW_STATUSES.includes(String(row.status ?? "")))) return { state: "blocked" };
  const today = formatDateYmdIsrael(now);
  const todayRow = rows.find((row) => String(row.sent_day ?? "") === today);
  return { state: "open", attempts: Math.max(0, Math.trunc(Number(todayRow?.attempts) || 0)) };
}
