import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) redirect("/admin/login");

  const { slug } = await params;
  const clean = String(slug ?? "").trim().toLowerCase();
  if (!clean) redirect("/admin/dashboard");

  // For now: jump to the business dashboard.
  redirect(`/${encodeURIComponent(clean)}/settings`);
}

