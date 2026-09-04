import { isAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
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

/** Credit-refusal enqueue key: same FAIL transaction cannot schedule twice. */
export function buildCreditRefusalScheduledDedupKey(
  businessId: number,
  triggerId: string,
  transactionId: number
): string {
  return `credit_refusal:${businessId}:${String(triggerId).trim()}:${transactionId}`;
}

/**
 * Birthday enqueue key: once per business+trigger+user+celebration year.
 * Prefix is the trigger_type (`birthday` | `birthday_former`) so member vs former
 * never share a dedup key (separate messages).
 */
export function buildBirthdayScheduledDedupKey(
  businessId: number,
  triggerId: string,
  userId: number,
  birthdayYear: number,
  triggerType: "birthday" | "birthday_former" = "birthday"
): string {
  const prefix = triggerType === "birthday_former" ? "birthday_former" : "birthday";
  return `${prefix}:${businessId}:${String(triggerId).trim()}:${userId}:${birthdayYear}`;
}

/** Membership-expiring enqueue key: once per business+trigger+membership instance+end_date. */
export function buildMembershipExpiringScheduledDedupKey(
  businessId: number,
  triggerId: string,
  membershipUserId: number,
  endDateYmd: string
): string {
  return `membership_expiring:${businessId}:${String(triggerId).trim()}:${membershipUserId}:${String(endDateYmd).trim()}`;
}

/** Sessions-expiring enqueue key: once per business+trigger+user+start_date+end_date (pack identity). */
export function buildSessionsExpiringScheduledDedupKey(
  businessId: number,
  triggerId: string,
  userId: number,
  startDateYmd: string,
  endDateYmd: string
): string {
  return `sessions_expiring:${businessId}:${String(triggerId).trim()}:${userId}:${String(startDateYmd).trim()}:${String(endDateYmd).trim()}`;
}

/**
 * Membership-cancelled enqueue key.
 * Last YMD segment = end_date (parsed by expiryYmdFromScheduledDedupKey).
 * `#` suffix = encodeURIComponent(membership_type_name) for delayed {{1}}.
 * cancelled_time is tokenized (':' and spaces → '_') so it does not split the key.
 */
export function encodeCancelledTimeDedupToken(cancelledTime: string): string {
  return String(cancelledTime ?? "")
    .trim()
    .replace(/[:\s]+/g, "_");
}

export function buildMembershipCancelledScheduledDedupKey(
  businessId: number,
  triggerId: string,
  userId: number,
  cancelledTime: string,
  endDateYmd: string | null,
  membershipTypeName: string
): string {
  const endRaw = String(endDateYmd ?? "").trim();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? endRaw : "none";
  const typeEnc = encodeURIComponent(String(membershipTypeName ?? "").trim());
  return `membership_cancelled:${businessId}:${String(triggerId).trim()}:${userId}:${encodeCancelledTimeDedupToken(cancelledTime)}:${end}#${typeEnc}`;
}

/** Trial-attended enqueue key: once per business+trigger+user+class_date. */
export function buildTrialAttendedScheduledDedupKey(
  businessId: number,
  triggerId: string,
  userId: number,
  classDateYmd: string
): string {
  return `trial_attended:${businessId}:${String(triggerId).trim()}:${userId}:${String(classDateYmd).trim()}`;
}

/** Arbox new-lead enqueue key: once per business+trigger+Arbox user_id (allLeadsReport). */
export function buildArboxNewLeadScheduledDedupKey(
  businessId: number,
  triggerId: string,
  leadId: number
): string {
  return `arbox_new_lead:${businessId}:${String(triggerId).trim()}:${leadId}`;
}

/** Site-lead enqueue key: once per business+trigger+phone+calendar day (UTC ymd). */
export function buildSiteLeadScheduledDedupKey(
  businessId: number,
  triggerId: string,
  phoneNorm: string,
  eventDayYmd: string
): string {
  return `site_lead:${businessId}:${String(triggerId).trim()}:${String(phoneNorm).trim()}:${String(eventDayYmd).trim()}`;
}

/**
 * No-response re-engage enqueue key.
 * silenceEpisodeKey should identify the silence episode (typically last_user_at ISO / day).
 * A new inbound after re-engage changes last_user_at → new key.
 */
export function buildNoResponseScheduledDedupKey(
  businessId: number,
  triggerId: string,
  phoneNorm: string,
  silenceEpisodeKey: string
): string {
  return `no_response:${businessId}:${String(triggerId).trim()}:${String(phoneNorm).trim()}:${String(silenceEpisodeKey).trim()}`;
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

export type ScheduledDrainDispatchDecision =
  | { action: "dispatch" }
  | { action: "hold"; reason: "outside_send_window" };

/**
 * Drain-time send window — same as wa-followups (`isAllowedWhatsAppSendTimeIsrael`).
 * Hold means: do not dispatch; leave the row pending. Does not change due_at.
 */
export function decideScheduledDrainDispatch(
  now: Date = new Date()
): ScheduledDrainDispatchDecision {
  if (!isAllowedWhatsAppSendTimeIsrael(now)) {
    return { action: "hold", reason: "outside_send_window" };
  }
  return { action: "dispatch" };
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

