/**
 * Bulk jobs get the plan checks when they are queued. The job is refused (bulk_send_held) and
 * Lior gets one alert; nothing is queued. Opt-out, a missing first name and the already-sent
 * log stay per recipient in lib/manual-bulk/dispatch.ts. Two reads per job, no Arbox calls.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { renderWhatsAppTemplatePreview } from "@/lib/wa-zoe-admin-template-log";
import { sendHeldAlert } from "@/lib/send-plan/alerts";
import { HOLD_REASONS, relativeWordMismatch } from "@/lib/send-plan/checks";
import { emptyPlanReadCache, loadWabaBlocked } from "@/lib/send-plan/data";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const BULK_SEND_HELD_ERROR = "bulk_send_held";

export async function bulkQueueHold(input: {
  admin: Admin;
  businessId: number;
  templateName: string;
  components: unknown;
  dueAt: Date;
  now?: Date;
}): Promise<{ reason: string; detail?: string } | null> {
  const body = renderWhatsAppTemplatePreview({ templateName: input.templateName, metaComponents: input.components });
  const words = relativeWordMismatch({ body, eventYmd: null, sendAt: input.dueAt });
  if (words) return { reason: HOLD_REASONS.relativeWords, detail: words };
  const waba = await loadWabaBlocked(input.admin, emptyPlanReadCache(), input.businessId, input.now ?? new Date());
  if (waba.blocked) return { reason: HOLD_REASONS.wabaBlocked, detail: waba.code != null ? String(waba.code) : undefined };
  return null;
}

export async function alertBulkHeld(input: {
  admin: Admin;
  businessId: number;
  businessSlug: string;
  templateName: string;
  reason: string;
}): Promise<void> {
  await sendHeldAlert({
    admin: input.admin,
    headline: `שליחה מרוכזת של ${input.businessSlug} לא נכנסה לתור (${input.templateName})`,
    rows: [{ business: input.businessSlug, reason: input.reason, count: 1 }],
  }).catch((e) => console.error("[send-plan] bulk held alert threw:", e instanceof Error ? e.message : e));
}
