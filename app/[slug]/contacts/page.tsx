import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { normalizePhone } from "@/lib/phone-normalize";
import ContactsClient from "./client";

type Props = { params: Promise<{ slug: string }> };

export type ContactRow = {
  phone: string | null;
  full_name: string | null;
  source: string | null;
  created_at: string | null;
  opted_out: boolean | null;
  session_phase: string | null;
  trial_registered: boolean | null;
  wa_followup_stage: number | null;
  last_contact_at: string | null;
  cta_clicked_at: string | null;
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

  const businessId = biz.id;

  const { data: contacts } = await admin
    .from("contacts")
    .select(
      "phone, full_name, source, created_at, opted_out, session_phase, trial_registered, wa_followup_stage, last_contact_at"
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  const { data: conversations } = await admin
    .from("conversations")
    .select("phone, cta_clicked_at")
    .eq("business_id", businessId);

  const ctaByPhone = new Map<string, string | null>();
  for (const row of conversations ?? []) {
    const raw = row as { phone?: string; cta_clicked_at?: string | null };
    const phone = String(raw.phone ?? "").trim();
    if (!phone) continue;
    const key = normalizePhone(phone) ?? phone.replace(/\D/g, "");
    if (!key) continue;
    ctaByPhone.set(key, raw.cta_clicked_at ?? null);
  }

  const rows: ContactRow[] = ((contacts ?? []) as Omit<ContactRow, "cta_clicked_at">[]).map((c) => {
    const phone = String(c.phone ?? "").trim();
    const key = phone ? normalizePhone(phone) ?? phone.replace(/\D/g, "") : "";
    const waStage = c.wa_followup_stage != null ? Number(c.wa_followup_stage) : null;
    return {
      ...c,
      wa_followup_stage: waStage != null && Number.isFinite(waStage) ? waStage : null,
      cta_clicked_at: key ? (ctaByPhone.get(key) ?? null) : null,
    };
  });

  return <ContactsClient businessSlug={slug} initialContacts={rows} />;
}
