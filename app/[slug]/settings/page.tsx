import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import SettingsClient from "../../dashboard/[slug]/settings/page";

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
  return <SettingsClient />;
}

