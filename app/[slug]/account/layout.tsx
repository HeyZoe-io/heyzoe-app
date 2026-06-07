import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAccountBusinessForUserBySlug } from "@/lib/account/resolve-business";
import SlugDashboardNav from "@/app/[slug]/Nav";
import AccountSidebar from "./AccountSidebar";

type Props = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function SlugAccountLayout({ children, params }: Props) {
  const { slug: rawSlug } = await params;
  const slug = String(rawSlug ?? "").trim().toLowerCase();
  if (!slug) redirect("/dashboard/login");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/dashboard/login");

  const ctx = await resolveAccountBusinessForUserBySlug(data.user.id, slug);
  if (!ctx || ctx.slug.toLowerCase() !== slug) redirect("/dashboard/login");

  return (
    <main className="min-h-screen bg-[#f5f3ff] px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-4">
        <SlugDashboardNav slug={slug} />
        <div className="grid gap-4 md:grid-cols-[220px_1fr]" dir="ltr">
          <div className="md:sticky md:top-4 h-fit">
            <AccountSidebar slug={slug} />
          </div>
          <div dir="rtl">{children}</div>
        </div>
      </div>
    </main>
  );
}
