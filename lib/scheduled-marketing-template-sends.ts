import { normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  decideScheduledSendAfterMeta,
  decideScheduledSendGate,
  isDuePendingScheduledSend,
  NO_TEMPLATE_SKIPPED_ERROR,
} from "@/lib/scheduled-template-sends";

export type ScheduledMarketingTemplateSendRow = {
  id: string;
  trigger_id: string | null;
  contact_phone: string;
  template_name: string;
  due_at: string;
  status: "pending" | "sent" | "canceled" | "failed";
  dedup_key: string;
  body_params: unknown;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export function parseScheduledBodyParams(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? "").trim() || "—");
}

export function buildMarketingNodeAnsweredDedupKey(
  triggerId: string,
  phone: string,
  eventDayYmd: string
): string {
  return `node_answered:${String(triggerId).trim()}:${String(phone).trim()}:${String(eventDayYmd).trim()}`;
}

export function buildMarketingFlowCompletedDedupKey(
  triggerId: string,
  phone: string,
  eventDayYmd: string
): string {
  return `flow_completed:${String(triggerId).trim()}:${String(phone).trim()}:${String(eventDayYmd).trim()}`;
}

export function buildMarketingCallDayDedupKey(
  triggerId: string,
  phone: string,
  callDateYmd: string
): string {
  return `call_day:${String(triggerId).trim()}:${String(phone).trim()}:${String(callDateYmd).trim()}`;
}

export function callDateYmdFromCallDayDedupKey(dedupKey: string): string | null {
  const key = String(dedupKey ?? "").trim();
  if (!key.startsWith("call_day:")) return null;
  const last = key.split(":").pop() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : null;
}

export function buildMarketingBroadcastDedupKey(batchId: string, phone: string): string {
  return `broadcast:${String(batchId).trim()}:${String(phone).trim()}`;
}

export async function enqueueScheduledMarketingTemplateSend(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  triggerId?: string | null;
  contactPhone: string;
  templateName: string;
  dueAt: Date;
  dedupKey: string;
  bodyParams: string[];
}): Promise<{ ok: true; inserted: boolean } | { ok: false; error: string }> {
  const triggerId = String(input.triggerId ?? "").trim() || null;
  const templateName = String(input.templateName ?? "").trim();
  const dedupKey = String(input.dedupKey ?? "").trim();
  const contactPhone =
    normalizePhone(input.contactPhone) ??
    String(input.contactPhone ?? "").replace(/\D/g, "").trim();

  if (!templateName) return { ok: false, error: "missing_template_name" };
  if (!dedupKey) return { ok: false, error: "missing_dedup_key" };
  if (!contactPhone) return { ok: false, error: "missing_contact_phone" };
  if (!Number.isFinite(input.dueAt.getTime())) return { ok: false, error: "invalid_due_at" };

  const nowIso = new Date().toISOString();
  const row = {
    trigger_id: triggerId,
    contact_phone: contactPhone,
    template_name: templateName,
    due_at: input.dueAt.toISOString(),
    status: "pending" as const,
    dedup_key: dedupKey,
    body_params: input.bodyParams,
    last_error: null,
    updated_at: nowIso,
  };

  const { error, data } = await input.admin
    .from("scheduled_marketing_template_sends")
    .upsert(row, { onConflict: "dedup_key", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("[scheduled-marketing-template-sends] enqueue failed:", error.message, {
      dedup_key: dedupKey,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true, inserted: Array.isArray(data) && data.length > 0 };
}

export {
  decideScheduledSendAfterMeta,
  decideScheduledSendGate,
  isDuePendingScheduledSend,
  NO_TEMPLATE_SKIPPED_ERROR,
};
