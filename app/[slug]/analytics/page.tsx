import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
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
  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug, user_id, plan")
    .eq("slug", slug)
    .maybeSingle();

  if (!biz) notFound();

  const planIsPremium = String((biz as { plan?: unknown }).plan ?? "").trim().toLowerCase() === "premium";

  const isOwner = String(biz.user_id) === user.user.id;
  const isAdminViewer = isAdminAllowedEmail(user.user.email ?? "");
  if (!isOwner && !isAdminViewer) {
    const { data: bu } = await admin
      .from("business_users")
      .select("role")
      .eq("business_id", biz.id)
      .eq("user_id", user.user.id)
      .maybeSingle();
    const allowed = bu?.role === "admin";
    if (!allowed) redirect(`/${slug}/conversations`);
  }

  return <AnalyticsClient slug={slug} planIsPremium={planIsPremium} initialRange={range} />;
}
