/**
 * One-off: sets contacts.followup_series_locked_at for contacts that already got a follow-up
 * or ever had human involvement (human request, staff app reply, dashboard reply).
 * Human-involved contacts mid-series (stage 1–2) also move to the hold stage with no due time.
 * Contacts with neither are not touched. Lock is written only where it is still null.
 * Sources are DB rows only (messages.model_used + contacts columns); no external API calls.
 * Dry-run unless: --live --slug <business|all>. Production also needs ALLOW_PROD_TEST=1.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-followup-series-lock.mts --slug all
 *   ALLOW_PROD_TEST=1 npx tsx --env-file=.env.local scripts/backfill-followup-series-lock.mts --live --slug all
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FOLLOWUP_SERIES_LOCK_COLUMN } from "@/lib/followup-series-lock";
import { HUMAN_REPLY_FOLLOWUP_HOLD_STAGE } from "@/lib/human-requested";
import { canonicalContactPhone, waSessionIdParts } from "@/lib/phone-normalize";
import { resolveSupabaseServiceRoleKey, resolveSupabaseUrl } from "@/lib/server-env";

type Admin = SupabaseClient;
const PAGE = 1000;
const WRITE_BATCH = 200;
const HUMAN_MODELS = ["human_requested", "human_requested_manual", "manual_handoff"];
/** Live code locks only on a text echo; these placeholders are logged for every other echo type. */
const NON_TEXT_ECHO = /^\[(unsupported|revoke|edit|unknown|תמונה|הקלטה|וידאו|קובץ|איש קשר|מיקום|סטיקר)\]/;

type ContactRow = {
  id: number;
  phone: string | null;
  wa_followup_stage: number | null;
  followup_series_locked_at: string | null;
  human_requested_at: string | null;
  wa_followup_1_sent_at: string | null;
  wa_followup_2_sent_at: string | null;
  wa_followup_3_sent_at: string | null;
};

async function sessionPhonesForModels(
  admin: Admin,
  slug: string,
  models: { like?: string; in?: string[]; textEchoOnly?: boolean }
) {
  const phones = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    let q = admin
      .from("messages")
      .select(models.textEchoOnly ? "session_id, content" : "session_id")
      .eq("business_slug", slug);
    q = models.like ? q.like("model_used", models.like) : q.in("model_used", models.in ?? []);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of (data ?? []) as { session_id?: string; content?: string }[]) {
      if (models.textEchoOnly && NON_TEXT_ECHO.test(String(row.content ?? "").trim())) continue;
      const parts = waSessionIdParts(String((row as { session_id?: string }).session_id ?? ""));
      const phone = parts ? canonicalContactPhone(parts.phone) : null;
      if (phone) phones.add(phone);
    }
    if ((data ?? []).length < PAGE) break;
  }
  return phones;
}

async function contactsForBusiness(admin: Admin, businessId: number): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("contacts")
      .select(
        `id, phone, wa_followup_stage, ${FOLLOWUP_SERIES_LOCK_COLUMN}, human_requested_at, wa_followup_1_sent_at, wa_followup_2_sent_at, wa_followup_3_sent_at`
      )
      .eq("business_id", businessId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as ContactRow[]));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

async function updateInBatches(ids: number[], write: (batch: number[]) => Promise<number>) {
  let n = 0;
  for (let i = 0; i < ids.length; i += WRITE_BATCH) n += await write(ids.slice(i, i + WRITE_BATCH));
  return n;
}

async function main() {
  const { liveScriptSlug } = await import("./live-guard.mjs");
  const live = liveScriptSlug();
  if (live) {
    const { assertWarmupTestEnvironmentSafe } = await import("./warmup-test-config.mjs");
    assertWarmupTestEnvironmentSafe("backfill-followup-series-lock");
  }
  const slugIndex = process.argv.indexOf("--slug");
  const slugArg = live ?? (slugIndex >= 0 ? String(process.argv[slugIndex + 1] ?? "").trim().toLowerCase() : "all");

  const admin = createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey(), {
    auth: { persistSession: false },
  }) as Admin;

  const probe = await admin.from("contacts").select(FOLLOWUP_SERIES_LOCK_COLUMN).limit(1);
  if (probe.error) {
    console.error(`contacts.${FOLLOWUP_SERIES_LOCK_COLUMN} is not readable (run the migration first):`, probe.error.message);
    process.exit(1);
  }

  let bq = admin.from("businesses").select("id, slug").order("id", { ascending: true });
  if (slugArg !== "all") bq = bq.eq("slug", slugArg);
  const { data: businesses, error: bizErr } = await bq;
  if (bizErr) throw bizErr;
  if (!businesses?.length) {
    console.log(`No business for --slug ${slugArg}.`);
    return;
  }

  const nowIso = new Date().toISOString();
  const totals = { contacts: 0, to_lock: 0, to_cancel: 0, locked: 0, cancelled: 0 };
  for (const biz of businesses as { id: number; slug: string }[]) {
    const followupPhones = await sessionPhonesForModels(admin, biz.slug, { like: "wa_followup_%" });
    const humanPhones = await sessionPhonesForModels(admin, biz.slug, { in: HUMAN_MODELS });
    for (const phone of await sessionPhonesForModels(admin, biz.slug, {
      in: ["wa_business_app"],
      textEchoOnly: true,
    })) {
      humanPhones.add(phone);
    }
    const contacts = await contactsForBusiness(admin, biz.id);

    const toLock: number[] = [];
    const toCancel: number[] = [];
    let alreadyLocked = 0;
    let gotFollowup = 0;
    let humanInvolved = 0;
    for (const c of contacts) {
      const phone = canonicalContactPhone(c.phone);
      const hadFollowup =
        Boolean(c.wa_followup_1_sent_at || c.wa_followup_2_sent_at || c.wa_followup_3_sent_at) ||
        (phone != null && followupPhones.has(phone));
      const hadHuman = Boolean(c.human_requested_at) || (phone != null && humanPhones.has(phone));
      if (hadFollowup) gotFollowup += 1;
      if (hadHuman) humanInvolved += 1;
      if (!hadFollowup && !hadHuman) continue;
      if (c.followup_series_locked_at) alreadyLocked += 1;
      else toLock.push(c.id);
      const stage = Number(c.wa_followup_stage ?? 0);
      if (hadHuman && (stage === 1 || stage === 2)) toCancel.push(c.id);
    }

    let locked = 0;
    let cancelled = 0;
    if (live) {
      locked = await updateInBatches(toLock, async (ids) => {
        const { data, error } = await admin
          .from("contacts")
          .update({ [FOLLOWUP_SERIES_LOCK_COLUMN]: nowIso })
          .eq("business_id", biz.id)
          .in("id", ids)
          .is(FOLLOWUP_SERIES_LOCK_COLUMN, null)
          .select("id");
        if (error) throw error;
        return data?.length ?? 0;
      });
      cancelled = await updateInBatches(toCancel, async (ids) => {
        const { data, error } = await admin
          .from("contacts")
          .update({ wa_followup_stage: HUMAN_REPLY_FOLLOWUP_HOLD_STAGE, wa_next_followup_at: null })
          .eq("business_id", biz.id)
          .in("id", ids)
          .in("wa_followup_stage", [1, 2])
          .select("id");
        if (error) throw error;
        return data?.length ?? 0;
      });
    }

    console.log({
      slug: biz.slug,
      contacts: contacts.length,
      got_followup: gotFollowup,
      human_involved: humanInvolved,
      already_locked: alreadyLocked,
      to_lock: toLock.length,
      to_cancel_mid_series: toCancel.length,
      ...(live ? { locked, cancelled } : {}),
    });
    totals.contacts += contacts.length;
    totals.to_lock += toLock.length;
    totals.to_cancel += toCancel.length;
    totals.locked += locked;
    totals.cancelled += cancelled;
  }
  console.log({ totals, mode: live ? "live" : "dry-run" });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
