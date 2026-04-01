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
  // Prefer membership (works for invited users), then fall back to owned business.
  const { data: membership } = await admin
    .from("business_users")
    .select("business_id, is_primary")
    .eq("user_id", data.user.id)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();

  let slug = "";
  if (membership?.business_id) {
    const { data: biz } = await admin
      .from("businesses")
      .select("slug")
      .eq("id", membership.business_id)
      .maybeSingle();
    slug = biz?.slug ? String(biz.slug) : "";
  }

  if (!slug) {
    const { data: owned } = await admin
      .from("businesses")
      .select("slug")
      .eq("user_id", data.user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    slug = owned?.slug ? String(owned.slug) : "";
  }

  return (
    <main className="min-h-screen bg-[#f5f3ff] px-4 py-6" dir="rtl">
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

