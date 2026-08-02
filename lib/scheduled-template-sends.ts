import { normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ScheduledTemplateSendStatus = "pending" | "sent" | "canceled" | "failed";

export type ScheduledTemplateSendRow = {
  id: string;
  business_id: number;
  trigger_id: string;
  contact_phone: string;
  template_name: string;
  due_at: string;
  status: ScheduledTemplateSendStatus;
  dedup_key: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type DelayRuleForDueAt = {
  delay_days: number;
  delay_direction: string;
};

/**
 * Compute send time from a trigger rule.
 * after → eventDate + delay_days; before → eventDate - delay_days (caller passes the deadline/event date).
 */
export function computeDueAt(rule: DelayRuleForDueAt, eventDate: Date): Date {
  const days = Math.max(0, Math.trunc(Number(rule.delay_days) || 0));
  const baseMs = eventDate.getTime();
  if (!Number.isFinite(baseMs)) {
    throw new Error("invalid_event_date");
  }
  const direction = String(rule.delay_direction ?? "after").trim().toLowerCase();
  const delta = days * MS_PER_DAY;
  if (direction === "before") {
    return new Date(baseMs - delta);
  }
  return new Date(baseMs + delta);
}

/** Purchase enqueue key: same sale cannot schedule the same trigger twice. */
export function buildPurchaseScheduledDedupKey(
  businessId: number,
  triggerId: string,
  saleId: number
): string {
  return `purchase:${businessId}:${String(triggerId).trim()}:${saleId}`;
}

export function isDuePendingScheduledSend(
  row: { status: string; due_at: string },
  now: Date = new Date()
): boolean {
  if (String(row.status) !== "pending") return false;
  const dueMs = Date.parse(row.due_at);
  if (!Number.isFinite(dueMs)) return false;
  return dueMs <= now.getTime();
}

/** Pure filter used by tests + mirrors the cron WHERE clause. */
export function selectDuePendingScheduledSends<T extends { status: string; due_at: string }>(
  rows: T[],
  now: Date,
  limit = 200
): T[] {
  return rows
    .filter((row) => isDuePendingScheduledSend(row, now))
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
    .slice(0, Math.max(0, limit));
}

export type EnqueueScheduledTemplateSendResult =
  | { ok: true; inserted: boolean }
  | { ok: false; error: string };

/**
 * Idempotent enqueue: unique(dedup_key) + ignoreDuplicates.
 * Re-running detection does not create a second pending row.
 */
export async function enqueueScheduledTemplateSend(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  triggerId: string;
  contactPhone: string;
  templateName: string;
  dueAt: Date;
  dedupKey: string;
}): Promise<EnqueueScheduledTemplateSendResult> {
  const businessId = Number(input.businessId);
  const triggerId = String(input.triggerId ?? "").trim();
  const templateName = String(input.templateName ?? "").trim();
  const dedupKey = String(input.dedupKey ?? "").trim();
  const contactPhone =
    normalizePhone(input.contactPhone) ?? String(input.contactPhone ?? "").replace(/\D/g, "").trim();

  if (!Number.isFinite(businessId) || businessId <= 0) {
    return { ok: false, error: "invalid_business_id" };
  }
  if (!triggerId) return { ok: false, error: "missing_trigger_id" };
  if (!templateName) return { ok: false, error: "missing_template_name" };
  if (!dedupKey) return { ok: false, error: "missing_dedup_key" };
  if (!contactPhone) return { ok: false, error: "missing_contact_phone" };
  if (!Number.isFinite(input.dueAt.getTime())) {
    return { ok: false, error: "invalid_due_at" };
  }

  const nowIso = new Date().toISOString();
  const row = {
    business_id: businessId,
    trigger_id: triggerId,
    contact_phone: contactPhone,
    template_name: templateName,
    due_at: input.dueAt.toISOString(),
    status: "pending" as const,
    dedup_key: dedupKey,
    last_error: null,
    updated_at: nowIso,
  };

  const { error, data } = await input.admin
    .from("scheduled_template_sends")
    .upsert(row, { onConflict: "dedup_key", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("[scheduled-template-sends] enqueue failed:", error.message, {
      businessId,
      dedup_key: dedupKey,
    });
    return { ok: false, error: error.message };
  }

  const inserted = Array.isArray(data) && data.length > 0;
  return { ok: true, inserted };
}

export const NO_TEMPLATE_SKIPPED_ERROR = "no_template_skipped" as const;

/**
 * Gate for a due scheduled send: sendable → attempt Meta send;
 * not sendable → cancel (do not keep pending / do not retry late).
 */
export function decideScheduledSendGate(input: {
  hasChannel: boolean;
  hasWaba: boolean;
  hasApprovedTemplate: boolean;
}): { action: "send" } | { action: "cancel"; last_error: typeof NO_TEMPLATE_SKIPPED_ERROR } {
  if (!input.hasChannel || !input.hasWaba || !input.hasApprovedTemplate) {
    return { action: "cancel", last_error: NO_TEMPLATE_SKIPPED_ERROR };
  }
  return { action: "send" };
}

/** After a Meta send attempt on a sendable row. */
export function decideScheduledSendAfterMeta(input: {
  ok: boolean;
  error?: string | null;
}):
  | { status: "sent"; last_error: null }
  | { status: "failed"; last_error: string } {
  if (input.ok) return { status: "sent", last_error: null };
  return {
    status: "failed",
    last_error: String(input.error ?? "send_failed").slice(0, 500) || "send_failed",
  };
}

