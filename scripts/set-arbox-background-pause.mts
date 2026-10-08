/**
 * Turns businesses.social_links.arbox_background_pause on or off for one business.
 * Only that key changes. Nothing else in social_links, and no key or setting, is touched.
 * Dry-run unless: --live --slug <business>. Production also needs ALLOW_PROD_TEST=1.
 *
 *   npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --slug acrobyjoe
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --live --slug acrobyjoe
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --live --slug acrobyjoe --off
 */
import { createClient } from "@supabase/supabase-js";
import { ARBOX_BACKGROUND_PAUSE_KEY, isArboxBackgroundPaused } from "@/lib/arbox-background-pause";
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
  const { data: biz, error } = await admin
    .from("businesses")
    .select("id, slug, social_links")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !biz) throw error ?? new Error(`business not found: ${slug}`);

  const social =
    biz.social_links && typeof biz.social_links === "object" && !Array.isArray(biz.social_links)
      ? (biz.social_links as Record<string, unknown>)
      : {};
  const before = isArboxBackgroundPaused(social);
  console.log({ slug: biz.slug, business_id: biz.id, paused_before: before, paused_after: turnOn });
  if (before === turnOn) {
    console.log("No change needed.");
    return;
  }
  if (!live) {
    console.log("[dry-run] not written.");
    return;
  }

  const next = { ...social, [ARBOX_BACKGROUND_PAUSE_KEY]: turnOn };
  const { error: writeErr } = await admin.from("businesses").update({ social_links: next }).eq("id", biz.id);
  if (writeErr) throw writeErr;

  const { data: check, error: checkErr } = await admin
    .from("businesses")
    .select("social_links")
    .eq("id", biz.id)
    .maybeSingle();
  if (checkErr) throw checkErr;
  const after = (check?.social_links ?? {}) as Record<string, unknown>;
  const keysBefore = Object.keys(social).filter((key) => key !== ARBOX_BACKGROUND_PAUSE_KEY).sort();
  const keysAfter = Object.keys(after).filter((key) => key !== ARBOX_BACKGROUND_PAUSE_KEY).sort();
  if (JSON.stringify(keysBefore) !== JSON.stringify(keysAfter)) {
    throw new Error("social_links keys changed unexpectedly");
  }
  console.log({ written: true, paused_now: isArboxBackgroundPaused(after), other_keys: keysAfter.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
