/**
 * Test helper: clears the follow-up series lock and the follow-up stage for one contact,
 * so it behaves like a brand-new lead for follow-ups. Nothing is sent.
 * Dry-run unless: --live --slug <business>. Production also needs ALLOW_PROD_TEST=1.
 *
 *   npx tsx --env-file=.env.local scripts/reset-followup-lock.mts --phone 972508318162 --slug acrobyjoe
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/reset-followup-lock.mts --phone 972508318162 --slug acrobyjoe --live
 */
import { createClient } from "@supabase/supabase-js";
import { FOLLOWUP_SERIES_LOCK_COLUMN } from "@/lib/followup-series-lock";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { resolveSupabaseServiceRoleKey, resolveSupabaseUrl } from "@/lib/server-env";

const RESET_PATCH = {
  [FOLLOWUP_SERIES_LOCK_COLUMN]: null,
  wa_followup_stage: 0,
  wa_followup_1_sent_at: null,
  wa_followup_2_sent_at: null,
  wa_followup_3_sent_at: null,
};

async function main() {
  const { liveScriptSlug } = await import("./live-guard.mjs");
  const live = liveScriptSlug();
  if (live) {
    const { assertWarmupTestEnvironmentSafe } = await import("./warmup-test-config.mjs");
    assertWarmupTestEnvironmentSafe("reset-followup-lock");
  }
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? String(process.argv[i + 1] ?? "").trim() : "";
  };
  const slug = live ?? arg("--slug").toLowerCase();
  const phone = arg("--phone");
  if (!slug || !phone) {
    console.log("Pass --phone <number> --slug <business>.");
    return;
  }

  const admin = createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
  const { data: biz, error: bizErr } = await admin.from("businesses").select("id").eq("slug", slug).maybeSingle();
  if (bizErr || !biz) throw bizErr ?? new Error(`business not found: ${slug}`);

  const { data: rows, error } = await admin
    .from("contacts")
    .select(`id, phone, wa_followup_stage, ${FOLLOWUP_SERIES_LOCK_COLUMN}, wa_next_followup_at`)
    .eq("business_id", biz.id)
    .in("phone", contactPhoneLookupVariants(phone));
  if (error) throw error;
  if (!rows?.length) {
    console.log(`No contact for that phone in ${slug}.`);
    return;
  }
  console.log({ slug, before: rows, writes: Object.keys(RESET_PATCH) });
  if (!live) {
    console.log("[dry-run] not written.");
    return;
  }
  const ids = (rows as unknown as { id: number }[]).map((r) => r.id);
  const { error: writeErr } = await admin.from("contacts").update(RESET_PATCH).eq("business_id", biz.id).in("id", ids);
  if (writeErr) throw writeErr;
  console.log(`Reset ${ids.length} contact row(s).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
