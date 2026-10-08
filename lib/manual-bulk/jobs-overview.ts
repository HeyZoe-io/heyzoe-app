/**
 * «שליחות המוניות» list on the automations page.
 * One RPC per page load (supabase/manual_bulk_jobs_overview.sql): jobs, queue counts and
 * delivery counts from wa_message_statuses via the wamid stored on each sent queue row.
 * Before that SQL runs: one plain jobs read, without counts.
 * Cancel: one update of the job's pending rows + one job update. No Meta calls.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MANUAL_BULK_JOBS_PAGE = 30;
export const MANUAL_BULK_CANCELED_BY_OWNER = "canceled_by_owner";

export type ManualBulkJobStatusKey = "pending" | "sending" | "done" | "canceled";

export const MANUAL_BULK_JOB_STATUS_LABELS_HE: Record<ManualBulkJobStatusKey, string> = {
  pending: "ממתינה",
  sending: "בשליחה",
  done: "הסתיימה",
  canceled: "בוטלה",
};

/** known=false: sent before delivery statuses were stored («לא ידוע», never 0). */
export type ManualBulkJobDelivery =
  | { known: false }
  | { known: true; delivered: number; read: number; failed: number; untracked: number };

export type ManualBulkJobOverview = {
  id: string;
  created_at: string;
  created_by_email: string | null;
  from_schedule: boolean;
  audience_type: string;
  template_name: string;
  scheduled_at: string | null;
  first_sent_at: string | null;
  last_sent_at: string | null;
  recipients: number;
  /** Queue row counts. null before manual_bulk_jobs_overview.sql runs. */
  rows: { pending: number; sent: number; canceled: number; failed: number } | null;
  status: ManualBulkJobStatusKey;
  /** null when nothing was sent yet. */
  delivery: ManualBulkJobDelivery | null;
};

export type ManualBulkJobsOverviewResult = {
  jobs: ManualBulkJobOverview[];
  stats_available: boolean;
  has_more: boolean;
};

/** The business owner and Zoe admin only (not team members). */
export function canViewManualBulkJobs(input: {
  isPlatformAdmin: boolean;
  businessOwnerUserId: string | null | undefined;
  userId: string | null | undefined;
}): boolean {
  if (input.isPlatformAdmin) return true;
  const owner = String(input.businessOwnerUserId ?? "").trim();
  return Boolean(owner) && owner === String(input.userId ?? "").trim();
}

function int(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function str(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export function deriveManualBulkJobStatus(input: {
  status: unknown;
  rows: ManualBulkJobOverview["rows"];
}): ManualBulkJobStatusKey {
  const raw = String(input.status ?? "");
  if (raw === "canceled") return "canceled";
  const rows = input.rows;
  if (!rows) {
    if (raw === "sending") return "sending";
    if (raw === "done") return "done";
    return "pending";
  }
  if (rows.pending > 0) return rows.sent + rows.failed > 0 ? "sending" : "pending";
  return "done";
}

export function deriveManualBulkJobDelivery(input: {
  sent: number;
  tracked: number;
  withStatus: number;
  delivered: number;
  read: number;
  failed: number;
}): ManualBulkJobDelivery | null {
  if (input.sent <= 0) return null;
  if (input.tracked <= 0 || input.withStatus <= 0) return { known: false };
  return {
    known: true,
    delivered: input.delivered,
    read: input.read,
    failed: input.failed,
    untracked: Math.max(0, input.sent - input.tracked),
  };
}

function scheduledAtFromParams(raw: unknown): string | null {
  const params = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return str(params.scheduled_at);
}

/** One RPC row (or a plain manual_bulk_jobs row when withStats=false). */
export function normalizeManualBulkJobRow(
  row: Record<string, unknown>,
  withStats: boolean
): ManualBulkJobOverview | null {
  const id = str(row.id);
  if (!id) return null;
  const rows = withStats
    ? {
        pending: int(row.pending_rows),
        sent: int(row.sent_rows),
        canceled: int(row.canceled_rows),
        failed: int(row.failed_rows),
      }
    : null;
  const sent = rows?.sent ?? 0;
  return {
    id,
    created_at: String(row.created_at ?? ""),
    created_by_email: str(row.created_by_email),
    from_schedule: Boolean(str(row.schedule_id)),
    audience_type: String(row.audience_type ?? ""),
    template_name: String(row.template_name ?? "").trim(),
    scheduled_at: scheduledAtFromParams(row.audience_params) ?? str(row.first_due_at),
    first_sent_at: str(row.first_sent_at),
    last_sent_at: str(row.last_sent_at),
    recipients: withStats && int(row.total_rows) > 0 ? int(row.total_rows) : int(row.queued_count),
    rows,
    status: deriveManualBulkJobStatus({ status: row.status, rows }),
    delivery: withStats
      ? deriveManualBulkJobDelivery({
          sent,
          tracked: int(row.tracked_rows),
          withStatus: int(row.status_rows),
          delivered: int(row.delivered_rows),
          read: int(row.read_rows),
          failed: int(row.delivery_failed_rows),
        })
      : sent > 0
        ? { known: false }
        : null,
  };
}

export function isOpenManualBulkJob(job: ManualBulkJobOverview): boolean {
  if (job.status === "canceled" || job.status === "done") return false;
  return job.rows ? job.rows.pending > 0 : true;
}

/**
 * The Part 5 duplicate warning on the list: for each open job, the other open jobs that use
 * the same template, with how many messages they still have queued.
 */
export function pendingSameTemplateByJob(
  jobs: readonly ManualBulkJobOverview[]
): Map<string, { jobs: number; pending: number }> {
  const open = jobs.filter(isOpenManualBulkJob);
  const out = new Map<string, { jobs: number; pending: number }>();
  for (const job of open) {
    const others = open.filter((o) => o.id !== job.id && o.template_name === job.template_name);
    if (!others.length) continue;
    out.set(job.id, {
      jobs: others.length,
      pending: others.reduce((n, o) => n + (o.rows?.pending ?? 0), 0),
    });
  }
  return out;
}

export function mergeManualBulkJobs(
  current: readonly ManualBulkJobOverview[],
  next: readonly ManualBulkJobOverview[]
): ManualBulkJobOverview[] {
  const seen = new Set(current.map((j) => j.id));
  const merged = [...current, ...next.filter((j) => !seen.has(j.id))];
  return merged.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

function isMissingOverviewRpc(message: string): boolean {
  return /manual_bulk_jobs_overview|PGRST202|could not find the function/i.test(message);
}

function isMissingJobsTable(message: string): boolean {
  return /manual_bulk_jobs/i.test(message) && /does not exist|schema cache/i.test(message);
}

export async function loadManualBulkJobsOverview(
  admin: Admin,
  input: { businessId: number; offset?: number; limit?: number }
): Promise<ManualBulkJobsOverviewResult> {
  const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? MANUAL_BULK_JOBS_PAGE)));
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const { data, error } = await admin.rpc("manual_bulk_jobs_overview", {
    p_business_id: input.businessId,
    p_limit: limit,
    p_offset: offset,
  });
  if (!error) {
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    const jobs = rows
      .map((r) => normalizeManualBulkJobRow(r, true))
      .filter((j): j is ManualBulkJobOverview => Boolean(j));
    return { jobs, stats_available: true, has_more: jobs.length >= limit };
  }
  if (!isMissingOverviewRpc(error.message)) {
    console.error("[manual-bulk] jobs overview failed:", error.message, { business_id: input.businessId });
    throw new Error("jobs_overview_failed");
  }

  console.error("[manual-bulk] manual_bulk_jobs_overview missing — run supabase/manual_bulk_jobs_overview.sql");
  const plain = await admin
    .from("manual_bulk_jobs")
    .select("id, created_at, created_by, schedule_id, audience_type, audience_params, template_name, status, queued_count")
    .eq("business_id", input.businessId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (plain.error) {
    if (isMissingJobsTable(plain.error.message)) return { jobs: [], stats_available: false, has_more: false };
    console.error("[manual-bulk] jobs list failed:", plain.error.message, { business_id: input.businessId });
    throw new Error("jobs_overview_failed");
  }
  const jobs = ((plain.data ?? []) as Record<string, unknown>[])
    .map((r) => normalizeManualBulkJobRow(r, false))
    .filter((j): j is ManualBulkJobOverview => Boolean(j));
  return { jobs, stats_available: false, has_more: jobs.length >= limit };
}

/** Cancels only the job's pending rows. Sent / failed rows stay as they are. */
export async function cancelManualBulkJob(
  admin: Admin,
  input: { businessId: number; jobId: string; canceledBy: string | null }
): Promise<{ canceled: number }> {
  const jobId = String(input.jobId ?? "").trim();
  if (!jobId) throw new Error("missing_job_id");
  const { data: job, error: jobErr } = await admin
    .from("manual_bulk_jobs")
    .select("id, status")
    .eq("id", jobId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (jobErr) {
    console.error("[manual-bulk] cancel job lookup failed:", jobErr.message, { job_id: jobId });
    throw new Error("job_cancel_failed");
  }
  if (!job) throw new Error("job_not_found");

  const nowIso = new Date().toISOString();
  const { data: rows, error: qErr } = await admin
    .from("manual_bulk_queued_sends")
    .update({ status: "canceled", last_error: MANUAL_BULK_CANCELED_BY_OWNER, updated_at: nowIso })
    .eq("job_id", jobId)
    .eq("business_id", input.businessId)
    .eq("status", "pending")
    .select("id");
  if (qErr) {
    console.error("[manual-bulk] cancel pending rows failed:", qErr.message, { job_id: jobId });
    throw new Error("job_cancel_failed");
  }
  const canceled = Array.isArray(rows) ? rows.length : 0;
  const wasOpen = ["queued", "sending"].includes(String((job as { status?: unknown }).status ?? ""));
  if (canceled > 0 || wasOpen) {
    const { error: updErr } = await admin
      .from("manual_bulk_jobs")
      .update({ status: "canceled", updated_at: nowIso })
      .eq("id", jobId)
      .eq("business_id", input.businessId);
    if (updErr) {
      console.error("[manual-bulk] cancel job status failed:", updErr.message, { job_id: jobId });
      throw new Error("job_cancel_failed");
    }
  }
  console.info("[manual-bulk] job canceled", {
    business_id: input.businessId,
    job_id: jobId,
    canceled_rows: canceled,
    canceled_by: input.canceledBy,
  });
  return { canceled };
}
