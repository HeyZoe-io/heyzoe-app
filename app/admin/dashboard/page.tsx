import DashboardClient from "@/app/admin/dashboard/dashboard-client";
import { getDashboardData, resolveDateRange } from "@/lib/dashboard-data";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminDashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const range = resolveDateRange(sp);
  const data = await getDashboardData(range);

  return <DashboardClient data={data} />;
}
