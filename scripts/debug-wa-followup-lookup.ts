/**
 * Quick DB lookup for phones / business slugs (prod env via --env-file=.env.local)
 */
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { evaluateBusinessWaFollowup } from "../lib/wa-followup-cron-eval";

async function main() {
  const admin = createSupabaseAdminClient();
  const slug = (process.argv[2] ?? "acrobyjoe").trim().toLowerCase();
  const phones = process.argv.slice(3).length
    ? process.argv.slice(3)
    : ["972549400776", "972508318162"];

  const { data: biz } = await admin.from("businesses").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (!biz?.id) {
    const { data: similar } = await admin.from("businesses").select("id, slug, name").ilike("slug", `%${slug.slice(0, 4)}%`);
    console.log(JSON.stringify({ error: "business_not_found", slug, similar }, null, 2));
    process.exit(1);
  }

  for (const phone of phones) {
    const { data: contact } = await admin
      .from("contacts")
      .select(
        "id, phone, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, last_contact_at, opted_out, trial_registered, source"
      )
      .eq("business_id", biz.id)
      .eq("phone", phone)
      .maybeSingle();

    if (!contact) {
      console.log(JSON.stringify({ phone, business_slug: slug, skip_reason: "no_contact_row" }, null, 2));
      continue;
    }

    const evalResult = await evaluateBusinessWaFollowup({
      admin,
      business_slug: slug,
      phone,
      contact,
    });

    const { business_slug: _s, ...evalBody } = evalResult;
    console.log(
      JSON.stringify(
        {
          phone,
          business_slug: slug,
          contact_id: contact.id,
          source: contact.source,
          wa_followup_stage: contact.wa_followup_stage,
          last_contact_at: contact.last_contact_at,
          ...evalBody,
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
