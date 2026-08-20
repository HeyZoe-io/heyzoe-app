import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { redirectToPreferredDashboardSlug } from "@/lib/dashboard-slug-guard";

/**
 * Generic shareable link: https://heyzoe.io/templates
 * Sends each logged-in owner to /{their-slug}/templates (no business slug in the URL).
 */
export default async function TemplatesShortcutPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect(`/dashboard/login?next=${encodeURIComponent("/templates")}`);
  }

  const admin = createSupabaseAdminClient();
  await redirectToPreferredDashboardSlug(
    admin,
    { id: data.user.id, email: data.user.email },
    "/templates"
  );
}
