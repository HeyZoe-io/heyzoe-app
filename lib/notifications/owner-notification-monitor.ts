import { normalizePhone } from "@/lib/phone-normalize";

export type OwnerNotificationMonitor = {
  email: string;
  whatsapp: string | null;
};

/**
 * העתקת התראות בעל עסק לניטור פנימי — לא מוצג בדשבורד.
 * הסר business_id מהמפה כשמסיימים לעקוב.
 */
const MONITORS_BY_BUSINESS_ID: Record<number, OwnerNotificationMonitor> = {
  974: {
    email: (process.env.OWNER_NOTIFICATION_MONITOR_EMAIL ?? "liornativ@hotmail.com").trim().toLowerCase(),
    whatsapp: normalizePhone(process.env.OWNER_NOTIFICATION_MONITOR_WHATSAPP ?? "0508318162"),
  },
};

export function getOwnerNotificationMonitor(businessId: number): OwnerNotificationMonitor | null {
  const row = MONITORS_BY_BUSINESS_ID[Number(businessId)];
  if (!row) return null;
  const email = String(row.email ?? "").trim().toLowerCase();
  if (!email) return null;
  return { email, whatsapp: row.whatsapp };
}

export function monitorWhatsappDiffersFromOwner(
  monitor: OwnerNotificationMonitor,
  ownerPhone: string | null | undefined
): boolean {
  const owner = normalizePhone(ownerPhone) ?? String(ownerPhone ?? "").replace(/\D/g, "");
  const mon = monitor.whatsapp ?? "";
  if (!mon || !owner) return Boolean(mon);
  return mon !== owner;
}
