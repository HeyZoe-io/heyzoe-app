"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { formatIsraelWallDateTimeHe } from "@/lib/manual-bulk/schedule";
import {
  isOpenManualBulkJob,
  MANUAL_BULK_JOB_STATUS_LABELS_HE,
  MANUAL_BULK_JOBS_PAGE,
  mergeManualBulkJobs,
  pendingSameTemplateByJob,
  type ManualBulkJobOverview,
  type ManualBulkJobStatusKey,
  type ManualBulkJobsOverviewResult,
} from "@/lib/manual-bulk/jobs-overview";

const AUDIENCE_LABELS_HE: Record<string, string> = {
  membership: "מנויים",
  talked_not_registered: "דיברו ולא נרשמו",
};

const STATUS_BADGE: Record<ManualBulkJobStatusKey, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  sending: "border-sky-200 bg-sky-50 text-sky-800",
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
  canceled: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? formatIsraelWallDateTimeHe(d) : "—";
}

function sentWindow(job: ManualBulkJobOverview): string | null {
  if (!job.first_sent_at) return null;
  const first = when(job.first_sent_at);
  const last = when(job.last_sent_at);
  return first === last ? first : `${first} – ${last}`;
}

function DeliveryLine({ job }: { job: ManualBulkJobOverview }) {
  const d = job.delivery;
  if (!d) return null;
  if (!d.known) {
    return (
      <p className="text-xs text-zinc-600">
        נמסרו: <span className="font-medium">לא ידוע</span> · נקראו: <span className="font-medium">לא ידוע</span> ·
        נכשלו: <span className="font-medium">לא ידוע</span>
      </p>
    );
  }
  return (
    <p className="text-xs text-zinc-700">
      נמסרו: <span className="font-semibold text-emerald-700">{d.delivered}</span> · נקראו:{" "}
      <span className="font-semibold text-sky-700">{d.read}</span> · נכשלו:{" "}
      <span className={`font-semibold ${d.failed > 0 ? "text-red-700" : "text-zinc-700"}`}>{d.failed}</span>
      {d.untracked > 0 ? <span className="text-zinc-500"> · {d.untracked} בלי מעקב מסירה</span> : null}
    </p>
  );
}

export default function BulkJobsSection(props: {
  slug: string;
  initial: ManualBulkJobsOverviewResult | null;
  templateBodies: Record<string, string>;
}) {
  const [jobs, setJobs] = useState<ManualBulkJobOverview[]>(props.initial?.jobs ?? []);
  const [statsAvailable, setStatsAvailable] = useState(props.initial?.stats_available ?? true);
  const [hasMore, setHasMore] = useState(props.initial?.has_more ?? false);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState<"refresh" | "more" | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [openBodyId, setOpenBodyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(props.initial ? null : "לא הצלחנו לטעון את השליחות.");
  const [notice, setNotice] = useState<string | null>(null);

  const duplicates = useMemo(() => pendingSameTemplateByJob(jobs), [jobs]);

  async function fetchPage(offset: number): Promise<ManualBulkJobsOverviewResult> {
    const res = await fetch(`/api/${encodeURIComponent(props.slug)}/bulk-send/jobs?offset=${offset}`, {
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Partial<ManualBulkJobsOverviewResult> & { error?: string };
    if (!res.ok) throw new Error(j.error || "jobs_load_failed");
    return { jobs: j.jobs ?? [], stats_available: j.stats_available ?? false, has_more: j.has_more ?? false };
  }

  async function refresh() {
    setBusy("refresh");
    setError(null);
    try {
      const page = await fetchPage(0);
      setJobs(page.jobs);
      setPages(1);
      setStatsAvailable(page.stats_available);
      setHasMore(page.has_more);
    } catch {
      setError("לא הצלחנו לטעון את השליחות.");
    } finally {
      setBusy(null);
    }
  }

  async function loadMore() {
    setBusy("more");
    setError(null);
    try {
      const page = await fetchPage(pages * MANUAL_BULK_JOBS_PAGE);
      setJobs((prev) => mergeManualBulkJobs(prev, page.jobs));
      setPages((n) => n + 1);
      setHasMore(page.has_more && page.jobs.length > 0);
    } catch {
      setError("לא הצלחנו לטעון עוד שליחות.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelJob(job: ManualBulkJobOverview) {
    const pending = job.rows?.pending;
    const ok = window.confirm(
      `לבטל את ${pending != null ? `${pending} ההודעות` : "ההודעות"} שעדיין ממתינות בשליחה הזו (${job.template_name})?\nהודעות שכבר נשלחו לא יושפעו.`
    );
    if (!ok) return;
    setCancelingId(job.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/${encodeURIComponent(props.slug)}/bulk-send/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", job_id: job.id, confirmed: true }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; canceled?: number };
      if (!res.ok) throw new Error(j.error || "job_cancel_failed");
      setNotice(`בוטלו ${j.canceled ?? 0} הודעות ממתינות.`);
      await refresh();
    } catch {
      setError("הביטול נכשל. נסו שוב.");
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <section
      className="rounded-2xl border border-[#7133da]/20 bg-white/85 p-4 sm:p-5 shadow-sm space-y-4 text-right"
      dir="rtl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">שליחות המוניות</h2>
          <p className="mt-1 text-xs text-zinc-500">כל קמפיין ששלחתם לרשימה, מהחדש לישן.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          רענן
        </button>
      </div>

      {!statsAvailable ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ספירות השליחה והמסירה עדיין לא זמינות.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

      {jobs.length === 0 ? (
        <p className="text-sm text-zinc-500">עדיין לא נשלחו שליחות המוניות.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-100 overflow-hidden">
          {jobs.map((job) => {
            const dup = duplicates.get(job.id);
            const open = isOpenManualBulkJob(job);
            const body = props.templateBodies[job.template_name] ?? "";
            const bodyOpen = openBodyId === job.id;
            const sentAt = sentWindow(job);
            return (
              <li key={job.id} className="space-y-2 bg-white px-3 py-3 sm:px-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenBodyId(bodyOpen ? null : job.id)}
                        className="font-medium text-zinc-900 break-all hover:text-[#7133da] hover:underline"
                        dir="ltr"
                        aria-expanded={bodyOpen}
                        title="הצג את נוסח התבנית"
                      >
                        {job.template_name}
                      </button>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[job.status]}`}
                      >
                        {MANUAL_BULK_JOB_STATUS_LABELS_HE[job.status]}
                      </span>
                      {job.from_schedule ? (
                        <span className="inline-flex rounded-full border border-[#7133da]/30 bg-[#7133da]/5 px-2 py-0.5 text-xs text-[#7133da]">
                          קמפיין שבועי
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-zinc-500">
                      נוצרה {when(job.created_at)}
                      {job.created_by_email ? (
                        <>
                          {" "}
                          ע״י <span dir="ltr">{job.created_by_email}</span>
                        </>
                      ) : null}
                      {AUDIENCE_LABELS_HE[job.audience_type] ? ` · קהל: ${AUDIENCE_LABELS_HE[job.audience_type]}` : ""}
                    </p>
                    <p className="text-xs text-zinc-600">
                      מתוזמנת ל: {when(job.scheduled_at)}
                      {sentAt ? ` · נשלחה בפועל: ${sentAt}` : ""}
                    </p>
                    <p className="text-xs text-zinc-700">
                      נמענים: <span className="font-semibold">{job.recipients}</span>
                      {job.rows ? (
                        <span className="text-zinc-500">
                          {" "}
                          · נשלחו {job.rows.sent}
                          {job.rows.pending > 0 ? ` · ממתינות ${job.rows.pending}` : ""}
                          {job.rows.canceled > 0 ? ` · בוטלו ${job.rows.canceled}` : ""}
                          {job.rows.failed > 0 ? ` · לא נשלחו ${job.rows.failed}` : ""}
                        </span>
                      ) : null}
                    </p>
                    <DeliveryLine job={job} />
                  </div>
                  {open ? (
                    <button
                      type="button"
                      disabled={cancelingId !== null}
                      onClick={() => void cancelJob(job)}
                      className="shrink-0 self-start rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      {cancelingId === job.id ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          מבטל…
                        </span>
                      ) : (
                        "ביטול השליחה"
                      )}
                    </button>
                  ) : null}
                </div>
                {dup ? (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800" role="alert">
                    שימו לב: יש עוד {dup.jobs === 1 ? "שליחה ממתינה" : `${dup.jobs} שליחות ממתינות`} עם התבנית הזו (
                    {dup.pending} הודעות בתור). אם זו כפילות, בטלו אחת מהן.
                  </p>
                ) : null}
                {bodyOpen ? (
                  <pre className="whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-right text-sm text-zinc-800">
                    {body || "הנוסח של התבנית לא נמצא (ייתכן שנמחקה)."}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          {busy === "more" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          הצג שליחות ישנות יותר
        </button>
      ) : null}
    </section>
  );
}
