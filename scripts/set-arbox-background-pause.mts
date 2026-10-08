/**
 * Turns businesses.arbox_background_paused on or off for one business.
 * Writes only that column; no other column or setting is touched.
 * Dry-run unless: --live --slug <business>. Production also needs ALLOW_PROD_TEST=1.
 *
 *   npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --slug acrobyjoe
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --live --slug acrobyjoe
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --live --slug acrobyjoe --off
 */
import { createClient } from "@supabase/supabase-js";
import { ARBOX_BACKGROUND_PAUSE_COLUMN, rowArboxBackgroundPaused } from "@/lib/arbox-background-pause";
import { resolveSupabaseServiceRoleKey, resolveSupabaseUrl } from "@/lib/server-env";

async function main() {
  const { liveScriptSlug } = await import("./live-guard.mjs");
  const live = liveScriptSlug();
  if (live) {
    const { assertWarmupTestEnvironmentSafe } = await import("./warmup-test-config.mjs");
    assertWarmupTestEnvironmentSafe("set-arbox-background-pause");
  }
  const slugIndex = process.argv.indexOf("--slug");
  const slug = live ?? (slugIndex >= 0 ? String(process.argv[slugIndex + 1] ?? "").trim().toLowerCase() : "");
  if (!slug) {
    console.log("[dry-run] pass --slug <business>.");
    return;
  }
  const turnOn = !process.argv.includes("--off");

  const admin = createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
  const select = `id, slug, ${ARBOX_BACKGROUND_PAUSE_COLUMN}`;
  const { data: biz, error } = await admin.from("businesses").select(select).eq("slug", slug).maybeSingle();
  if (error || !biz) throw error ?? new Error(`business not found: ${slug}`);
  const row = biz as unknown as Record<string, unknown>;
  const before = rowArboxBackgroundPaused(row);

  console.log({ slug: row.slug, business_id: row.id, paused_before: before, paused_after: turnOn });
  if (before === turnOn) {
    console.log("No change needed.");
    return;
  }
  if (!live) {
    console.log("[dry-run] not written.");
    return;
  }

  const { error: writeErr } = await admin
    .from("businesses")
    .update({ [ARBOX_BACKGROUND_PAUSE_COLUMN]: turnOn })
    .eq("id", row.id);
  if (writeErr) throw writeErr;

  const { data: check, error: checkErr } = await admin.from("businesses").select(select).eq("id", row.id).maybeSingle();
  if (checkErr) throw checkErr;
  console.log({ written: true, paused_now: rowArboxBackgroundPaused(check) });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
