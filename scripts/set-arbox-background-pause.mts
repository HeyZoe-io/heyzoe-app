/**
 * Turns businesses.arbox_background_paused on or off for one business.
 * Before that column exists, writes the legacy social_links.arbox_background_pause instead.
 * While both exist, a legacy key already present is set to the same value, so it cannot
 * keep a business paused after --off. No other key, setting or column is touched.
 * Dry-run unless: --live --slug <business>. Production also needs ALLOW_PROD_TEST=1.
 *
 *   npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --slug acrobyjoe
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --live --slug acrobyjoe
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/set-arbox-background-pause.mts --live --slug acrobyjoe --off
 */
import { createClient } from "@supabase/supabase-js";
import {
  ARBOX_BACKGROUND_PAUSE_COLUMN,
  ARBOX_BACKGROUND_PAUSE_KEY,
  arboxBackgroundPauseColumnExists,
  isArboxBackgroundPaused,
  rowArboxBackgroundPaused,
} from "@/lib/arbox-background-pause";
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
  const hasColumn = await arboxBackgroundPauseColumnExists(admin as never);
  const select = hasColumn ? `id, slug, social_links, ${ARBOX_BACKGROUND_PAUSE_COLUMN}` : "id, slug, social_links";
  const { data: biz, error } = await admin.from("businesses").select(select).eq("slug", slug).maybeSingle();
  if (error || !biz) throw error ?? new Error(`business not found: ${slug}`);
  const row = biz as unknown as Record<string, unknown>;

  const social =
    row.social_links && typeof row.social_links === "object" && !Array.isArray(row.social_links)
      ? (row.social_links as Record<string, unknown>)
      : {};
  const hasLegacyKey = Object.prototype.hasOwnProperty.call(social, ARBOX_BACKGROUND_PAUSE_KEY);
  const before = rowArboxBackgroundPaused(row);

  const patch: Record<string, unknown> = {};
  if (hasColumn && row[ARBOX_BACKGROUND_PAUSE_COLUMN] !== turnOn) patch[ARBOX_BACKGROUND_PAUSE_COLUMN] = turnOn;
  const legacyNeedsWrite = hasColumn
    ? hasLegacyKey && social[ARBOX_BACKGROUND_PAUSE_KEY] !== turnOn
    : isArboxBackgroundPaused(social) !== turnOn;
  if (legacyNeedsWrite) patch.social_links = { ...social, [ARBOX_BACKGROUND_PAUSE_KEY]: turnOn };

  console.log({
    slug: row.slug,
    business_id: row.id,
    column_exists: hasColumn,
    legacy_key_present: hasLegacyKey,
    paused_before: before,
    paused_after: turnOn,
    writes: Object.keys(patch),
  });
  if (!Object.keys(patch).length) {
    console.log("No change needed.");
    return;
  }
  if (!live) {
    console.log("[dry-run] not written.");
    return;
  }

  const { error: writeErr } = await admin.from("businesses").update(patch).eq("id", row.id);
  if (writeErr) throw writeErr;

  const { data: check, error: checkErr } = await admin.from("businesses").select(select).eq("id", row.id).maybeSingle();
  if (checkErr) throw checkErr;
  const afterRow = (check ?? {}) as unknown as Record<string, unknown>;
  const after = (afterRow.social_links ?? {}) as Record<string, unknown>;
  const keysBefore = Object.keys(social).filter((key) => key !== ARBOX_BACKGROUND_PAUSE_KEY).sort();
  const keysAfter = Object.keys(after).filter((key) => key !== ARBOX_BACKGROUND_PAUSE_KEY).sort();
  if (JSON.stringify(keysBefore) !== JSON.stringify(keysAfter)) {
    throw new Error("social_links keys changed unexpectedly");
  }
  console.log({ written: true, paused_now: rowArboxBackgroundPaused(afterRow), other_keys: keysAfter.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
