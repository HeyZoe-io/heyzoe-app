import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import TemplatesClient, { type TemplateRow } from "./TemplatesClient";

type Props = { params: Promise<{ slug: string }> };

export default async function TemplatesPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug
  );
  if (!access.ok) {
    if (access.status === 404) notFound();
    redirect(`/${slug}/conversations`);
  }

  const businessId = access.business.id;

  const [{ data: templates, error: tplErr }, { data: biz, error: bizErr }] = await Promise.all([
    admin
      .from("whatsapp_templates")
      .select(
        "id, business_id, waba_template_id, name, category, language, status, components, created_at, updated_at"
      )
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false }),
    admin
      .from("businesses")
      .select("lead_template_name, leads_webhook_secret, waba_id")
      .eq("id", businessId)
      .maybeSingle(),
  ]);

  if (tplErr) {
    console.error("[templates/page] list failed:", tplErr.message);
  }
  if (bizErr) {
    console.error("[templates/page] business meta failed:", bizErr.message);
  }

  const leadTemplateName = String(
    (biz as { lead_template_name?: unknown } | null)?.lead_template_name ?? ""
  ).trim();
  const leadsWebhookSecret = String(
    (biz as { leads_webhook_secret?: unknown } | null)?.leads_webhook_secret ?? ""
  ).trim();
  const hasWaba = Boolean(
    String((biz as { waba_id?: unknown } | null)?.waba_id ?? "")
      .trim()
      .replace(/\s+/g, "")
  );

  return (
    <TemplatesClient
      slug={access.business.slug || slug}
      initialTemplates={(templates ?? []) as TemplateRow[]}
      initialLeadTemplateName={leadTemplateName || null}
      leadsWebhookSecret={leadsWebhookSecret}
      hasWaba={hasWaba}
    />
  );
}
