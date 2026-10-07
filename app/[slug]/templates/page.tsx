import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireDashboardSlugAccess } from "@/lib/dashboard-slug-guard";
import { getArboxApiKey, getLeadsWebhookSecret } from "@/lib/business-secrets";
import { businessHasArboxConnection } from "@/lib/crm/types";
import { canonicalizeTriggerType } from "@/lib/template-trigger-types";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { listOpenUtilityRecategoryNotices } from "@/lib/template-category-notice";
import TemplatesClient, { type TemplateRow, type TriggerRow } from "./TemplatesClient";

type Props = { params: Promise<{ slug: string }> };

export default async function TemplatesPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    redirect(`/dashboard/login?next=${encodeURIComponent(`/${slug}/templates`)}`);
  }

  const admin = createSupabaseAdminClient();
  const access = await requireDashboardSlugAccess(
    admin,
    { id: user.user.id, email: user.user.email },
    slug,
    "/templates"
  );

  const businessId = access.id;

  const [{ data: templates, error: tplErr }, { data: biz, error: bizErr }, { data: triggers, error: trigErr }, categoryNotices] =
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
      .select(
        "id, lead_template_name, leads_webhook_secret, leads_webhook_secret_enc, waba_id, crm_type, crm_api_key, crm_api_key_enc, arbox_trial_membership_type_ids"
      )
      .eq("id", businessId)
      .maybeSingle(),
    admin
      .from("template_triggers")
      .select(
        "id, business_id, trigger_type, product_filter, item_type_filter, delay_days, delay_direction, lookback_days, template_name, enabled, created_at"
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    listOpenUtilityRecategoryNotices(admin, businessId),
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
  const leadsWebhookSecret = getLeadsWebhookSecret(biz as Record<string, unknown> | null);
  const hasWaba = Boolean(
    String((biz as { waba_id?: unknown } | null)?.waba_id ?? "")
      .trim()
      .replace(/\s+/g, "")
  );
  const hasArbox = businessHasArboxConnection(
    biz as { crm_type?: unknown } | null,
    getArboxApiKey(biz as Record<string, unknown> | null)
  );
  const trialMembershipTypeIds = (() => {
    const raw = (biz as { arbox_trial_membership_type_ids?: unknown } | null)
      ?.arbox_trial_membership_type_ids;
    if (!Array.isArray(raw)) return [];
    return [
      ...new Set(
        raw
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
          .map((n) => Math.trunc(n))
      ),
    ].sort((a, b) => a - b);
  })();

  const initialTriggers = ((triggers ?? []) as TriggerRow[]).map((row) => ({
    ...row,
    id: String((row as { id?: unknown }).id ?? ""),
    trigger_type: canonicalizeTriggerType(String(row.trigger_type)) as TriggerRow["trigger_type"],
    lookback_days:
      (row as { lookback_days?: unknown }).lookback_days == null
        ? null
        : Number((row as { lookback_days?: unknown }).lookback_days),
  }));

  return (
    <TemplatesClient
      slug={access.slug || slug}
      initialTemplates={(templates ?? []) as TemplateRow[]}
      initialCategoryNotices={categoryNotices}
      isPlatformAdmin={isAdminAllowedEmail(user.user.email ?? "")}
      initialLeadTemplateName={leadTemplateName || null}
      initialTriggers={initialTriggers}
      leadsWebhookSecret={leadsWebhookSecret}
      hasWaba={hasWaba}
      hasArbox={hasArbox}
      initialTrialMembershipTypeIds={trialMembershipTypeIds}
    />
  );
}
