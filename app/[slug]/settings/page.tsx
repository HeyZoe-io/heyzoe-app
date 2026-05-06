import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import SettingsClient from "../../dashboard/[slug]/settings/page";

type Props = { params: Promise<{ slug: string }> };

export default async function SettingsPage(_props: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");
  return <SettingsClient />;
}

