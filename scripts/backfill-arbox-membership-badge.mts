/**
 * One-off backfill for contacts.arbox_membership_status ('active' | 'inactive' | 'lead').
 * Same lookup as an inbound refresh: searchUser + unfiltered /v3/users/memberships.
 * `--slug all` runs every active Arbox business with a key and a box id.
 * A business with the Arbox background pause is skipped with no Arbox call.
 * Dry-run unless: --live --slug <business|all>
 * Production also needs ALLOW_PROD_TEST=1.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-arbox-membership-badge.mts --slug all
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/backfill-arbox-membership-badge.mts --live --slug all
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { arboxBackgroundPauseSelect, rowArboxBackgroundPaused } from "@/lib/arbox-background-pause";
import { ARBOX_MEMBERSHIP_BADGE_REFRESH_MS } from "@/lib/arbox-membership-badge";
import { getArboxApiKey } from "@/lib/business-secret-read";
import { resolveSupabaseServiceRoleKey, resolveSupabaseUrl } from "@/lib/server-env";
import { refreshArboxMembershipBadge } from "@/lib/arbox-membership-badge-sync";

const PAGE = 500;
const GAP_MS = 400;

type Admin = SupabaseClient;
type Biz = Record<string, unknown>;

function mask(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBusinesses(admin: Admin, requested: string): Promise<Biz[]> {
  const select = `id, slug, crm_type, is_active, crm_api_key, crm_api_key_enc, crm_box_id, ${await arboxBackgroundPauseSelect(admin as never)}`;
  if (requested === "all") {
    const { data, error } = await admin
      .from("businesses")
      .select(select)
      .eq("crm_type", "arbox")
      .eq("is_active", true)
      .not("crm_box_id", "is", null)
      .order("id", { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as Biz[];
  }
  const { data, error } = await admin.from("businesses").select(select).ilike("slug", requested).maybeSingle();
  if (error || !data) throw error ?? new Error(`business not found: ${requested}`);
  const biz = data as unknown as Biz;
  if (String(biz.crm_type ?? "").trim().toLowerCase() !== "arbox") {
    throw new Error(`${requested} is not an Arbox business`);
  }
  return [biz];
}

/** Before the migration (no checked_at column) every contact counts as unchecked; dry-run only. */
async function contactsToCheck(
  admin: Admin,
  businessId: number,
  live: boolean
): Promise<{ id: string; phone: string }[]> {
  const cutoff = new Date(Date.now() - ARBOX_MEMBERSHIP_BADGE_REFRESH_MS).toISOString();
  const contacts: { id: string; phone: string }[] = [];
  let hasColumn = true;
  for (let off = 0; off < 20000; off += PAGE) {
    let query = admin.from("contacts").select("id, phone").eq("business_id", businessId);
    if (hasColumn) {
      query = query.or(`arbox_membership_checked_at.is.null,arbox_membership_checked_at.lt.${cutoff}`);
    }
    let { data, error } = await query.order("created_at", { ascending: true }).range(off, off + PAGE - 1);
    if (error && hasColumn && /arbox_membership_checked_at/.test(error.message)) {
      if (live) throw new Error("Run the arbox membership columns migration first.");
      hasColumn = false;
      ({ data, error } = await admin
        .from("contacts")
        .select("id, phone")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true })
        .range(off, off + PAGE - 1));
    }
    if (error) throw error;
    const rows = (data ?? []) as { id: unknown; phone: unknown }[];
    for (const row of rows) {
      const phone = String(row.phone ?? "").trim();
      if (phone) contacts.push({ id: String(row.id), phone });
    }
    if (rows.length < PAGE) break;
  }
  return contacts;
}

async function main() {
  const { liveScriptSlug } = await import("./live-guard.mjs");
  const liveSlug = liveScriptSlug();
  if (liveSlug) {
    const { assertWarmupTestEnvironmentSafe } = await import("./warmup-test-config.mjs");
    assertWarmupTestEnvironmentSafe("backfill-arbox-membership-badge");
  }
  const admin = createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
  const requested =
    liveSlug ??
    (() => {
      const i = process.argv.indexOf("--slug");
      return i >= 0 ? String(process.argv[i + 1] ?? "").trim().toLowerCase() : "";
    })();
  if (!requested) {
    console.log("[dry-run] pass --slug <business|all> to count contacts. Add --live to write.");
    return;
  }

  const businesses = await loadBusinesses(admin, requested);
  let totalContacts = 0;
  const plan: { biz: Biz; apiKey: string; boxId: string; contacts: { id: string; phone: string }[] }[] = [];
  for (const biz of businesses) {
    const slug = String(biz.slug ?? "");
    if (rowArboxBackgroundPaused(biz)) {
      console.log(`[membership-badge] ${slug}: skipped, Arbox background pause is on (0 Arbox calls)`);
      continue;
    }
    const apiKey = getArboxApiKey(biz);
    const boxId = String(biz.crm_box_id ?? "").trim();
    if (!apiKey || !boxId) {
      console.log(`[membership-badge] ${slug}: skipped, missing Arbox key or box id`);
      continue;
    }
    const contacts = await contactsToCheck(admin, Number(biz.id), Boolean(liveSlug));
    totalContacts += contacts.length;
    console.log(`[membership-badge] ${slug}: ${contacts.length} contacts, about ${contacts.length * 2} Arbox calls`);
    plan.push({ biz, apiKey, boxId, contacts });
  }
  console.log(
    `[membership-badge] total: ${plan.length} businesses, ${totalContacts} contacts, about ${totalContacts * 2} Arbox calls, about ${Math.ceil((totalContacts * GAP_MS) / 60000)} min`
  );
  if (!liveSlug) return;

  for (const { biz, apiKey, boxId, contacts } of plan) {
    const slug = String(biz.slug ?? "");
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
        console.log(`[membership-badge] ${slug}: ${wrote} written, ${failed} skipped, last ${mask(contact.phone)}`);
      }
      await sleep(GAP_MS);
    }
    console.log(`[membership-badge] ${slug}: done. written ${wrote}, skipped ${failed}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
