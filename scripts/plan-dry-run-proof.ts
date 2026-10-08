/**
 * Dry-run proof of PLAN on real data: the daily run of every Arbox business, in plan mode,
 * with the plan collector in dry run. Same Arbox reads as the ?dry_run=1 cron. Nothing is
 * sent, nothing is written (dryRunSupabase + collector dry run). Prints counts, and the
 * held / blocked / skipped items with the last 4 digits of the phone only.
 *
 *   npx tsx --env-file=.env.local scripts/plan-dry-run-proof.ts morning 2026-10-09
 *   npx tsx --env-file=.env.local scripts/plan-dry-run-proof.ts evening 2026-10-08
 */
import { runWithArboxCallCount } from "@/lib/crm/arbox-call-counter";
import { dryRunSupabase } from "@/lib/leads/arbox-daily-dry-run";
import { runArboxDailyContext } from "@/lib/leads/arbox-daily-run-context";
import {
  listArboxDailyBusinessIds,
  loadArboxDailyBusiness,
  runArboxDailyTriggersForBusiness,
} from "@/lib/leads/arbox-daily-triggers-run";
import { dispatchInstant, israelWallInstant, PLAN_SLOT_HM } from "@/lib/send-plan/checks";
import { SendPlanCollector } from "@/lib/send-plan/collector";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

async function main() {
  const slot = process.argv[2] === "evening" ? "evening" : "morning";
  const day = String(process.argv[3] ?? "").trim();
  const planNow = israelWallInstant(day, PLAN_SLOT_HM[slot].plan);
  const dispatchAt = dispatchInstant(day, slot);
  if (!planNow || !dispatchAt) throw new Error("usage: plan-dry-run-proof.ts morning|evening YYYY-MM-DD");
  const admin = createSupabaseAdminClient();
  const listed = await listArboxDailyBusinessIds(admin, { slot });
  if (!listed.ok) throw new Error(`businesses: ${listed.error}`);
  console.log(`PLAN ${slot} ${day} at ${PLAN_SLOT_HM[slot].plan}, DISPATCH ${PLAN_SLOT_HM[slot].dispatch}. dry run.`);
  console.log(`businesses: ${listed.ids.length}, paused: ${listed.paused.length}`);
  const totals = { planned: 0, held: 0, blocked: 0, skipped: 0, queued_checked: 0 };
  for (const businessId of listed.ids) {
    const business = await loadArboxDailyBusiness(admin, businessId);
    if (!business) continue;
    const collector = new SendPlanCollector(admin, businessId, slot, day, dispatchAt, true, planNow, "plan");
    const started = Date.now();
    try {
      await runWithArboxCallCount({ cron: "arbox-daily-triggers", slug: business.slug, emitIfEmpty: false }, () =>
        runArboxDailyContext(
          {
            businessId,
            dryRun: true,
            timeoutMs: 15_000,
            arboxCalls: 0,
            arboxReports: [],
            membershipTypesByKey: new Map(),
            wouldSend: [],
            sendPlan: collector,
          },
          () => runArboxDailyTriggersForBusiness({ admin: dryRunSupabase(admin), business, slot, now: planNow })
        )
      );
    } catch (e) {
      console.log(`  ${business.slug}: run failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const s = await collector.finalize();
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += s[key];
    console.log(
      `\n${business.slug} (${Date.now() - started}ms): planned ${s.planned}, held ${s.held}, blocked ${s.blocked}, skipped ${s.skipped}, queued checked ${s.queued_checked}`
    );
    if (s.volume_groups.length) console.log(`  volume: ${JSON.stringify(s.volume_groups)}`);
    const byTemplate = new Map<string, number>();
    for (const item of collector.items) {
      if (item.status === "planned") {
        const key = `${item.source === "queue" ? "queue " : ""}${item.templateName} @${item.dueAt.slice(11, 16)}Z`;
        byTemplate.set(key, (byTemplate.get(key) ?? 0) + 1);
        continue;
      }
      const body = item.status === "held" ? ` | ${item.renderedBody.replace(/\s+/g, " ").slice(0, 110)}` : "";
      console.log(
        `  ${item.status.toUpperCase()} ${item.reason}${item.detail ? ` (${item.detail})` : ""}: ${item.source} ${item.triggerType} ${item.templateName} *${item.phoneTail}${body}`
      );
    }
    for (const [key, count] of byTemplate) console.log(`  planned ${count} x ${key}`);
  }
  console.log(`\nTOTAL ${JSON.stringify(totals)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
