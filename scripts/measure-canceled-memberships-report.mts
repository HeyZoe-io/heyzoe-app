/**
 * Read-only: times GET canceledMembershipsReport per business with an enabled membership_cancelled
 * rule — full paging (before) vs stop-at-fromDate (after). No DB writes, no sends.
 *   npx tsx --env-file=.env.local scripts/measure-canceled-memberships-report.mts
 */
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getArboxApiKey } from "@/lib/business-secret-read";
import { fetchCanceledMembershipsReportRows } from "@/lib/leads/arbox-canceled-memberships-report";
import { membershipCancelledLiveWindow } from "@/lib/leads/arbox-membership-cancelled";

const admin = createSupabaseAdminClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { data: rules } = await admin
  .from("template_triggers")
  .select("business_id, template_name")
  .eq("trigger_type", "membership_cancelled")
  .eq("enabled", true);
const ids = [
  ...new Set(
    (rules ?? [])
      .filter((r) => String((r as { template_name?: unknown }).template_name ?? "").trim())
      .map((r) => Number((r as { business_id?: unknown }).business_id))
  ),
];
const { data: businesses } = await admin
  .from("businesses")
  .select("id, slug, crm_api_key, crm_api_key_enc, crm_box_id, crm_type")
  .in("id", ids.length ? ids : [0]);

const { fromDate, toDate } = membershipCancelledLiveWindow(new Date());
console.log(`window ${fromDate}..${toDate}, businesses ${businesses?.length ?? 0}`);
for (const b of businesses ?? []) {
  const row = b as Record<string, unknown>;
  if (String(row.crm_type ?? "") !== "arbox") continue;
  const apiKey = getArboxApiKey(row).trim();
  const locationId = String(row.crm_box_id ?? "").trim();
  if (!apiKey || !locationId) continue;
  const run = async (stopAtFromDate: boolean) => {
    const t = Date.now();
    const r = await fetchCanceledMembershipsReportRows({ apiKey, fromDate, toDate, locationId, stopAtFromDate });
    const inWindow = r.ok
      ? r.rows.filter((x) => String(x.cancelled_time ?? "").slice(0, 10) >= fromDate).length
      : 0;
    return { ms: Date.now() - t, ok: r.ok, pages: r.pagesFetched, rows: r.ok ? r.rows.length : 0, inWindow };
  };
  const before = await run(false);
  await sleep(4000);
  const after = await run(true);
  console.log(
    JSON.stringify({ slug: row.slug, before, after, same_window_rows: before.inWindow === after.inWindow })
  );
  await sleep(4000);
}
