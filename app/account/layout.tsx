import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import SlugDashboardNav from "@/app/[slug]/Nav";
import AccountSidebar from "./AccountSidebar";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("slug")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const slug = biz?.slug ? String(biz.slug) : "";

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-4">
        {slug ? <SlugDashboardNav slug={slug} /> : null}
        <div className="grid gap-4 md:grid-cols-[220px_1fr]" dir="ltr">
          <div className="md:sticky md:top-4 h-fit">
            <AccountSidebar />
          </div>
          <div dir="rtl">{children}</div>
        </div>
      </div>
    </main>
  );
}

