/**
 * Diagnose why registered_after_trial did / did not send for a phone.
 *
 *   npx tsx --env-file=.env.local scripts/debug-registered-after-trial.ts tights 972523602070
 */
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { contactPhoneLookupVariants } from "../lib/phone-normalize";

async function main() {
  const admin = createSupabaseAdminClient();
  const slug = (process.argv[2] ?? "tights").trim().toLowerCase();
  const phone = (process.argv[3] ?? "972523602070").trim();

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select(
      "id, slug, name, arbox_trial_membership_type_ids, arbox_post_trial_followup_seeded, arbox_sales_sync_seeded"
    )
    .eq("slug", slug)
    .maybeSingle();
  if (bizErr || !biz?.id) {
    console.log(JSON.stringify({ error: "business_not_found", slug, bizErr: bizErr?.message ?? null }, null, 2));
    process.exit(1);
  }

  const variants = contactPhoneLookupVariants(phone);
  const { data: contacts } = await admin
    .from("contacts")
    .select("id, phone, full_name, arbox_user_id, trial_registered, trial_registered_at, opted_out")
    .eq("business_id", biz.id)
    .in("phone", variants)
    .limit(5);

  const { data: rules } = await admin
    .from("template_triggers")
    .select(
      "id, trigger_type, enabled, delay_days, delay_direction, template_name, product_filter, created_at, updated_at"
    )
    .eq("business_id", biz.id)
    .in("trigger_type", ["registered_after_trial", "purchase", "first_paid_purchase"]);

  const contactIds = (contacts ?? []).map((c) => c.id);
  const arboxUserIds = (contacts ?? [])
    .map((c) => Number(c.arbox_user_id))
    .filter((n) => Number.isFinite(n) && n > 0);

  const [{ data: logs }, { data: purchaseLogs }, { data: scheduled }, { data: messages }, { data: templates }] =
    await Promise.all([
      arboxUserIds.length
        ? admin
            .from("arbox_post_trial_followup_sync_log")
            .select("trigger_id, user_id, class_date, outcome, status, attempts, processed_at")
            .eq("business_id", biz.id)
            .in("user_id", arboxUserIds)
            .order("processed_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      contactIds.length
        ? admin
            .from("arbox_trial_sync_log")
            .select("sale_id, trigger_id, contact_id, processed_at")
            .eq("business_id", biz.id)
            .in("contact_id", contactIds)
            .order("processed_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      admin
        .from("scheduled_template_sends")
        .select("template_name, status, due_at, dedup_key, last_error, updated_at")
        .eq("business_id", biz.id)
        .in("contact_phone", variants)
        .order("updated_at", { ascending: false })
        .limit(20),
      admin
        .from("messages")
        .select("created_at, role, model_used, content")
        .eq("business_slug", slug)
        .or(variants.map((p) => `session_id.ilike.%${p}`).join(","))
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("whatsapp_templates")
        .select("name, status, disabled, language")
        .eq("business_id", biz.id)
        .or("name.eq.registered_after_trial,name.eq.purchase_thanks,name.eq.registered_after_trial1"),
    ]);

  console.log(
    JSON.stringify(
      {
        business: biz,
        phone_variants: variants,
        contacts: contacts ?? [],
        rules: rules ?? [],
        templates: templates ?? [],
        post_trial_sync_log: logs ?? [],
        purchase_sync_log: purchaseLogs ?? [],
        scheduled_template_sends: scheduled ?? [],
        recent_messages: (messages ?? []).map((m) => ({
          created_at: m.created_at,
          role: m.role,
          model_used: m.model_used,
          content: String(m.content ?? "").slice(0, 180),
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
