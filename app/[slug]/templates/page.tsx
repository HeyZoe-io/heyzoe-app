import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireDashboardSlugAccess } from "@/lib/dashboard-slug-guard";
import { businessHasArboxConnection } from "@/lib/crm/types";
import { canonicalizeTriggerType } from "@/lib/template-trigger-types";
import TemplatesClient, { type TemplateRow, type TriggerRow } from "./TemplatesClient";

type Props = { params: Promise<{ slug: string }> };

export default async function TemplatesPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/dashboard/login");

  const admin = createSupabaseAdminClient();
  const access = await requireDashboardSlugAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug,
    "/templates"
  );

  const businessId = access.id;

  const [{ data: templates, error: tplErr }, { data: biz, error: bizErr }, { data: triggers, error: trigErr }] =
    await Promise.all([
    admin
      .from("whatsapp_templates")
      .select(
        "id, business_id, waba_template_id, name, category, language, status, disabled, components, created_at, updated_at"
      )
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false }),
    admin
      .from("businesses")
      .select("lead_template_name, leads_webhook_secret, waba_id, crm_type, crm_api_key")
      .eq("id", businessId)
      .maybeSingle(),
    admin
      .from("template_triggers")
      .select(
        "id, business_id, trigger_type, product_filter, delay_days, delay_direction, template_name, enabled, created_at"
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
  ]);

  if (tplErr) {
    console.error("[templates/page] list failed:", tplErr.message);
  }
  if (bizErr) {
    console.error("[templates/page] business meta failed:", bizErr.message);
  }
  if (trigErr) {
    console.error("[templates/page] triggers list failed:", trigErr.message);
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
  const hasArbox = businessHasArboxConnection(
    biz as { crm_type?: unknown; crm_api_key?: unknown } | null
  );

  const initialTriggers = ((triggers ?? []) as TriggerRow[]).map((row) => ({
    ...row,
    trigger_type: canonicalizeTriggerType(String(row.trigger_type)) as TriggerRow["trigger_type"],
  }));

  return (
    <TemplatesClient
      slug={access.slug || slug}
      initialTemplates={(templates ?? []) as TemplateRow[]}
      initialLeadTemplateName={leadTemplateName || null}
      initialTriggers={initialTriggers}
      leadsWebhookSecret={leadsWebhookSecret}
      hasWaba={hasWaba}
      hasArbox={hasArbox}
    />
  );
}
