/**
 * At most one retention message per contact per Israel calendar day.
 * Inside one run the in-memory set keeps missed_class / missed_trial ahead of
 * attendance_gap ahead of lost_lead. Across crons the first send of the day
 * wins: scheduled_template_sends status=sent, or a sync-log row status=sent
 * whose processed_at is today. A skipped event is closed for that same event
 * (status skipped / retention_daily_cap), not moved to tomorrow.
 */
import { formatDateYmdIsrael } from "@/lib/leads/arbox-trial-attended";
import { contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import { isArboxDailyDryRun } from "@/lib/leads/arbox-daily-run-flag";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const RETENTION_DAILY_CAP_REASON = "retention_daily_cap";

export const RETENTION_TRIGGER_TYPES = [
  "missed_class",
  "missed_trial",
  "attendance_gap",
  "lost_lead",
  "no_response",
  "lead_status_changed",
] as const;

export type RetentionTriggerType = (typeof RETENTION_TRIGGER_TYPES)[number];

const RANK: Record<RetentionTriggerType, number> = {
  missed_class: 0,
  missed_trial: 0,
  attendance_gap: 1,
  lost_lead: 2,
  no_response: 3,
  lead_status_changed: 4,
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

/** A send that may have reached the contact counts: sent, a claim left at sending, an unknown outcome. */
const RETENTION_COUNTED_STATUSES = ["sent", "sending", "unknown"];

const RETENTION_SYNC_LOGS = [
  { table: "arbox_missed_class_sync_log", idColumn: "user_id" },
  { table: "arbox_attendance_gap_sync_log", idColumn: "user_id" },
  { table: "arbox_lost_lead_sync_log", idColumn: "lead_id" },
  { table: "arbox_lead_status_change_sync_log", idColumn: "lead_id" },
] as const;

async function retentionSyncLogSentToday(
  admin: Admin,
  businessId: number,
  phone: string,
  now: Date
): Promise<boolean> {
  const variants = [...new Set(contactPhoneLookupVariants(phone))];
  if (!variants.length) return false;
  const { data: contacts, error: contactErr } = await admin
    .from("contacts")
    .select("id, arbox_user_id")
    .eq("business_id", businessId)
    .in("phone", variants)
    .limit(8);
  if (contactErr || !contacts?.length) return false;
  const contactIds = [
    ...new Set(
      contacts
        .map((row) => String((row as { id?: unknown }).id ?? "").trim())
        .filter(Boolean)
    ),
  ];
  const userIds = [
    ...new Set(
      contacts
        .map((row) => Number((row as { arbox_user_id?: unknown }).arbox_user_id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const since = israelDayStartIso(now);
  for (const source of RETENTION_SYNC_LOGS) {
    if (contactIds.length) {
      const { data, error } = await admin
        .from(source.table)
        .select("status")
        .eq("business_id", businessId)
        .in("status", RETENTION_COUNTED_STATUSES)
        .gte("processed_at", since)
        .in("contact_id", contactIds)
        .limit(1);
      if (!error && data?.length) return true;
    }
    if (userIds.length) {
      const { data, error } = await admin
        .from(source.table)
        .select("status")
        .eq("business_id", businessId)
        .in("status", RETENTION_COUNTED_STATUSES)
        .gte("processed_at", since)
        .in(source.idColumn, userIds)
        .limit(1);
      if (!error && data?.length) return true;
    }
  }
  return false;
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
    .in("status", RETENTION_COUNTED_STATUSES)
    .gte("updated_at", israelDayStartIso(now))
    .limit(20);
  if (!error && data?.length) {
    const ids = [...new Set(data.map((row) => String((row as { trigger_id?: unknown }).trigger_id ?? "")).filter(Boolean))];
    if (ids.length) {
      const { data: rules, error: ruleErr } = await admin
        .from("template_triggers")
        .select("trigger_type")
        .in("id", ids)
        .limit(20);
      if (!ruleErr) {
        const hit = (rules ?? []).some((row) =>
          (RETENTION_TRIGGER_TYPES as readonly string[]).includes(
            String((row as { trigger_type?: unknown }).trigger_type ?? "")
          )
        );
        if (hit) return true;
      }
    }
  }
  return retentionSyncLogSentToday(admin, businessId, normalized, now);
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
