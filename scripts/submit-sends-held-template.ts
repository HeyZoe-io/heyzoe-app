/**
 * One-shot: submit the UTILITY Zoe Admin template zoe_admin_sends_held on the marketing WABA
 * and store it in marketing_whatsapp_templates (the status webhook updates it). Until it is
 * APPROVED, lib/send-plan/alerts.ts sends held alerts on zoe_admin_daily_unsent.
 * Idempotent: an existing row with that name is left alone. Sends no message.
 *
 *   npx tsx --env-file=.env.local scripts/submit-sends-held-template.ts          (prints the payload)
 *   npx tsx --env-file=.env.local scripts/submit-sends-held-template.ts --live   (submits once)
 */
import { createWabaTemplate } from "@/lib/meta-templates";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import { SENDS_HELD_TEMPLATE } from "@/lib/send-plan/alerts";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { templateComponentsMetaPolicyMessage, withNormalizedTemplateComponents } from "@/lib/template-presets";

const BODY =
  "זואי עצרה {{1}} הודעות אוטומטיות לפני השליחה.\n{{2}}\nלבדיקה, שחרור או ביטול: {{3}}\nמה שלא ישוחרר יבוטל בסוף היום.";

const components = withNormalizedTemplateComponents([
  {
    type: "BODY",
    text: BODY,
    example: {
      body_text: [["4", "תכנון בוקר: סטודיו לדוגמה: 3 מילת זמן לא תואמת, 1 משתנה ריק", "https://heyzoe.io/admin/held-sends"]],
    },
  },
]);

async function main() {
  const policy = templateComponentsMetaPolicyMessage(components);
  if (policy) throw new Error(`policy: ${policy}`);
  const admin = createSupabaseAdminClient();
  const { data: existing, error } = await admin
    .from("marketing_whatsapp_templates")
    .select("name, status, category")
    .eq("name", SENDS_HELD_TEMPLATE)
    .eq("language", "he")
    .maybeSingle();
  if (error) throw new Error(`lookup failed: ${error.message}`);
  if (existing) {
    console.log("exists, not resubmitted", existing);
    return;
  }
  if (!process.argv.includes("--live")) {
    console.log("[dry-run] would submit", JSON.stringify({ name: SENDS_HELD_TEMPLATE, category: "UTILITY", language: "he", components }, null, 2));
    return;
  }
  const wabaId = await resolveMarketingWabaId();
  if (!wabaId) throw new Error("no marketing WABA");
  const created = await createWabaTemplate(wabaId, {
    name: SENDS_HELD_TEMPLATE,
    category: "UTILITY",
    language: "he",
    components,
  });
  const { error: upsertErr } = await admin.from("marketing_whatsapp_templates").upsert(
    {
      waba_template_id: created.id,
      name: SENDS_HELD_TEMPLATE,
      category: created.category || "UTILITY",
      language: "he",
      status: created.status || "PENDING",
      components,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "name,language" }
  );
  if (upsertErr) throw new Error(`stored row failed: ${upsertErr.message}`);
  console.log("submitted", { id: created.id, status: created.status, category: created.category });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
