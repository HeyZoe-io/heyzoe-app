/**
 * Quick DB lookup for phones / business slugs (prod env via --env-file=.env.local)
 */
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { evaluateBusinessWaFollowup } from "../lib/wa-followup-cron-eval";
import { contactPhoneLookupVariants } from "../lib/phone-normalize";

async function main() {
  const admin = createSupabaseAdminClient();
  const slug = (process.argv[2] ?? "acrobyjoe").trim().toLowerCase();
  const phones = process.argv.slice(3).length
    ? process.argv.slice(3)
    : ["972549400776", "972508318162"];

  const { data: bizRows, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, name")
    .eq("slug", slug)
    .limit(5);
  const biz = (bizRows?.[0] ?? null) as { id?: number; slug?: string; name?: string } | null;
  if (!biz?.id) {
    const { data: similar, error: similarErr } = await admin
      .from("businesses")
      .select("id, slug, name")
      .ilike("slug", `%${slug.slice(0, 4)}%`)
      .limit(10);
    console.log(
      JSON.stringify(
        {
          error: "business_not_found",
          slug,
          biz_query_error: bizErr?.message ?? null,
          biz_rows_found: bizRows?.length ?? 0,
          biz_rows_sample: bizRows ?? [],
          similar_query_error: similarErr?.message ?? null,
          similar,
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  for (const phone of phones) {
    const lookupVariants = contactPhoneLookupVariants(phone);
    const { data: rows } = await admin
      .from("contacts")
      .select(
        "id, phone, wa_followup_stage, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at, last_contact_at, opted_out, trial_registered, source"
      )
      .eq("business_id", biz.id)
      .in("phone", lookupVariants)
      .limit(1);

    const contact = rows?.[0] ?? null;
    if (!contact) {
      console.log(
        JSON.stringify(
          { phone, business_slug: slug, skip_reason: "no_contact_row", phone_lookup_variants: lookupVariants },
          null,
          2
        )
      );
      continue;
    }

    const contactPhone = String(contact.phone ?? "").trim();
    const evalResult = await evaluateBusinessWaFollowup({
      admin,
      business_slug: slug,
      phone: contactPhone,
      contact,
    });

    const evalBody = Object.fromEntries(Object.entries(evalResult).filter(([key]) => key !== "business_slug"));
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
