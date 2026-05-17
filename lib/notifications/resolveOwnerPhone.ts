import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone, normalizePhoneToE164 } from "@/lib/phone-normalize";
import { resolveOwnerPhoneFromBusinessRow } from "@/lib/notifications/owner-notification-gate";

/** טלפון בעל העסק לקבלת התראות — קודם owner_whatsapp_phone, אחרת פרופיל Auth */
export async function resolveOwnerPhoneForBusiness(businessId: number): Promise<string | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: biz, error } = await admin
      .from("businesses")
      .select("user_id, owner_whatsapp_phone")
      .eq("id", businessId)
      .maybeSingle();

    if (error || !biz) return null;

    const fromColumn = resolveOwnerPhoneFromBusinessRow(biz as Record<string, unknown>);
    if (fromColumn) return fromColumn;

    const userId = String((biz as { user_id?: string }).user_id ?? "").trim();
    if (!userId) return null;

    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
    if (userErr || !userData?.user) return null;

    const u = userData.user;
    const raw =
      (typeof u.phone === "string" && u.phone.trim()) ||
      (typeof u.user_metadata?.phone === "string" ? String(u.user_metadata.phone).trim() : "") ||
      "";

    return normalizePhoneToE164(raw) ?? (normalizePhone(raw) ? `+${normalizePhone(raw)}` : null);
  } catch (e) {
    console.warn("[notifications] resolveOwnerPhoneForBusiness failed:", e);
    return null;
  }
}
