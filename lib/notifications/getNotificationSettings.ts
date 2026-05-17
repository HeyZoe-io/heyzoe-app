import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTING_KEYS,
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
  return settings[key] !== false;
}
