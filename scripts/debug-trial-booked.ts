/**
 * Diagnose why trial_booked did / did not send for a phone.
 *
 *   npx tsx --env-file=.env.local scripts/debug-trial-booked.ts tights 972526614206
 */
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { contactPhoneLookupVariants } from "../lib/phone-normalize";

async function main() {
  const admin = createSupabaseAdminClient();
  const slug = (process.argv[2] ?? "tights").trim().toLowerCase();
  const phone = (process.argv[3] ?? "972526614206").trim();

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select(
      "id, slug, name, arbox_trial_membership_type_ids, arbox_trial_booking_confirm_seeded, crm_type, waba_id"
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
    .select(
      "id, phone, full_name, arbox_user_id, trial_registered, trial_registered_at, opted_out, session_phase"
    )
    .eq("business_id", biz.id)
    .in("phone", variants)
    .limit(5);

  const { data: rules } = await admin
    .from("template_triggers")
    .select(
      "id, trigger_type, enabled, delay_days, delay_direction, template_name, product_filter, created_at, updated_at"
    )
    .eq("business_id", biz.id)
    .eq("trigger_type", "trial_booked");

  const contactIds = (contacts ?? []).map((c) => c.id);
  const arboxUserIds = (contacts ?? [])
    .map((c) => Number(c.arbox_user_id))
    .filter((n) => Number.isFinite(n) && n > 0);

  const templateNames = [
    ...new Set(
      (rules ?? [])
        .map((r) => String((r as { template_name?: unknown }).template_name ?? "").trim())
        .filter(Boolean)
        .concat(["trial_booked"])
    ),
  ];

  const [{ data: logs }, { data: scheduled }, { data: messages }, { data: templates }] =
    await Promise.all([
      arboxUserIds.length
        ? admin
            .from("arbox_trial_booking_confirm_log")
            .select(
              "trigger_id, user_id, class_date, class_time, class_name, status, confirm_status, template_status, channel, attempts, processed_at"
            )
            .eq("business_id", biz.id)
            .in("user_id", arboxUserIds)
            .order("processed_at", { ascending: false })
            .limit(30)
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
        .limit(40),
      admin
        .from("whatsapp_templates")
        .select("name, status, disabled, language, category")
        .eq("business_id", biz.id)
        .in("name", templateNames),
    ]);

  const trialBookedInMessages = (messages ?? []).filter((m) => {
    const content = String((m as { content?: unknown }).content ?? "");
    const model = String((m as { model_used?: unknown }).model_used ?? "");
    return /trial_booked|אימון הניסיון|קיבלנו את ההרשמה/i.test(`${content}\n${model}`);
  });

  console.log(
    JSON.stringify(
      {
        business: biz,
        phone_variants: variants,
        contacts: contacts ?? [],
        contact_ids: contactIds,
        arbox_user_ids: arboxUserIds,
        trial_booked_rules: rules ?? [],
        templates: templates ?? [],
        booking_confirm_log: logs ?? [],
        scheduled_template_sends: scheduled ?? [],
        trial_booked_like_messages: trialBookedInMessages.map((m) => ({
          created_at: (m as { created_at?: unknown }).created_at,
          role: (m as { role?: unknown }).role,
          model_used: (m as { model_used?: unknown }).model_used,
          content: String((m as { content?: unknown }).content ?? "").slice(0, 220),
        })),
        recent_messages: (messages ?? []).map((m) => ({
          created_at: (m as { created_at?: unknown }).created_at,
          role: (m as { role?: unknown }).role,
          model_used: (m as { model_used?: unknown }).model_used,
          content: String((m as { content?: unknown }).content ?? "").slice(0, 180),
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
