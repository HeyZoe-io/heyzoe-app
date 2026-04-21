import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import ContactsClient from "./client";

type Props = { params: Promise<{ slug: string }> };

type ContactRow = {
  phone: string | null;
  full_name: string | null;
  source: string | null;
  created_at: string | null;
  opted_out: boolean | null;
};

export default async function ContactsPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!biz) notFound();

  const isOwner = String(biz.user_id) === user.user.id;
  if (!isOwner) {
    const { data: bu } = await admin
      .from("business_users")
      .select("role")
      .eq("business_id", biz.id)
      .eq("user_id", user.user.id)
      .maybeSingle();
    const allowed = bu?.role === "admin";
    if (!allowed) redirect(`/${slug}/conversations`);
  }

  const { data: contacts } = await admin
    .from("contacts")
    .select("phone, full_name, source, created_at, opted_out")
    .eq("business_id", biz.id)
    .order("created_at", { ascending: false });

  const rows = (contacts ?? []) as ContactRow[];

  return (
    <ContactsClient businessSlug={slug} initialContacts={rows} />
  );
}

