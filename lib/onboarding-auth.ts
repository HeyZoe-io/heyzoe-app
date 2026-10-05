import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function normalizeEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Allow writing to a business row if the caller owns the business (session) or proves
 * email matches the business row / a ready payment session for that slug
 * (onboarding success page).
 */
export async function canWriteForSlug(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string,
  userId: string | null,
  proofEmail: string
): Promise<boolean> {
  const { data: biz } = await admin.from("businesses").select("id, user_id, email").eq("slug", slug).maybeSingle();
  if (!biz) return false;
  const row = biz as { id?: unknown; user_id?: unknown; email?: unknown };
  if (userId && String(row.user_id ?? "") === userId) return true;
  if (!proofEmail) return false;
  const bizEmail = normalizeEmail(row.email);
  if (bizEmail && bizEmail === proofEmail) return true;
  const { data: ps } = await admin
    .from("payment_sessions")
    .select("id")
    .eq("slug", slug)
    .eq("email", proofEmail)
    .eq("ready", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(ps);
}

/**
 * כתיבה ממסך הדשבורד: בעלים, מייל הוכחה, אדמין פלטפורמה, או חבר ב-business_users.
 * בלי זה «חיבור למטא» מההגדרות מחזיר forbidden כשהמחובר אינו בעל השורה.
 */
export async function canWriteOnboardingForUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  slug: string,
  user: { id: string; email?: string | null } | null,
  proofEmail: string
): Promise<boolean> {
  if (await canWriteForSlug(admin, slug, user?.id ?? null, proofEmail)) return true;
  if (!user?.id) return false;
  const access = await assertBusinessAccess(admin, user, slug);
  return access.ok;
}
