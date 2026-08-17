import { notFound, redirect } from "next/navigation";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import {
  assertBusinessAccess,
  loadAccessibleBusinesses,
  pickPreferredBusiness,
  type AssertBusinessAccessBusiness,
} from "@/lib/dashboard-business-access";

export async function redirectToPreferredDashboardSlug(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  user: { id: string; email?: string | null },
  pathAfterSlug: string
): Promise<never> {
  const accessible = await loadAccessibleBusinesses(admin, user.id, {
    adminAll: isAdminAllowedEmail(user.email ?? ""),
  });
  const preferred = pickPreferredBusiness(accessible, user.id);
  const slug = String(preferred?.slug ?? "").trim();
  if (!slug) redirect("/register");
  const suffix = pathAfterSlug.startsWith("/") ? pathAfterSlug : `/${pathAfterSlug}`;
  redirect(`/${encodeURIComponent(slug)}${suffix}`);
}

/** גישה לסלאג הנוכחי; ב-403 מעבירים לדשבורד של המשתמש במקום דף ריק */
export async function requireDashboardSlugAccess(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  user: { id: string; email?: string | null },
  slug: string,
  pathAfterSlug: string
): Promise<AssertBusinessAccessBusiness> {
  const access = await assertBusinessAccess(admin, user, slug);
  if (access.ok) return access.business;
  if (access.status === 404) notFound();
  return redirectToPreferredDashboardSlug(admin, user, pathAfterSlug);
}
