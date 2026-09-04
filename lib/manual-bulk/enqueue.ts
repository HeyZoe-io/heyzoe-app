import { buildManualBulkAudience } from "@/lib/manual-bulk/audience";
import {
  buildManualBulkQueuedDedupKey,
  clampManualBulkWeeks,
  MANUAL_BULK_ENQUEUE_CHUNK,
  type ManualBulkAudienceType,
} from "@/lib/manual-bulk/constants";
import { loadApprovedMarketingTemplate } from "@/lib/manual-bulk/preview";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function enqueueManualBulkSend(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  createdBy: string | null;
  audienceType: ManualBulkAudienceType;
  templateName: string;
  weeks?: number;
  membershipTypeNames?: string[];
  includePunchCards?: boolean;
  dueAt: Date;
}): Promise<{
  job_id: string;
  queued: number;
  with_phone_count: number;
  without_phone_count: number;
  due_at: string;
}> {
  const tpl = await loadApprovedMarketingTemplate({
    admin: input.admin,
    businessId: input.businessId,
    templateName: input.templateName,
  });
  if (!tpl) throw new Error("template_not_approved_marketing");

  const audience = await buildManualBulkAudience({
    admin: input.admin,
    businessId: input.businessId,
    businessSlug: input.businessSlug,
    audienceType: input.audienceType,
    templateName: tpl.name,
    weeks: clampManualBulkWeeks(input.weeks),
    membershipTypeNames: input.membershipTypeNames,
    includePunchCards: input.includePunchCards,
  });

  const now = new Date();
  const nowIso = now.toISOString();
  const dueAt = input.dueAt;
  if (!Number.isFinite(dueAt.getTime())) {
    throw new Error("invalid_schedule_time");
  }
  const dueIso = dueAt.toISOString();
  const audienceParams = {
    weeks: clampManualBulkWeeks(input.weeks),
    membership_type_names: input.membershipTypeNames ?? [],
    include_punch_cards: Boolean(input.includePunchCards),
    scheduled_at: dueIso,
  };

  const { data: job, error: jobErr } = await input.admin
    .from("manual_bulk_jobs")
    .insert({
      business_id: input.businessId,
      created_by: input.createdBy,
      audience_type: input.audienceType,
      audience_params: audienceParams,
      template_name: tpl.name,
      with_phone_count: audience.withPhone.length,
      without_phone_count: audience.withoutPhone.length,
      queued_count: 0,
      status: "queued",
      updated_at: nowIso,
    })
    .select("id")
    .single();
  if (jobErr || !job?.id) {
    console.error("[manual-bulk] job insert failed:", jobErr?.message ?? "no_row");
    throw new Error("job_insert_failed");
  }
  const jobId = String(job.id);

  const sendable = audience.withPhone.filter((r) => r.phone);
  let queued = 0;
  for (let i = 0; i < sendable.length; i += MANUAL_BULK_ENQUEUE_CHUNK) {
    const chunk = sendable.slice(i, i + MANUAL_BULK_ENQUEUE_CHUNK).map((r) => ({
      job_id: jobId,
      business_id: input.businessId,
      contact_phone: r.phone!,
      recipient_key: r.recipientKey,
      template_name: tpl.name,
      due_at: dueIso,
      status: "pending" as const,
      dedup_key: buildManualBulkQueuedDedupKey(jobId, r.recipientKey),
      last_error: null,
      updated_at: nowIso,
    }));
    const { error: qErr, data: inserted } = await input.admin
      .from("manual_bulk_queued_sends")
      .upsert(chunk, { onConflict: "dedup_key", ignoreDuplicates: true })
      .select("id");
    if (qErr) {
      console.error("[manual-bulk] queue insert failed:", qErr.message, { job_id: jobId });
      throw new Error("queue_insert_failed");
    }
    queued += Array.isArray(inserted) ? inserted.length : 0;
  }

  const { error: updErr } = await input.admin
    .from("manual_bulk_jobs")
    .update({ queued_count: queued, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (updErr) {
    console.error("[manual-bulk] job queued_count update failed:", updErr.message);
  }

  console.info("[manual-bulk] enqueued", {
    business_id: input.businessId,
    job_id: jobId,
    audience_type: input.audienceType,
    template_name: tpl.name,
    with_phone: audience.withPhone.length,
    queued,
    due_at: dueIso,
  });

  return {
    job_id: jobId,
    queued,
    with_phone_count: audience.withPhone.length,
    without_phone_count: audience.withoutPhone.length,
    due_at: dueIso,
  };
}
