import { notFound, redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type PageProps = { params: Promise<{ slug: string }> };

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const admin = createSupabaseAdminClient();
  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (!business) notFound();

  redirect(`/${slug}/analytics`);
}
