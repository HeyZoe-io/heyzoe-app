import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { requireDashboardSlugAccess } from "@/lib/dashboard-slug-guard";

import SettingsPresenceClient from "./client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function queryFromSearchParams(
  raw: Record<string, string | string[] | undefined> | undefined
): string {
  if (!raw) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, item);
    } else qs.append(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    const sp = await searchParams;
    const returnTo = `/${encodeURIComponent(slug)}/settings${queryFromSearchParams(sp)}`;
    redirect(`/dashboard/login?next=${encodeURIComponent(returnTo)}`);
  }

  const sp = await searchParams;
  const admin = createSupabaseAdminClient();
  await requireDashboardSlugAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug,
    `/settings${queryFromSearchParams(sp)}`
  );

  return (
    <SettingsPresenceClient
      slug={slug}
      isAdmin={isAdminAllowedEmail(user.user.email ?? "")}
    />
  );
}

