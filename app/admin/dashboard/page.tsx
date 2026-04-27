import DashboardClient from "@/app/admin/dashboard/dashboard-client";
import { getDashboardData, resolveDateRange } from "@/lib/dashboard-data";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAdminAllowedEmail } from "@/lib/server-env";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminDashboardPage({ searchParams }: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  const allowedEmail = resolveAdminAllowedEmail();
  const email = user.user?.email?.trim().toLowerCase() ?? "";
  if (!email || email !== allowedEmail) redirect("/admin/login");

  const sp = await searchParams;
  const range = resolveDateRange(sp);
  const data = await getDashboardData(range);

  return <DashboardClient data={data} />;
}
