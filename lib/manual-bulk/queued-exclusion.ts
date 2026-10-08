/**
 * Cross-job duplicate guard for manual bulk sends.
 * A recipient with a pending or sent row for the same template in ANY bulk job of the business
 * is left out of the new audience. Matched by recipient_key and by phone (last 9 digits), since
 * the same person can carry a different key in another audience type.
 * Weekly jobs (skipAlreadySentLog) still re-send every week: there only pending rows and rows
 * sent in the last RECURRING_SENT_LOOKBACK_DAYS count.
 *
 * IO: one paged read per preview / enqueue on (business_id, template_name, status)
 * (supabase/wa_template_send_claims.sql). No Meta calls.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const RECURRING_SENT_LOOKBACK_DAYS = 6;
const PAGE = 1000;
const MAX_PAGES = 50;

export type QueuedRecipients = {
  keys: Set<string>;
  phones: Set<string>;
  pendingJobs: Array<{ job_id: string; pending: number; first_due_at: string | null }>;
};

export function bulkPhoneTail(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

export function foldQueuedRows(
  rows: ReadonlyArray<Record<string, unknown>>
): QueuedRecipients {
  const keys = new Set<string>();
  const phones = new Set<string>();
  const jobs = new Map<string, { job_id: string; pending: number; first_due_at: string | null }>();
  for (const row of rows) {
    const key = String(row.recipient_key ?? "").trim();
    const tail = bulkPhoneTail(row.contact_phone);
    if (key) keys.add(key);
    if (tail) phones.add(tail);
    if (String(row.status ?? "") !== "pending") continue;
    const jobId = String(row.job_id ?? "").trim();
    if (!jobId) continue;
    const due = String(row.due_at ?? "").trim() || null;
    const job = jobs.get(jobId) ?? { job_id: jobId, pending: 0, first_due_at: null };
    job.pending += 1;
    if (due && (!job.first_due_at || due < job.first_due_at)) job.first_due_at = due;
    jobs.set(jobId, job);
  }
  return { keys, phones, pendingJobs: [...jobs.values()] };
}

export async function loadQueuedOrSentRecipients(
  admin: Admin,
  input: { businessId: number; templateName: string; recurring: boolean; now?: Date }
): Promise<QueuedRecipients> {
  const since = new Date(
    (input.now ?? new Date()).getTime() - RECURRING_SENT_LOOKBACK_DAYS * 24 * 36e5
  ).toISOString();
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = admin
      .from("manual_bulk_queued_sends")
      .select("job_id, recipient_key, contact_phone, status, due_at")
      .eq("business_id", input.businessId)
      .eq("template_name", input.templateName);
    query = input.recurring
      ? query.or(`status.eq.pending,and(status.eq.sent,updated_at.gte.${since})`)
      : query.in("status", ["pending", "sent"]);
    const { data, error } = await query.order("id", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      if (/does not exist|schema cache|manual_bulk_queued_sends/i.test(error.message)) break;
      console.error("[manual-bulk] queued-sends lookup failed:", error.message);
      throw new Error("queued_sends_lookup_failed");
    }
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return foldQueuedRows(rows);
}

/** Drops recipients already pending / sent for this template. Returns how many were removed. */
export function excludeQueuedRecipients<R extends { recipientKey: string; phone: string | null }>(
  audience: { withPhone: R[]; withoutPhone: R[] },
  queued: Pick<QueuedRecipients, "keys" | "phones">
): number {
  let removed = 0;
  const keep = (r: R) => {
    const tail = bulkPhoneTail(r.phone);
    const hit = queued.keys.has(r.recipientKey) || (tail !== "" && queued.phones.has(tail));
    if (hit) removed += 1;
    return !hit;
  };
  audience.withPhone = audience.withPhone.filter(keep);
  audience.withoutPhone = audience.withoutPhone.filter(keep);
  return removed;
}
