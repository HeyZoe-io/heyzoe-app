import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/notifications/types";
import { upsertNotificationSettings } from "@/lib/notifications/getNotificationSettings";
import { sendMarketingWhatsApp } from "@/lib/marketing-whatsapp";

export const HEYZOE_OWNER_PREFIX = "HEYZOE_OWNER_";
export const OWNER_WHATSAPP_CONNECT_NUMBER = "97233824981";

export function buildOwnerWhatsappConnectUrl(slug: string): string {
  const clean = String(slug ?? "").trim();
  return `https://wa.me/${OWNER_WHATSAPP_CONNECT_NUMBER}?text=${encodeURIComponent(`${HEYZOE_OWNER_PREFIX}${clean}`)}`;
}

/**
 * מטפל בהודעת חיבור HEYZOE_OWNER_{slug} בקו זואי הראשי.
 * מחזיר true אם ההודעה טופלה (גם אם נכשל מציאת עסק).
 */
export async function tryHandleHeyzoeOwnerOptIn(input: {
  senderPhone: string;
  userText: string;
}): Promise<boolean> {
  const trimmed = String(input.userText ?? "").trim();
  if (!trimmed.toUpperCase().startsWith(HEYZOE_OWNER_PREFIX)) return false;

  const slug = trimmed.slice(HEYZOE_OWNER_PREFIX.length).trim().toLowerCase();
  if (!slug) return false;

  const admin = createSupabaseAdminClient();
  const senderNorm = normalizePhone(input.senderPhone);

  const { data: biz, error } = await admin
    .from("businesses")
    .select("id, slug, name, owner_whatsapp_opted_in")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !biz?.id) {
    console.warn("[owner-opt-in] business not found for slug:", slug, error?.message);
    if (senderNorm) {
      await sendMarketingWhatsApp(
        input.senderPhone,
        "לא מצאנו עסק עם המזהה הזה. בדקו את הקישור מהדשבורד ונסו שוב."
      ).catch(() => {});
    }
    return true;
  }

  const businessId = Number(biz.id);

  const { error: upBizErr } = await admin
    .from("businesses")
    .update({ owner_whatsapp_opted_in: true })
    .eq("id", businessId);

  if (upBizErr) {
    console.error("[owner-opt-in] update business failed:", upBizErr.message);
  }

  await upsertNotificationSettings(businessId, { ...DEFAULT_NOTIFICATION_SETTINGS });

  const bizName = String((biz as { name?: string }).name ?? slug).trim() || slug;
  await sendMarketingWhatsApp(
    input.senderPhone,
    `מעולה! חיברנו את הווטסאפ שלך להתראות של ${bizName} ✅\nמעכשיו תוכלו לבחור אילו התראות לקבל בדשבורד → התראות.`
  ).catch((e) => console.error("[owner-opt-in] confirmation send failed:", e));

  console.info("[owner-opt-in] opted in:", { businessId, slug, phone: senderNorm });
  return true;
}

export function isOwnerWhatsappOptedIn(value: unknown): boolean {
  return value === true;
}
