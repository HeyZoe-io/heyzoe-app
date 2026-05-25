/**
 * Usage (from repo root, with Supabase env loaded):
 *   npx tsx --env-file=.env.local scripts/debug-wa-followup-skip.ts <phone> <business_slug>
 * Example:
 *   npx tsx --env-file=.env.local scripts/debug-wa-followup-skip.ts 972549400776 acrobyjoe
 *
 * Production (after deploy): GET with CRON_SECRET
 *   /api/cron/wa-followups?debug_phone=972...&debug_slug=acrobyjoe
 */
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { evaluateBusinessWaFollowup } from "../lib/wa-followup-cron-eval";
import { contactPhoneLookupVariants } from "../lib/phone-normalize";

async function main() {
  const phone = process.argv[2]?.trim();
  const slug = (process.argv[3] ?? "acrobyjoe").trim().toLowerCase();
  if (!phone) {
    console.error("Usage: npx tsx scripts/debug-wa-followup-skip.ts <phone> [business_slug]");
    process.exit(1);
  }

  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin.from("businesses").select("id").eq("slug", slug).maybeSingle();
  if (!biz?.id) {
    console.error("Business not found:", slug);
    process.exit(1);
  }

  const lookupVariants = contactPhoneLookupVariants(phone);
  const { data: rows, error } = await admin
    .from("contacts")
    .select(
      "id, phone, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, last_contact_at, opted_out, trial_registered"
    )
    .eq("business_id", biz.id)
    .in("phone", lookupVariants)
    .limit(1);

  if (error) {
    console.error("contacts query error:", error.message);
    process.exit(1);
  }
  const contact = rows?.[0] ?? null;
  if (!contact) {
    console.log(
      JSON.stringify(
        { phone, business_slug: slug, skip_reason: "no_contact_row", phone_lookup_variants: lookupVariants },
        null,
        2
      )
    );
    process.exit(0);
  }

  const contactPhone = String(contact.phone ?? "").trim();
  const result = await evaluateBusinessWaFollowup({
    admin,
    business_slug: slug,
    phone: contactPhone,
    contact,
  });

  const evalBody = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "business_slug"));
  console.log(
    JSON.stringify(
      {
        phone,
        business_slug: slug,
        contact_id: contact.id,
        wa_followup_stage: contact.wa_followup_stage,
        last_contact_at: contact.last_contact_at,
        wa_followup_1_sent_at: contact.wa_followup_1_sent_at,
        wa_followup_2_sent_at: contact.wa_followup_2_sent_at,
        wa_followup_3_sent_at: contact.wa_followup_3_sent_at,
        ...evalBody,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
