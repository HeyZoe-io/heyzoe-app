import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/notifications/types";
import { upsertNotificationSettings } from "@/lib/notifications/getNotificationSettings";
import { sendMarketingWhatsApp } from "@/lib/marketing-whatsapp";

export const HEYZOE_OWNER_PREFIX = "HEYZOE_OWNER_";
export const OWNER_WHATSAPP_CONNECT_NUMBER = "97233824981";

const HEYZOE_OWNER_SLUG_RE = /HEYZOE_OWNER_([a-z0-9][a-z0-9_-]*)/i;

/** הודעה שמכילה קוד חיבור התראות לבעל עסק — לא פלואו שיווקי */
export function isHeyzoeOwnerOptInMessage(text: string): boolean {
  return /HEYZOE_OWNER/i.test(String(text ?? ""));
}

export function parseHeyzoeOwnerSlugFromMessage(text: string): string | null {
  const m = String(text ?? "").match(HEYZOE_OWNER_SLUG_RE);
  const slug = m?.[1]?.trim().toLowerCase() ?? "";
  return slug || null;
}

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
  if (!isHeyzoeOwnerOptInMessage(trimmed)) return false;

  const slug = parseHeyzoeOwnerSlugFromMessage(trimmed);
  if (!slug) {
    const senderNorm = normalizePhone(input.senderPhone);
    if (senderNorm) {
      await sendMarketingWhatsApp(
        input.senderPhone,
        "לא זיהינו את מזהה העסק. שלחו בדיוק את הקישור מהדשבורד (HEYZOE_OWNER_שם-העסק) בלי טקסט נוסף."
      ).catch(() => {});
    }
    return true;
  }

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

  const ownerPhoneStored = senderNorm ?? String(input.senderPhone ?? "").replace(/\D/g, "");

  const { error: upBizErr } = await admin
    .from("businesses")
    .update({
      owner_whatsapp_opted_in: true,
      owner_whatsapp_phone: ownerPhoneStored || null,
    })
    .eq("id", businessId);

  if (upBizErr) {
    console.error("[owner-opt-in] update business failed:", upBizErr.message, { businessId, slug });
    await sendMarketingWhatsApp(
      input.senderPhone,
      "לא הצלחנו לשמור את חיבור ההתראות במערכת. ודאו שהמיגרציות ב-Supabase רצו (owner_whatsapp_opted_in / owner_whatsapp_phone) ונסו שוב, או פנו לתמיכת HeyZoe."
    ).catch(() => {});
    return true;
  }

  const settingsResult = await upsertNotificationSettings(businessId, {
    ...DEFAULT_NOTIFICATION_SETTINGS,
  });
  if (!settingsResult.ok) {
    console.error("[owner-opt-in] notification_settings upsert failed:", settingsResult.error, {
      businessId,
      slug,
    });
    await sendMarketingWhatsApp(
      input.senderPhone,
      "חיברנו את המספר אך שמירת הגדרות ההתראות נכשלה. הריצו notification_settings.sql ב-Supabase ושלחו שוב את ההודעה."
    ).catch(() => {});
    return true;
  }

  if (senderNorm) {
    await admin.from("marketing_flow_sessions").delete().eq("phone", senderNorm);
  }

  const bizName = String((biz as { name?: string }).name ?? slug).trim() || slug;
  await sendMarketingWhatsApp(
    input.senderPhone,
    `מעולה! אישרנו קבלת התראות WhatsApp לעסק ${bizName} ✅\n` +
      `מעכשיו תוכלו לבחור אילו התראות לקבל בדשבורד -> התראות.`
  ).catch((e) => console.error("[owner-opt-in] confirmation send failed:", e));

  console.info("[owner-opt-in] opted in:", { businessId, slug, phone: senderNorm });
  return true;
}

export function isOwnerWhatsappOptedIn(value: unknown): boolean {
  return value === true;
}
