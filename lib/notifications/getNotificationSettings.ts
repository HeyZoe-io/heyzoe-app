import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTING_KEYS,
  OWNER_OPT_IN_NOTIFICATION_SETTINGS,
  type NotificationSettingKey,
  type NotificationSettings,
} from "@/lib/notifications/types";

function rowToSettings(row: Record<string, unknown> | null): NotificationSettings {
  if (!row) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  const out = { ...DEFAULT_NOTIFICATION_SETTINGS };
  for (const key of NOTIFICATION_SETTING_KEYS) {
    if (typeof row[key] === "boolean") out[key] = row[key];
  }
  return out;
}

export async function getNotificationSettings(businessId: number): Promise<NotificationSettings> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("notification_settings")
      .select(NOTIFICATION_SETTING_KEYS.join(", "))
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) {
      console.warn("[notifications] getNotificationSettings:", error.message);
      return { ...DEFAULT_NOTIFICATION_SETTINGS };
    }
    return rowToSettings((data ?? null) as Record<string, unknown> | null);
  } catch (e) {
    console.warn("[notifications] getNotificationSettings failed:", e);
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

/** After owner WhatsApp opt-in — write OWNER_OPT_IN_NOTIFICATION_SETTINGS */
export async function applyOwnerOptInNotificationDefaults(
  businessId: number
): Promise<{ ok: boolean; error?: string }> {
  return upsertNotificationSettings(businessId, { ...OWNER_OPT_IN_NOTIFICATION_SETTINGS });
}

/** Create settings row when owner is connected but row is missing (e.g. failed opt-in upsert) */
export async function ensureOwnerNotificationSettingsRow(
  businessId: number
): Promise<NotificationSettings> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("notification_settings")
    .select("business_id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!error && data) {
    return getNotificationSettings(businessId);
  }
  await applyOwnerOptInNotificationDefaults(businessId);
  return { ...OWNER_OPT_IN_NOTIFICATION_SETTINGS };
}

export async function touchNotificationSettingsDailySummaryAt(businessId: number): Promise<void> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("notification_settings")
    .update({ last_daily_summary_at: now, updated_at: now })
    .eq("business_id", businessId);
  if (error) {
    console.warn("[notifications] touchDailySummaryAt:", error.message);
  }
}

export async function upsertNotificationSettings(
  businessId: number,
  settings: NotificationSettings
): Promise<{ ok: boolean; error?: string }> {
  const admin = createSupabaseAdminClient();
  const payload: Record<string, unknown> = {
    business_id: businessId,
    updated_at: new Date().toISOString(),
  };
  for (const key of NOTIFICATION_SETTING_KEYS) {
    payload[key] = Boolean(settings[key]);
  }

  const { error } = await admin.from("notification_settings").upsert(payload, {
    onConflict: "business_id",
  } as { onConflict: string });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function isNotificationEnabled(
  businessId: number,
  key: NotificationSettingKey
): Promise<boolean> {
  const settings = await getNotificationSettings(businessId);
  return settings[key] === true;
}

export function isAnyOwnerEmailNotificationEnabled(settings: NotificationSettings): boolean {
  return (
    settings.lead_registered_email === true ||
    settings.human_requested_email === true ||
    settings.daily_summary_email === true
  );
}
