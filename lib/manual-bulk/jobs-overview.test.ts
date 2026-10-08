import assert from "node:assert/strict";
import {
  canViewManualBulkJobs,
  cancelManualBulkJob,
  deriveManualBulkJobDelivery,
  deriveManualBulkJobStatus,
  isOpenManualBulkJob,
  loadManualBulkJobsOverview,
  MANUAL_BULK_CANCELED_BY_OWNER,
  mergeManualBulkJobs,
  normalizeManualBulkJobRow,
  pendingSameTemplateByJob,
  type ManualBulkJobOverview,
} from "./jobs-overview";

function rpcRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "j1",
    created_at: "2026-10-08T06:00:00Z",
    created_by: "u1",
    created_by_email: "owner@example.com",
    schedule_id: null,
    audience_type: "membership",
    audience_params: { scheduled_at: "2026-10-09T06:00:00.000Z" },
    template_name: "promo_oct",
    status: "queued",
    queued_count: 10,
    total_rows: 10,
    pending_rows: 10,
    sent_rows: 0,
    canceled_rows: 0,
    failed_rows: 0,
    first_due_at: "2026-10-09T06:00:00Z",
    first_sent_at: null,
    last_sent_at: null,
    tracked_rows: 0,
    status_rows: 0,
    delivered_rows: 0,
    read_rows: 0,
    delivery_failed_rows: 0,
    ...over,
  };
}

function job(over: Record<string, unknown> = {}): ManualBulkJobOverview {
  return normalizeManualBulkJobRow(rpcRow(over), true)!;
}

async function main() {
  // Access: owner and admin only
  assert.equal(canViewManualBulkJobs({ isPlatformAdmin: true, businessOwnerUserId: "u1", userId: "u9" }), true);
  assert.equal(canViewManualBulkJobs({ isPlatformAdmin: false, businessOwnerUserId: "u1", userId: "u1" }), true);
  assert.equal(canViewManualBulkJobs({ isPlatformAdmin: false, businessOwnerUserId: "u1", userId: "u2" }), false);
  assert.equal(canViewManualBulkJobs({ isPlatformAdmin: false, businessOwnerUserId: "", userId: "" }), false);

  // Status from queue rows
  const rows = (p: number, s: number, c = 0, f = 0) => ({ pending: p, sent: s, canceled: c, failed: f });
  assert.equal(deriveManualBulkJobStatus({ status: "queued", rows: rows(10, 0) }), "pending");
  assert.equal(deriveManualBulkJobStatus({ status: "sending", rows: rows(4, 6) }), "sending");
  assert.equal(deriveManualBulkJobStatus({ status: "queued", rows: rows(4, 0, 0, 1) }), "sending");
  assert.equal(deriveManualBulkJobStatus({ status: "sending", rows: rows(0, 10) }), "done");
  assert.equal(deriveManualBulkJobStatus({ status: "queued", rows: rows(0, 0) }), "done");
  assert.equal(deriveManualBulkJobStatus({ status: "canceled", rows: rows(0, 3, 7) }), "canceled");
  assert.equal(deriveManualBulkJobStatus({ status: "queued", rows: null }), "pending");
  assert.equal(deriveManualBulkJobStatus({ status: "done", rows: null }), "done");

  // Delivery: nothing sent → null; sent without wamid or without any status → unknown, never 0
  const base = { delivered: 0, read: 0, failed: 0 };
  assert.equal(deriveManualBulkJobDelivery({ sent: 0, tracked: 0, withStatus: 0, ...base }), null);
  assert.deepEqual(deriveManualBulkJobDelivery({ sent: 50, tracked: 0, withStatus: 0, ...base }), { known: false });
  assert.deepEqual(deriveManualBulkJobDelivery({ sent: 50, tracked: 50, withStatus: 0, ...base }), { known: false });
  assert.deepEqual(
    deriveManualBulkJobDelivery({ sent: 50, tracked: 48, withStatus: 48, delivered: 45, read: 30, failed: 3 }),
    { known: true, delivered: 45, read: 30, failed: 3, untracked: 2 }
  );

  // Row normalization
  {
    const j = job({ status: "done", pending_rows: 0, sent_rows: 10, first_sent_at: "2026-10-09T06:00:05Z", last_sent_at: "2026-10-09T06:01:00Z" });
    assert.equal(j.status, "done");
    assert.equal(j.scheduled_at, "2026-10-09T06:00:00.000Z");
    assert.equal(j.recipients, 10);
    assert.equal(j.created_by_email, "owner@example.com");
    assert.deepEqual(j.delivery, { known: false });
    assert.equal(isOpenManualBulkJob(j), false);
  }
  {
    const old = normalizeManualBulkJobRow(
      { id: "j0", created_at: "2026-09-01T06:00:00Z", status: "done", template_name: "x", queued_count: 7, audience_params: {}, schedule_id: "s1" },
      false
    )!;
    assert.equal(old.rows, null);
    assert.equal(old.recipients, 7);
    assert.equal(old.from_schedule, true);
    assert.equal(old.scheduled_at, null);
    assert.equal(old.delivery, null);
  }
  assert.equal(normalizeManualBulkJobRow({ id: "" }, true), null);

  // Duplicate warning: open jobs with the same template only
  {
    const a = job({ id: "a", pending_rows: 10 });
    const b = job({ id: "b", pending_rows: 4, sent_rows: 2, status: "sending" });
    const c = job({ id: "c", template_name: "other", pending_rows: 3 });
    const d = job({ id: "d", status: "done", pending_rows: 0, sent_rows: 9 });
    const e = job({ id: "e", status: "canceled", pending_rows: 0, canceled_rows: 5 });
    const dup = pendingSameTemplateByJob([a, b, c, d, e]);
    assert.deepEqual(dup.get("a"), { jobs: 1, pending: 4 });
    assert.deepEqual(dup.get("b"), { jobs: 1, pending: 10 });
    assert.equal(dup.has("c"), false);
    assert.equal(dup.has("d"), false);
    assert.equal(dup.has("e"), false);
  }

  // Merge: dedupe by id, newest first
  {
    const merged = mergeManualBulkJobs(
      [job({ id: "n", created_at: "2026-10-08T00:00:00Z" }), job({ id: "o", created_at: "2026-09-01T00:00:00Z" })],
      [job({ id: "o", created_at: "2026-09-01T00:00:00Z" }), job({ id: "m", created_at: "2026-09-15T00:00:00Z" })]
    );
    assert.deepEqual(merged.map((j) => j.id), ["n", "m", "o"]);
  }

  // Loader: one RPC; falls back to a plain list (no counts) when the RPC is not there yet
  {
    const calls: string[] = [];
    const admin = {
      rpc: async (name: string) => {
        calls.push(`rpc:${name}`);
        return { data: [rpcRow()], error: null };
      },
      from: () => {
        calls.push("from");
        throw new Error("no plain query expected");
      },
    };
    const res = await loadManualBulkJobsOverview(admin as never, { businessId: 3543 });
    assert.deepEqual(calls, ["rpc:manual_bulk_jobs_overview"]);
    assert.equal(res.stats_available, true);
    assert.equal(res.jobs.length, 1);
  }
  {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: async () => ({ data: [{ id: "j0", status: "sending", template_name: "x", queued_count: 3 }], error: null }),
    };
    const admin = {
      rpc: async () => ({ data: null, error: { message: "Could not find the function public.manual_bulk_jobs_overview" } }),
      from: () => chain,
    };
    const origError = console.error;
    console.error = () => {};
    const res = await loadManualBulkJobsOverview(admin as never, { businessId: 3543 });
    console.error = origError;
    assert.equal(res.stats_available, false);
    assert.equal(res.jobs[0]?.status, "sending");
    assert.equal(res.jobs[0]?.rows, null);
  }

  // Cancel: only the job's pending rows, scoped to the business; job → canceled
  {
    const updates: Array<{ table: string; patch: Record<string, unknown>; filters: string[] }> = [];
    const admin = {
      from(table: string) {
        const filters: string[] = [];
        let patch: Record<string, unknown> | null = null;
        const q = {
          select: () => q,
          update: (p: Record<string, unknown>) => {
            patch = p;
            return q;
          },
          eq: (col: string, val: unknown) => {
            filters.push(`${col}=${String(val)}`);
            return q;
          },
          maybeSingle: async () => ({ data: { id: "j1", status: "sending" }, error: null }),
          then(resolve: (v: unknown) => void) {
            if (patch) updates.push({ table, patch, filters: [...filters] });
            const data = table === "manual_bulk_queued_sends" ? [{ id: "r1" }, { id: "r2" }] : null;
            resolve({ data, error: null });
          },
        };
        return q;
      },
    };
    const res = await cancelManualBulkJob(admin as never, { businessId: 3543, jobId: "j1", canceledBy: "u1" });
    assert.equal(res.canceled, 2);
    const rowUpd = updates.find((u) => u.table === "manual_bulk_queued_sends")!;
    assert.equal(rowUpd.patch.status, "canceled");
    assert.equal(rowUpd.patch.last_error, MANUAL_BULK_CANCELED_BY_OWNER);
    assert.deepEqual(rowUpd.filters, ["job_id=j1", "business_id=3543", "status=pending"]);
    const jobUpd = updates.find((u) => u.table === "manual_bulk_jobs")!;
    assert.equal(jobUpd.patch.status, "canceled");
    assert.deepEqual(jobUpd.filters, ["id=j1", "business_id=3543"]);
  }
  {
    const admin = {
      from() {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return q;
      },
    };
    await assert.rejects(
      cancelManualBulkJob(admin as never, { businessId: 1, jobId: "other-business-job", canceledBy: null }),
      /job_not_found/
    );
  }

  console.log("jobs-overview tests passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
