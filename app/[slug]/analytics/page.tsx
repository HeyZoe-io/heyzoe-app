import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireDashboardSlugAccess } from "@/lib/dashboard-slug-guard";
import AnalyticsClient from "./AnalyticsClient";

export const maxDuration = 60;

type RangeKey = "month" | "week" | "all";
type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

function resolveRangeKey(raw: unknown): RangeKey {
  const r = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim().toLowerCase();
  if (r === "week" || r === "all") return r;
  return "month";
}

/** אימות והרשאות בלבד — נתונים נטענים בצד לקוח (עם מטמון לניווט בין דפי הדשבורד). */
export default async function AnalyticsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const range = resolveRangeKey(sp.range);

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  const rangeQs = range === "month" ? "" : `?range=${range}`;
  const access = await requireDashboardSlugAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug,
    `/analytics${rangeQs}`
  );

  const planIsPremium = String(access.plan ?? "").trim().toLowerCase() === "premium";

  return <AnalyticsClient slug={slug} planIsPremium={planIsPremium} initialRange={range} />;
}
