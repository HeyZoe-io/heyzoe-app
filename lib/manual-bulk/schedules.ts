/**
 * Weekly M1 schedules. Each due tick inserts one occurrence run, then
 * enqueueManualBulkSend with a fresh audience (skipAlreadySentLog).
 *
 * IO (10 businesses, 1 weekly each): 1 indexed SELECT per cron tick;
 * Arbox GETs only on the due weekday (same as one-off confirm).
 */
import { enqueueManualBulkSend } from "@/lib/manual-bulk/enqueue";
import {
  clampManualBulkWeeks,
  isManualBulkAudienceType,
  type ManualBulkAudienceType,
} from "@/lib/manual-bulk/constants";
import {
  advanceWeeklyNextRunAt,
  MANUAL_BULK_OPEN_JOB_STATUSES,
  nextWeeklyRunAt,
  occurrenceYmdFromRunAt,
  parseManualBulkTimeLocal,
  parseManualBulkWeekday,
  shouldMaterializeWeekly,
  type ManualBulkWeekday,
} from "@/lib/manual-bulk/recurrence";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const MANUAL_BULK_SCHEDULE_MATERIALIZE_LIMIT = 20;

export type ManualBulkScheduleRow = {
  id: string;
  business_id: number;
  created_by: string | null;
  audience_type: ManualBulkAudienceType;
  audience_params: {
    weeks: number;
    membership_type_names: string[];
    include_punch_cards: boolean;
  };
  template_name: string;
  weekday: ManualBulkWeekday;
  time_local: string;
  enabled: boolean;
  next_run_at: string;
  created_at: string;
};

function parseAudienceParams(raw: unknown): ManualBulkScheduleRow["audience_params"] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const names = Array.isArray(obj.membership_type_names)
    ? obj.membership_type_names.map((n) => String(n ?? "").trim()).filter(Boolean)
    : [];
  return {
    weeks: clampManualBulkWeeks(obj.weeks),
    membership_type_names: names,
    include_punch_cards: obj.include_punch_cards === true,
  };
}

function normalizeScheduleRow(row: Record<string, unknown>): ManualBulkScheduleRow | null {
  const id = String(row.id ?? "").trim();
  const audienceType = String(row.audience_type ?? "");
  const weekday = parseManualBulkWeekday(row.weekday);
  const timeLocal = parseManualBulkTimeLocal(row.time_local);
  if (!id || !isManualBulkAudienceType(audienceType) || weekday === "invalid" || timeLocal === "invalid") {
    return null;
  }
  return {
    id,
    business_id: Number(row.business_id),
    created_by: row.created_by != null ? String(row.created_by) : null,
    audience_type: audienceType,
    audience_params: parseAudienceParams(row.audience_params),
    template_name: String(row.template_name ?? "").trim(),
    weekday,
    time_local: timeLocal,
    enabled: row.enabled !== false,
    next_run_at: String(row.next_run_at ?? ""),
    created_at: String(row.created_at ?? ""),
  };
}

export async function listManualBulkSchedules(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<ManualBulkScheduleRow[]> {
  const { data, error } = await input.admin
    .from("manual_bulk_schedules")
    .select(
      "id, business_id, created_by, audience_type, audience_params, template_name, weekday, time_local, enabled, next_run_at, created_at"
    )
    .eq("business_id", input.businessId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (/does not exist|schema cache|manual_bulk_schedules/i.test(error.message)) return [];
    console.error("[manual-bulk] list schedules failed:", error.message);
    throw new Error("schedule_list_failed");
  }
  return (data ?? [])
    .map((row) => normalizeScheduleRow(row as Record<string, unknown>))
    .filter((row): row is ManualBulkScheduleRow => Boolean(row));
}

export async function createManualBulkSchedule(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  createdBy: string | null;
  audienceType: ManualBulkAudienceType;
  templateName: string;
  weekday: ManualBulkWeekday;
  timeLocal: string;
  nextRunAt: Date;
  weeks?: number;
  membershipTypeNames?: string[];
  includePunchCards?: boolean;
}): Promise<ManualBulkScheduleRow> {
  const timeLocal = parseManualBulkTimeLocal(input.timeLocal);
  if (timeLocal === "invalid") throw new Error("invalid_recurrence_time");
  const nowIso = new Date().toISOString();
  const { data, error } = await input.admin
    .from("manual_bulk_schedules")
    .insert({
      business_id: input.businessId,
      created_by: input.createdBy,
      audience_type: input.audienceType,
      audience_params: {
        weeks: clampManualBulkWeeks(input.weeks),
        membership_type_names: input.membershipTypeNames ?? [],
        include_punch_cards: Boolean(input.includePunchCards),
      },
      template_name: input.templateName,
      weekday: input.weekday,
      time_local: timeLocal,
      enabled: true,
      next_run_at: input.nextRunAt.toISOString(),
      updated_at: nowIso,
    })
    .select(
      "id, business_id, created_by, audience_type, audience_params, template_name, weekday, time_local, enabled, next_run_at, created_at"
    )
    .single();
  if (error || !data) {
    console.error("[manual-bulk] schedule insert failed:", error?.message ?? "no_row");
    throw new Error("schedule_insert_failed");
  }
  const row = normalizeScheduleRow(data as Record<string, unknown>);
  if (!row) throw new Error("schedule_insert_failed");
  console.info("[manual-bulk] schedule created", {
    business_id: input.businessId,
    schedule_id: row.id,
    weekday: row.weekday,
    time_local: row.time_local,
    next_run_at: row.next_run_at,
  });
  return row;
}

async function cancelPendingForSchedule(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  scheduleId: string;
}): Promise<number> {
  const { data: jobs, error: jobErr } = await input.admin
    .from("manual_bulk_jobs")
    .select("id")
    .eq("business_id", input.businessId)
    .eq("schedule_id", input.scheduleId)
    .in("status", [...MANUAL_BULK_OPEN_JOB_STATUSES]);
  if (jobErr) {
    console.error("[manual-bulk] schedule jobs lookup failed:", jobErr.message);
    throw new Error("schedule_cancel_failed");
  }
  const jobIds = (jobs ?? [])
    .map((j) => String((j as { id?: unknown }).id ?? "").trim())
    .filter(Boolean);
  if (!jobIds.length) return 0;

  const nowIso = new Date().toISOString();
  const { data: canceledRows, error: qErr } = await input.admin
    .from("manual_bulk_queued_sends")
    .update({ status: "canceled", last_error: "schedule_disabled", updated_at: nowIso })
    .in("job_id", jobIds)
    .eq("status", "pending")
    .select("id");
  if (qErr) {
    console.error("[manual-bulk] schedule pending cancel failed:", qErr.message);
    throw new Error("schedule_cancel_failed");
  }
  const { error: jobUpdErr } = await input.admin
    .from("manual_bulk_jobs")
    .update({ status: "canceled", updated_at: nowIso })
    .in("id", jobIds)
    .in("status", [...MANUAL_BULK_OPEN_JOB_STATUSES]);
  if (jobUpdErr) {
    console.error("[manual-bulk] schedule job cancel failed:", jobUpdErr.message);
  }
  return Array.isArray(canceledRows) ? canceledRows.length : 0;
}

export async function setManualBulkScheduleEnabled(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  scheduleId: string;
  enabled: boolean;
  now?: Date;
}): Promise<{ schedule: ManualBulkScheduleRow; canceled_pending: number }> {
  const now = input.now ?? new Date();
  const { data: existing, error: loadErr } = await input.admin
    .from("manual_bulk_schedules")
    .select(
      "id, business_id, created_by, audience_type, audience_params, template_name, weekday, time_local, enabled, next_run_at, created_at"
    )
    .eq("id", input.scheduleId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (loadErr) {
    console.error("[manual-bulk] schedule load failed:", loadErr.message);
    throw new Error("schedule_update_failed");
  }
  const current = existing ? normalizeScheduleRow(existing as Record<string, unknown>) : null;
  if (!current) throw new Error("schedule_not_found");

  let canceledPending = 0;
  const patch: Record<string, unknown> = {
    enabled: input.enabled,
    updated_at: now.toISOString(),
  };
  if (!input.enabled) {
    canceledPending = await cancelPendingForSchedule({
      admin: input.admin,
      businessId: input.businessId,
      scheduleId: input.scheduleId,
    });
  } else {
    patch.next_run_at = nextWeeklyRunAt({
      weekday: current.weekday,
      timeLocal: current.time_local,
      from: now,
    }).toISOString();
  }

  const { data: updated, error: updErr } = await input.admin
    .from("manual_bulk_schedules")
    .update(patch)
    .eq("id", input.scheduleId)
    .eq("business_id", input.businessId)
    .select(
      "id, business_id, created_by, audience_type, audience_params, template_name, weekday, time_local, enabled, next_run_at, created_at"
    )
    .maybeSingle();
  if (updErr || !updated) {
    console.error("[manual-bulk] schedule update failed:", updErr?.message ?? "no_row");
    throw new Error("schedule_update_failed");
  }
  const schedule = normalizeScheduleRow(updated as Record<string, unknown>);
  if (!schedule) throw new Error("schedule_update_failed");
  console.info("[manual-bulk] schedule enabled", {
    business_id: input.businessId,
    schedule_id: schedule.id,
    enabled: schedule.enabled,
    canceled_pending: canceledPending,
  });
  return { schedule, canceled_pending: canceledPending };
}

async function loadBusinessSlug(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<string | null> {
  const { data, error } = await admin.from("businesses").select("slug").eq("id", businessId).maybeSingle();
  if (error) {
    console.error("[manual-bulk] schedule slug lookup failed:", error.message);
    return null;
  }
  const slug = String((data as { slug?: unknown } | null)?.slug ?? "")
    .trim()
    .toLowerCase();
  return slug || null;
}

export type ManualBulkScheduleMaterializeSummary = {
  due: number;
  materialized: number;
  skipped_dup: number;
  errors: number;
};

export async function materializeDueManualBulkSchedules(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  now?: Date;
}): Promise<ManualBulkScheduleMaterializeSummary> {
  const summary: ManualBulkScheduleMaterializeSummary = {
    due: 0,
    materialized: 0,
    skipped_dup: 0,
    errors: 0,
  };
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const { data, error } = await input.admin
    .from("manual_bulk_schedules")
    .select(
      "id, business_id, created_by, audience_type, audience_params, template_name, weekday, time_local, enabled, next_run_at, created_at"
    )
    .eq("enabled", true)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(MANUAL_BULK_SCHEDULE_MATERIALIZE_LIMIT);

  if (error) {
    if (/does not exist|schema cache|manual_bulk_schedules/i.test(error.message)) {
      return summary;
    }
    console.error("[manual-bulk] due schedules lookup failed:", error.message);
    summary.errors += 1;
    return summary;
  }

  const rows = (data ?? [])
    .map((row) => normalizeScheduleRow(row as Record<string, unknown>))
    .filter((row): row is ManualBulkScheduleRow => Boolean(row));
  summary.due = rows.length;

  for (const schedule of rows) {
    const nextRunAt = new Date(schedule.next_run_at);
    if (
      !shouldMaterializeWeekly({
        enabled: schedule.enabled,
        nextRunAt,
        now,
      })
    ) {
      continue;
    }
    const occurrenceYmd = occurrenceYmdFromRunAt(nextRunAt);
    const { error: runErr } = await input.admin.from("manual_bulk_schedule_runs").insert({
      schedule_id: schedule.id,
      occurrence_ymd: occurrenceYmd,
      job_id: null,
    });
    if (runErr) {
      if (/duplicate|unique|23505/i.test(runErr.message)) {
        summary.skipped_dup += 1;
        const advanced = advanceWeeklyNextRunAt({
          weekday: schedule.weekday,
          timeLocal: schedule.time_local,
          now,
          lastOccurrenceAt: nextRunAt,
        });
        await input.admin
          .from("manual_bulk_schedules")
          .update({ next_run_at: advanced.toISOString(), updated_at: now.toISOString() })
          .eq("id", schedule.id)
          .eq("enabled", true);
        continue;
      }
      console.error("[manual-bulk] schedule run insert failed:", runErr.message, {
        schedule_id: schedule.id,
        occurrence_ymd: occurrenceYmd,
      });
      summary.errors += 1;
      continue;
    }

    try {
      const slug = await loadBusinessSlug(input.admin, schedule.business_id);
      if (!slug) throw new Error("missing_business_slug");
      const queued = await enqueueManualBulkSend({
        admin: input.admin,
        businessId: schedule.business_id,
        businessSlug: slug,
        createdBy: schedule.created_by,
        audienceType: schedule.audience_type,
        templateName: schedule.template_name,
        weeks: schedule.audience_params.weeks,
        membershipTypeNames: schedule.audience_params.membership_type_names,
        includePunchCards: schedule.audience_params.include_punch_cards,
        dueAt: nextRunAt.getTime() > now.getTime() ? nextRunAt : now,
        scheduleId: schedule.id,
        skipAlreadySentLog: true,
      });
      await input.admin
        .from("manual_bulk_schedule_runs")
        .update({ job_id: queued.job_id })
        .eq("schedule_id", schedule.id)
        .eq("occurrence_ymd", occurrenceYmd);

      const advanced = advanceWeeklyNextRunAt({
        weekday: schedule.weekday,
        timeLocal: schedule.time_local,
        now,
        lastOccurrenceAt: nextRunAt,
      });
      await input.admin
        .from("manual_bulk_schedules")
        .update({ next_run_at: advanced.toISOString(), updated_at: now.toISOString() })
        .eq("id", schedule.id);

      summary.materialized += 1;
      console.info("[manual-bulk] schedule materialized", {
        business_id: schedule.business_id,
        schedule_id: schedule.id,
        occurrence_ymd: occurrenceYmd,
        job_id: queued.job_id,
        queued: queued.queued,
        next_run_at: advanced.toISOString(),
      });
    } catch (e) {
      summary.errors += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[manual-bulk] schedule materialize failed:", message, {
        schedule_id: schedule.id,
        occurrence_ymd: occurrenceYmd,
      });
      await input.admin
        .from("manual_bulk_schedule_runs")
        .delete()
        .eq("schedule_id", schedule.id)
        .eq("occurrence_ymd", occurrenceYmd)
        .is("job_id", null);
    }
  }

  return summary;
}
