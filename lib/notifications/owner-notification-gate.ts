import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone, normalizePhoneToE164 } from "@/lib/phone-normalize";
import { getNotificationSettings } from "@/lib/notifications/getNotificationSettings";
import type { NotificationSettingKey } from "@/lib/notifications/types";

export type OwnerNotificationGate = {
  allowed: boolean;
  ownerPhone: string | null;
  reason?: string;
};

/** האם אפשר לשלוח התראה לבעל העסק (opt-in + טלפון + הגדרה פעילה) */
export async function gateOwnerNotification(
  businessId: number,
  settingKey: NotificationSettingKey
): Promise<OwnerNotificationGate> {
  const admin = createSupabaseAdminClient();
  const { data: biz, error } = await admin
    .from("businesses")
    .select("owner_whatsapp_opted_in, owner_whatsapp_phone, user_id")
    .eq("id", businessId)
    .maybeSingle();

  if (error || !biz) {
    return { allowed: false, ownerPhone: null, reason: "business_not_found" };
  }

  if (biz.owner_whatsapp_opted_in !== true) {
    return { allowed: false, ownerPhone: null, reason: "not_opted_in" };
  }

  const ownerPhone = resolveOwnerPhoneFromBusinessRow(biz as Record<string, unknown>);
  if (!ownerPhone) {
    return { allowed: false, ownerPhone: null, reason: "missing_owner_whatsapp_phone" };
  }

  const settings = await getNotificationSettings(businessId);
  if (!settings[settingKey]) {
    return { allowed: false, ownerPhone, reason: "setting_disabled" };
  }

  return { allowed: true, ownerPhone };
}

export function resolveOwnerPhoneFromBusinessRow(biz: Record<string, unknown>): string | null {
  const stored = String(biz.owner_whatsapp_phone ?? "").trim();
  if (stored) {
    return normalizePhoneToE164(stored) ?? (normalizePhone(stored) ? `+${normalizePhone(stored)}` : null);
  }
  return null;
}
