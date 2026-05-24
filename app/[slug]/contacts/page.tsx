import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { loadLeadsForBusiness } from "@/lib/leads-data";
import ContactsClient from "./client";

type Props = { params: Promise<{ slug: string }> };

export type { LeadRow as ContactRow } from "@/lib/leads-types";

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

  const rows = await loadLeadsForBusiness(admin, biz.id);

  return <ContactsClient businessSlug={slug} initialContacts={rows} />;
}
