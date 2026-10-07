/**
 * TIGHTS-only dry-run workers. Hold must already be dry_run.
 * Not a migration. Do not commit.
 */
import { createClient } from "@supabase/supabase-js";
import { syncArboxClassCancelledCustomerForBusiness } from "@/lib/leads/arbox-class-cancelled-customer";
import { runArboxDailyContext } from "@/lib/leads/arbox-daily-run-context";
import {
  loadArboxDailyBusiness,
  runArboxDailyTriggersForBusiness,
} from "@/lib/leads/arbox-daily-triggers-run";
import { syncNoResponseReengageForBusiness } from "@/lib/leads/no-response-reengage";
import {
  loadArboxTrialSyncBusiness,
  runArboxTrialSyncForBusiness,
} from "@/lib/leads/arbox-trial-sync-run";
import { takeWouldSends } from "@/lib/business-sends-hold";
import {
  canonicalContactPhone,
  contactPhoneLookupVariants,
  waSessionIdParts,
} from "@/lib/phone-normalize";
import { resolveSupabaseServiceRoleKey, resolveSupabaseUrl } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const BUSINESS_ID = 3543;
const ENABLED_AT = "2026-10-06T08:55:16.526Z";
const OFF_START = "2026-10-05T13:20:00.000Z";

function phoneFromSession(sessionId: string): string | null {
  const parts = waSessionIdParts(sessionId);
  return canonicalContactPhone(parts?.phone ?? sessionId);
}

async function closeSilenceBeforeEnable() {
  const admin = createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
  const inbound: Array<{ created_at: string; session_id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("messages")
      .select("created_at, session_id")
      .eq("business_slug", "tights")
      .eq("role", "user")
      .gte("created_at", OFF_START)
      .lt("created_at", ENABLED_AT)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    inbound.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const lastByPhone = new Map<string, string>();
  for (const row of inbound) {
    const phone = phoneFromSession(String(row.session_id ?? ""));
    if (!phone) continue;
    const prev = lastByPhone.get(phone);
    if (!prev || row.created_at > prev) lastByPhone.set(phone, row.created_at);
  }
  const { data: rules, error: nrErr } = await admin
    .from("template_triggers")
    .select("id, template_name")
    .eq("business_id", BUSINESS_ID)
    .eq("trigger_type", "no_response");
  if (nrErr) throw nrErr;
  const nowIso = new Date().toISOString();
  let closed = 0;
  for (const [phone, lastAt] of lastByPhone) {
    const variants = contactPhoneLookupVariants(phone);
    const { data: rows, error } = await admin
      .from("contacts")
      .select("id, phone")
      .eq("business_id", BUSINESS_ID)
      .in("phone", variants.length ? variants : [phone]);
    if (error) throw error;
    for (const contact of rows ?? []) {
      const { error: upErr } = await admin
        .from("contacts")
        .update({ wa_last_reengaged_at: nowIso, wa_followup_stage: 3, updated_at: nowIso })
        .eq("id", contact.id);
      if (upErr) throw upErr;
      const episodeKey = new Date(Date.parse(lastAt)).toISOString();
      const phoneNorm = canonicalContactPhone(contact.phone) ?? phone;
      for (const rule of rules ?? []) {
        const dedup = `no_response:${BUSINESS_ID}:${rule.id}:${phoneNorm}:${episodeKey}`;
        const { error: insErr } = await admin.from("scheduled_template_sends").upsert(
          {
            business_id: BUSINESS_ID,
            trigger_id: rule.id,
            contact_phone: phoneNorm,
            template_name: String(rule.template_name ?? "no_response"),
            due_at: nowIso,
            status: "sent",
            dedup_key: dedup,
            last_error: "tights_reenable_cleanup",
            updated_at: nowIso,
          },
          { onConflict: "dedup_key" }
        );
        if (insErr) throw insErr;
      }
      closed += 1;
    }
  }
  console.log("[phase2] silence closed before enable", closed, "inbound", inbound.length);
}

async function main() {
  const { liveScriptSlug } = await import("./live-guard");
  if (!liveScriptSlug("tights")) return;
  await closeSilenceBeforeEnable();
  const admin = createSupabaseAdminClient();
  const { data: biz, error } = await admin
    .from("businesses")
    .select("id, crm_api_key, crm_api_key_enc, crm_box_id, social_links, zoe_activated")
    .eq("id", BUSINESS_ID)
    .single();
  if (error || !biz) throw error ?? new Error("missing business");
  const hold = (biz.social_links as { sales_flow?: { sends_hold?: string } } | null)?.sales_flow?.sends_hold;
  if (hold !== "dry_run") throw new Error(`refusing workers, hold=${hold}`);
  console.log("[phase2] hold", hold, "zoe", biz.zoe_activated);

  const trialBusiness = await loadArboxTrialSyncBusiness(admin, BUSINESS_ID);
  if (!trialBusiness) throw new Error("trial business missing");
  const trial1 = await runArboxTrialSyncForBusiness({ admin, business: trialBusiness });
  console.log("[phase2] trial-sync-1", JSON.stringify(trial1));
  const trial2 = await runArboxTrialSyncForBusiness({ admin, business: trialBusiness });
  console.log("[phase2] trial-sync-2", JSON.stringify(trial2));

  const cancel = await syncArboxClassCancelledCustomerForBusiness({
    admin,
    businessId: BUSINESS_ID,
    businessSlug: "tights",
    apiKey: (await import("@/lib/business-secret-read")).getArboxApiKey(biz),
    boxId: String(biz.crm_box_id ?? ""),
    now: new Date(),
    dryRun: false,
  });
  console.log("[phase2] class-cancel", JSON.stringify(cancel));

  const dailyBusiness = await loadArboxDailyBusiness(admin, BUSINESS_ID);
  if (!dailyBusiness) throw new Error("daily business missing");
  const daily = await runArboxDailyContext(
    {
      businessId: BUSINESS_ID,
      dryRun: false,
      timeoutMs: 15_000,
      arboxCalls: 0,
      arboxReports: [],
      membershipTypesByKey: new Map(),
    },
    () => runArboxDailyTriggersForBusiness({ admin, business: dailyBusiness })
  );
  console.log("[phase2] daily", JSON.stringify(daily));

  const noResponse = await syncNoResponseReengageForBusiness({
    admin,
    businessId: BUSINESS_ID,
    businessSlug: "tights",
    now: new Date(),
  });
  console.log("[phase2] no-response", JSON.stringify(noResponse));
  console.log("[phase2] WOULD_SENDS", JSON.stringify(takeWouldSends()));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
