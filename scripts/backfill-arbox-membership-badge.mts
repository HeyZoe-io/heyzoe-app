/**
 * One-off backfill for contacts.arbox_membership_status.
 * Same lookup as an inbound refresh: searchUser + unfiltered /v3/users/memberships.
 * Dry-run unless: --live --slug <business>
 * Production also needs ALLOW_PROD_TEST=1.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-arbox-membership-badge.mts --slug acrobyjoe
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/backfill-arbox-membership-badge.mts --live --slug acrobyjoe
 */
import { createClient } from "@supabase/supabase-js";
import { isArboxBackgroundPaused } from "@/lib/arbox-background-pause";
import { ARBOX_MEMBERSHIP_BADGE_REFRESH_MS } from "@/lib/arbox-membership-badge";
import { getArboxApiKey } from "@/lib/business-secret-read";
import { resolveSupabaseServiceRoleKey, resolveSupabaseUrl } from "@/lib/server-env";
import { refreshArboxMembershipBadge } from "@/lib/arbox-membership-badge-sync";

const PAGE = 500;
const GAP_MS = 400;

function mask(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { liveScriptSlug } = await import("./live-guard.mjs");
  const slug = liveScriptSlug();
  if (slug) {
    const { assertWarmupTestEnvironmentSafe } = await import("./warmup-test-config.mjs");
    assertWarmupTestEnvironmentSafe("backfill-arbox-membership-badge");
  }
  const admin = createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
  const requested =
    slug ??
    (() => {
      const i = process.argv.indexOf("--slug");
      return i >= 0 ? String(process.argv[i + 1] ?? "").trim().toLowerCase() : "";
    })();
  if (!requested) {
    console.log("[dry-run] pass --slug <business> to count contacts. Add --live to write.");
    return;
  }

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, crm_type, crm_api_key, crm_api_key_enc, crm_box_id, social_links")
    .ilike("slug", requested)
    .maybeSingle();
  if (bizErr || !biz) throw bizErr ?? new Error(`business not found: ${requested}`);
  if (isArboxBackgroundPaused(biz.social_links)) {
    console.log(`[backfill] ${requested} has social_links.arbox_background_pause — no Arbox calls.`);
    return;
  }
  if (String(biz.crm_type ?? "").trim().toLowerCase() !== "arbox") {
    throw new Error(`${requested} is not an Arbox business`);
  }
  const apiKey = getArboxApiKey(biz as Record<string, unknown>);
  const boxId = String(biz.crm_box_id ?? "").trim();
  if (!apiKey || !boxId) throw new Error(`${requested} is missing an Arbox key or box id`);

  const cutoff = new Date(Date.now() - ARBOX_MEMBERSHIP_BADGE_REFRESH_MS).toISOString();
  const contacts: { id: string; phone: string }[] = [];
  for (let off = 0; off < 20000; off += PAGE) {
    const { data, error } = await admin
      .from("contacts")
      .select("id, phone")
      .eq("business_id", biz.id)
      .or(`arbox_membership_checked_at.is.null,arbox_membership_checked_at.lt.${cutoff}`)
      .order("created_at", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) {
      if (/arbox_membership_checked_at/.test(error.message)) {
        throw new Error("Run supabase/contacts_arbox_membership_status.sql first.");
      }
      throw error;
    }
    const rows = data ?? [];
    for (const row of rows) {
      const phone = String(row.phone ?? "").trim();
      if (phone) contacts.push({ id: String(row.id), phone });
    }
    if (rows.length < PAGE) break;
  }

  console.log(
    `[membership-badge] ${requested}: ${contacts.length} contacts to check, about ${contacts.length * 2} Arbox calls`
  );
  if (!slug) return;

  let wrote = 0;
  let failed = 0;
  for (const contact of contacts) {
    const result = await refreshArboxMembershipBadge({
      businessId: Number(biz.id),
      contactId: contact.id,
      phone: contact.phone,
      apiKey,
      boxId,
    });
    if (result.wrote) wrote += 1;
    else failed += 1;
    if ((wrote + failed) % 25 === 0) {
      console.log(`[membership-badge] ${wrote} written, ${failed} skipped, last ${mask(contact.phone)}`);
    }
    await sleep(GAP_MS);
  }
  console.log(`[membership-badge] done. written ${wrote}, skipped ${failed}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
