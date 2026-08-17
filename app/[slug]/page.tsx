import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireDashboardSlugAccess } from "@/lib/dashboard-slug-guard";

type PageProps = { params: Promise<{ slug: string }> };

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect(`/dashboard/login?next=${encodeURIComponent(`/${slug}`)}`);
  }

  const admin = createSupabaseAdminClient();
  const business = await requireDashboardSlugAccess(
    admin,
    { id: data.user.id, email: data.user.email },
    slug,
    "/analytics"
  );
  redirect(`/${encodeURIComponent(String(business.slug || slug))}/analytics`);
}
