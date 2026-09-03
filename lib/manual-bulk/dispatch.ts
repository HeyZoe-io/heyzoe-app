import { firstNameFromFullName, formatLeadTemplateMessageContent, LEAD_TEMPLATE_MODEL } from "@/lib/lead-template";
import { MANUAL_BULK_FLUSH_LIMIT } from "@/lib/manual-bulk/constants";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { buildWaSessionId, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import {
  decideScheduledDrainDispatch,
  decideScheduledSendAfterMeta,
  decideScheduledSendGate,
  NO_TEMPLATE_SKIPPED_ERROR,
} from "@/lib/scheduled-template-sends";
import { templateSendPayload } from "@/lib/template-send-params";
import { logMessage } from "@/lib/analytics";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveSendChannelForContact } from "@/lib/wa-resolve-send-channel";

export type ManualBulkQueuedSendRow = {
  id: string;
  job_id: string;
  business_id: number;
  contact_phone: string;
  recipient_key: string;
  template_name: string;
  due_at: string;
  status: "pending" | "sent" | "canceled" | "failed";
  dedup_key: string;
  last_error: string | null;
};

async function markQueued(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  mark: { status: "sent" | "failed" | "canceled"; last_error?: string | null }
): Promise<void> {
  const { error } = await admin
    .from("manual_bulk_queued_sends")
    .update({
      status: mark.status,
      last_error: mark.status === "sent" ? null : (mark.last_error ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) {
    console.error("[manual-bulk] queue status update failed:", error.message, { id, status: mark.status });
  }
}

async function lookupContactFullName(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  phone: string
): Promise<string | null> {
  const variants = contactPhoneLookupVariants(phone);
  const { data } = await admin
    .from("contacts")
    .select("full_name")
    .eq("business_id", businessId)
    .in("phone", variants.length ? variants : [phone])
    .limit(1)
    .maybeSingle();
  const name = String((data as { full_name?: string | null } | null)?.full_name ?? "").trim();
  return name || null;
}

async function dispatchOne(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  row: ManualBulkQueuedSendRow,
  now: Date
): Promise<"sent" | "failed" | "canceled" | "skipped"> {
  if (decideScheduledDrainDispatch(now).action === "hold") return "skipped";
  const businessId = Number(row.business_id);
  const phone = String(row.contact_phone ?? "").trim();
  const templateName = String(row.template_name ?? "").trim();
  if (!businessId || !phone || !templateName) {
    await markQueued(admin, row.id, { status: "canceled", last_error: NO_TEMPLATE_SKIPPED_ERROR });
    return "canceled";
  }

  const channel = await resolveSendChannelForContact(admin, businessId, phone);
  const phoneNumberId = String(channel?.phoneNumberId ?? "").trim();

  const [{ data: bizRow }, { data: approvedTpl }] = await Promise.all([
    admin.from("businesses").select("slug, waba_id, name").eq("id", businessId).maybeSingle(),
    admin
      .from("whatsapp_templates")
      .select("id, status, category, language, components, disabled")
      .eq("business_id", businessId)
      .eq("name", templateName)
      .eq("status", "APPROVED")
      .eq("disabled", false)
      .limit(1)
      .maybeSingle(),
  ]);

  const wabaId = String((bizRow as { waba_id?: unknown } | null)?.waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  const category = String((approvedTpl as { category?: unknown } | null)?.category ?? "")
    .trim()
    .toUpperCase();
  const gate = decideScheduledSendGate({
    hasChannel: Boolean(phoneNumberId),
    hasWaba: Boolean(wabaId),
    hasApprovedTemplate: Boolean(approvedTpl?.id) && category === "MARKETING",
  });
  if (gate.action === "cancel") {
    await markQueued(admin, row.id, { status: "canceled", last_error: gate.last_error });
    return "canceled";
  }

  const fullName = await lookupContactFullName(admin, businessId, phone);
  const firstName = firstNameFromFullName(String(fullName ?? ""));
  const languageCode =
    String((approvedTpl as { language?: string }).language ?? "he").trim() || "he";
  const storedComponents = (approvedTpl as { components?: unknown }).components;
  const { sendComponents, bodyParams } = templateSendPayload({
    triggerType: "purchase",
    storedComponents,
    firstName,
    businessName: String((bizRow as { name?: unknown } | null)?.name ?? ""),
  });

  const sendResult = await sendBusinessTemplate({
    to: phone,
    phoneNumberId,
    templateName,
    languageCode,
    ...(sendComponents ? { components: sendComponents } : {}),
  });

  const afterMeta = decideScheduledSendAfterMeta({
    ok: sendResult.ok,
    error: sendResult.error,
  });
  if (afterMeta.status === "failed") {
    await markQueued(admin, row.id, { status: "failed", last_error: afterMeta.last_error });
    return "failed";
  }

  await markQueued(admin, row.id, { status: "sent" });
  const { error: logErr } = await admin.from("manual_bulk_send_log").upsert(
    {
      business_id: businessId,
      recipient_key: row.recipient_key,
      template_name: templateName,
      job_id: row.job_id,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "business_id,recipient_key,template_name" }
  );
  if (logErr && !/does not exist|schema cache|manual_bulk_send_log/i.test(logErr.message)) {
    console.error("[manual-bulk] send_log upsert failed:", logErr.message);
  }

  const businessSlug = String((bizRow as { slug?: unknown } | null)?.slug ?? "")
    .trim()
    .toLowerCase();
  if (businessSlug) {
    await logMessage({
      business_slug: businessSlug,
      role: "assistant",
      content: formatLeadTemplateMessageContent(templateName, {
        firstName,
        components: storedComponents,
        bodyParams,
      }),
      model_used: LEAD_TEMPLATE_MODEL,
      session_id: buildWaSessionId(phoneNumberId, phone),
    });
  }
  return "sent";
}

export async function flushDueManualBulkSends(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  nowIso: string = new Date().toISOString(),
  now: Date = new Date(nowIso)
): Promise<{
  fetched: number;
  sent: number;
  failed: number;
  canceled: number;
  skipped: number;
  held: boolean;
}> {
  if (decideScheduledDrainDispatch(now).action === "hold") {
    return { fetched: 0, sent: 0, failed: 0, canceled: 0, skipped: 0, held: true };
  }

  const { data, error } = await admin
    .from("manual_bulk_queued_sends")
    .select(
      "id, job_id, business_id, contact_phone, recipient_key, template_name, due_at, status, dedup_key, last_error"
    )
    .eq("status", "pending")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(MANUAL_BULK_FLUSH_LIMIT);

  if (error) {
    if (/does not exist|schema cache|manual_bulk_queued_sends/i.test(error.message)) {
      return { fetched: 0, sent: 0, failed: 0, canceled: 0, skipped: 0, held: false };
    }
    console.error("[manual-bulk] drain select failed:", error.message);
    throw new Error(error.message);
  }

  const rows = (data ?? []) as ManualBulkQueuedSendRow[];
  let sent = 0;
  let failed = 0;
  let canceled = 0;
  let skipped = 0;
  const jobIds = new Set<string>();

  for (const row of rows) {
    jobIds.add(row.job_id);
    try {
      const outcome = await dispatchOne(admin, row, now);
      if (outcome === "sent") sent += 1;
      else if (outcome === "failed") failed += 1;
      else if (outcome === "canceled") canceled += 1;
      else skipped += 1;
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[manual-bulk] drain row threw:", message, { id: row.id });
      await markQueued(admin, row.id, { status: "failed", last_error: message.slice(0, 500) });
    }
  }

  for (const jobId of jobIds) {
    await refreshJobStatus(admin, jobId);
  }

  return { fetched: rows.length, sent, failed, canceled, skipped, held: false };
}

async function refreshJobStatus(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobId: string
): Promise<void> {
  const { count, error } = await admin
    .from("manual_bulk_queued_sends")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "pending");
  if (error) {
    console.error("[manual-bulk] job pending count failed:", error.message);
    return;
  }
  const pending = Number(count ?? 0);
  const status = pending > 0 ? "sending" : "done";
  const { error: updErr } = await admin
    .from("manual_bulk_jobs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (updErr) {
    console.error("[manual-bulk] job status update failed:", updErr.message);
  }
}
