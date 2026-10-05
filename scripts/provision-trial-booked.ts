/**
 * One-shot: UTILITY template + trial_booked trigger (created disabled) for every Arbox business with a WABA.
 * Idempotent. Does not seed booking logs — the next trial-sync pass seeds without sending.
 *
 *   npx tsx --env-file=.env.local scripts/provision-trial-booked.ts
 */
import { createWabaTemplate } from "@/lib/meta-templates";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  presetExampleForSlot,
  TEMPLATE_PRESETS,
  uniqueTemplateName,
} from "@/lib/template-presets";

const preset = TEMPLATE_PRESETS.trial_booked;
const slots = ["first_name", "class_name", "class_date", "class_time"] as const;

function components() {
  return [
    {
      type: "BODY",
      text: preset.body,
      example: { body_text: [slots.map((slot) => presetExampleForSlot(slot))] },
    },
  ];
}

async function main() {
  const admin = createSupabaseAdminClient();
  const { data: businesses, error } = await admin
    .from("businesses")
    .select("id, slug, waba_id")
    .eq("crm_type", "arbox")
    .not("waba_id", "is", null);
  if (error) throw new Error(error.message);

  for (const raw of businesses ?? []) {
    const businessId = Number((raw as { id?: unknown }).id);
    const slug = String((raw as { slug?: unknown }).slug ?? "");
    const wabaId = String((raw as { waba_id?: unknown }).waba_id ?? "")
      .trim()
      .replace(/\s+/g, "");
    if (!wabaId) continue;

    const { data: existingTrigger } = await admin
      .from("template_triggers")
      .select("id, template_name")
      .eq("business_id", businessId)
      .eq("trigger_type", "trial_booked")
      .limit(1)
      .maybeSingle();
    if (existingTrigger?.id) {
      console.info("skip trigger exists", slug);
      continue;
    }

    const { data: names } = await admin
      .from("whatsapp_templates")
      .select("name")
      .eq("business_id", businessId);
    const templateName = uniqueTemplateName(
      preset.name,
      (names ?? []).map((row) => String((row as { name?: unknown }).name ?? ""))
    );

    let templateId = "";
    let status = "PENDING";
    const { data: already } = await admin
      .from("whatsapp_templates")
      .select("waba_template_id, status, name")
      .eq("business_id", businessId)
      .eq("name", templateName)
      .eq("language", "he")
      .maybeSingle();
    if (already && (already as { waba_template_id?: unknown }).waba_template_id) {
      templateId = String((already as { waba_template_id?: unknown }).waba_template_id);
      status = String((already as { status?: unknown }).status ?? "PENDING");
      console.info("reuse template", slug, templateName, status);
    } else {
      const created = await createWabaTemplate(wabaId, {
        name: templateName,
        category: preset.category,
        language: "he",
        components: components(),
      });
      templateId = created.id;
      status = created.status || "PENDING";
      const nowIso = new Date().toISOString();
      const { error: upsertErr } = await admin.from("whatsapp_templates").upsert(
        {
          business_id: businessId,
          waba_template_id: templateId,
          name: templateName,
          category: created.category || preset.category,
          language: "he",
          status,
          components: components(),
          updated_at: nowIso,
        },
        { onConflict: "business_id,name,language" }
      );
      if (upsertErr) throw new Error(`${slug} upsert: ${upsertErr.message}`);
      console.info("created template", slug, templateName, status);
    }

    const { error: trigErr } = await admin.from("template_triggers").insert({
      business_id: businessId,
      trigger_type: "trial_booked",
      delay_days: 0,
      delay_direction: "after",
      template_name: templateName,
      enabled: false,
    });
    if (trigErr) throw new Error(`${slug} trigger: ${trigErr.message}`);
    console.info("created trigger", slug, templateName);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
