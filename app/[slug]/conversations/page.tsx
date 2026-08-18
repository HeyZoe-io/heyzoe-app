import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireDashboardSlugAccess } from "@/lib/dashboard-slug-guard";
import ConversationsClient from "./client";

type Props = { params: Promise<{ slug: string }> };

export default async function ConversationsPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  await requireDashboardSlugAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug,
    "/conversations"
  );

  // Auth only — list loads on the client. Preloading every session here 504'd
  // Vercel Hobby (~10s) for high-volume studios like Limitless.
  return <ConversationsClient slug={slug} initialSessions={[]} />;
}
