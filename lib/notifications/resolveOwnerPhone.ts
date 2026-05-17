import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone, normalizePhoneToE164 } from "@/lib/phone-normalize";

/** טלפון בעל העסק לקבלת התראות (E.164 עם +) */
export async function resolveOwnerPhoneForBusiness(businessId: number): Promise<string | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: biz } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
    const userId = String((biz as { user_id?: string } | null)?.user_id ?? "").trim();
    if (!userId) return null;

    const { data: userData, error } = await admin.auth.admin.getUserById(userId);
    if (error || !userData?.user) return null;

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
