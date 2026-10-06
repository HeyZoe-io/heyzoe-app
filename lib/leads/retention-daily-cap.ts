/**
 * At most one retention message per contact per Israel calendar day.
 * Priority when several are still unsent: missed_class / missed_trial, then
 * attendance_gap, then lost_lead, then no_response. A skipped event is closed
 * for that same event (status skipped / retention_daily_cap), not moved to tomorrow.
 */
import { formatDateYmdIsrael } from "@/lib/leads/arbox-trial-attended";
import { normalizePhone } from "@/lib/phone-normalize";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const RETENTION_DAILY_CAP_REASON = "retention_daily_cap";

export const RETENTION_TRIGGER_TYPES = [
  "missed_class",
  "missed_trial",
  "attendance_gap",
  "lost_lead",
  "no_response",
] as const;

export type RetentionTriggerType = (typeof RETENTION_TRIGGER_TYPES)[number];

const RANK: Record<RetentionTriggerType, number> = {
  missed_class: 0,
  missed_trial: 0,
  attendance_gap: 1,
  lost_lead: 2,
  no_response: 3,
};

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const sentToday = new Set<string>();

export function retentionContactDayKey(businessId: number, phone: string, now: Date): string {
  const normalized = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  return `${businessId}|${normalized}|${formatDateYmdIsrael(now)}`;
}

/** In-process record of a retention send. Dry-run writes do not hit the database. */
export function markRetentionSent(businessId: number, phone: string, now: Date): void {
  sentToday.add(retentionContactDayKey(businessId, phone, now));
}

export function retentionMarkedThisProcess(businessId: number, phone: string, now: Date): boolean {
  return sentToday.has(retentionContactDayKey(businessId, phone, now));
}

function israelDayStartIso(now: Date): string {
  const ymd = formatDateYmdIsrael(now);
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    timeZoneName: "longOffset",
  })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offset ?? "");
  const sign = match?.[1] ?? "+";
  const hh = String(match?.[2] ?? "3").padStart(2, "0");
  const mm = match?.[3] ?? "00";
  return new Date(`${ymd}T00:00:00${sign}${hh}:${mm}`).toISOString();
}

export async function retentionAlreadySentToday(
  admin: Admin,
  businessId: number,
  phone: string,
  now: Date
): Promise<boolean> {
  if (retentionMarkedThisProcess(businessId, phone, now)) return true;
  const normalized = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  if (!normalized) return false;
  const { data, error } = await admin
    .from("scheduled_template_sends")
    .select("trigger_id")
    .eq("business_id", businessId)
    .eq("contact_phone", normalized)
    .eq("status", "sent")
    .gte("updated_at", israelDayStartIso(now))
    .limit(20);
  if (error || !data?.length) return false;
  const ids = [...new Set(data.map((row) => String((row as { trigger_id?: unknown }).trigger_id ?? "")).filter(Boolean))];
  if (!ids.length) return false;
  const { data: rules, error: ruleErr } = await admin
    .from("template_triggers")
    .select("trigger_type")
    .in("id", ids);
  if (ruleErr) return false;
  return (rules ?? []).some((row) =>
    (RETENTION_TRIGGER_TYPES as readonly string[]).includes(String((row as { trigger_type?: unknown }).trigger_type ?? ""))
  );
}

/** Close this event so the same row does not send tomorrow. No-op while dry-run. */
export async function closeRetentionEvent(input: {
  admin: Admin;
  businessId: number;
  triggerId: string;
  phone: string;
  templateName: string;
  dedupKey: string;
  now: Date;
}): Promise<void> {
  console.info("[retention-daily-cap] skip", {
    businessId: input.businessId,
    triggerId: input.triggerId,
    reason: RETENTION_DAILY_CAP_REASON,
  });
  if (isArboxDailyDryRun()) return;
  const phone = normalizePhone(input.phone) ?? input.phone.replace(/\D/g, "");
  const dedupKey = input.dedupKey.trim();
  if (!phone || !dedupKey) return;
  const { data: existing } = await input.admin
    .from("scheduled_template_sends")
    .select("status")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (existing) return;
  const nowIso = input.now.toISOString();
  const { error } = await input.admin.from("scheduled_template_sends").insert({
    business_id: input.businessId,
    trigger_id: input.triggerId,
    contact_phone: phone,
    template_name: input.templateName || "retention",
    due_at: nowIso,
    status: "canceled",
    dedup_key: dedupKey,
    last_error: RETENTION_DAILY_CAP_REASON,
    updated_at: nowIso,
  });
  if (error && error.code !== "23505") {
    console.error("[retention-daily-cap] close failed", error.message);
  }
}

export function retentionRank(trigger: RetentionTriggerType): number {
  return RANK[trigger];
}
