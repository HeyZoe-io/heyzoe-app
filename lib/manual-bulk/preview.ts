import { firstNameFromFullName, renderLeadTemplateMessageContent } from "@/lib/lead-template";
import { buildManualBulkAudience } from "@/lib/manual-bulk/audience";
import {
  clampManualBulkWeeks,
  MANUAL_BULK_DRAIN_INTERVAL_MINUTES,
  MANUAL_BULK_FLUSH_LIMIT,
  type ManualBulkAudienceType,
} from "@/lib/manual-bulk/constants";
import { templateSendPayload } from "@/lib/template-send-params";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveManualBulkSchedule, scheduleSummaryJson } from "@/lib/manual-bulk/schedule";

export function isApprovedMarketingTemplate(row: {
  status?: unknown;
  category?: unknown;
  disabled?: unknown;
  name?: unknown;
}): boolean {
  if (String(row.name ?? "").trim() === "") return false;
  if (row.disabled === true) return false;
  if (String(row.status ?? "").trim().toUpperCase() !== "APPROVED") return false;
  return String(row.category ?? "").trim().toUpperCase() === "MARKETING";
}

export async function loadApprovedMarketingTemplate(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  templateName: string;
}): Promise<{
  name: string;
  language: string;
  components: unknown;
} | null> {
  const name = String(input.templateName ?? "").trim();
  if (!name) return null;
  const { data, error } = await input.admin
    .from("whatsapp_templates")
    .select("name, status, category, disabled, language, components")
    .eq("business_id", input.businessId)
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[manual-bulk] template lookup failed:", error.message);
    throw new Error("template_lookup_failed");
  }
  if (!data || !isApprovedMarketingTemplate(data)) return null;
  return {
    name: String((data as { name?: unknown }).name ?? name),
    language: String((data as { language?: unknown }).language ?? "he").trim() || "he",
    components: (data as { components?: unknown }).components,
  };
}

export async function previewManualBulkSend(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  businessName: string;
  audienceType: ManualBulkAudienceType;
  templateName: string;
  weeks?: number;
  membershipTypeNames?: string[];
  includePunchCards?: boolean;
  scheduledAtRaw?: unknown;
  now?: Date;
}): Promise<{
  with_phone_count: number;
  without_phone_count: number;
  skipped: Record<string, number>;
  eta_minutes: number;
  drain_batch: number;
  drain_interval_minutes: number;
  template_preview: string;
  template_name: string;
  messages_pages: number;
  customer_pages: number;
  hit_message_page_cap: boolean;
  due_at: string;
  dispatch_at: string;
  eta_finish_at: string;
  window_adjusted: boolean;
  scheduled: boolean;
  due_at_he: string;
  dispatch_at_he: string;
  eta_finish_at_he: string;
}> {
  const schedule = resolveManualBulkSchedule({
    scheduledAtRaw: input.scheduledAtRaw,
    now: input.now,
  });
  if (!schedule.ok) throw new Error(schedule.error);

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

  const sampleName = audience.withPhone.find((r) => r.fullName)?.fullName ?? "דנה";
  const firstName = firstNameFromFullName(sampleName);
  const { bodyParams } = templateSendPayload({
    triggerType: "purchase",
    storedComponents: tpl.components,
    firstName,
    businessName: input.businessName,
  });
  const templatePreview = renderLeadTemplateMessageContent(tpl.name, {
    firstName,
    bodyParams,
    components: tpl.components,
  });

  const scheduleJson = scheduleSummaryJson(schedule, audience.withPhone.length);

  return {
    with_phone_count: audience.withPhone.length,
    without_phone_count: audience.withoutPhone.length,
    skipped: audience.skipped,
    drain_batch: MANUAL_BULK_FLUSH_LIMIT,
    drain_interval_minutes: MANUAL_BULK_DRAIN_INTERVAL_MINUTES,
    template_preview: templatePreview,
    template_name: tpl.name,
    messages_pages: audience.messages_pages,
    customer_pages: audience.customer_pages,
    hit_message_page_cap: audience.hit_message_page_cap,
    ...scheduleJson,
  };
}
