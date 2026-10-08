import assert from "node:assert/strict";
import {
  ARBOX_BACKGROUND_PAUSED,
  holdArboxBackgroundClocks,
  isArboxBackgroundPaused,
  isBackgroundCrmKind,
  rowArboxBackgroundPaused,
} from "@/lib/arbox-background-pause";
import { listArboxTrialSyncBusinessIds, runArboxTrialSyncForBusiness, type BusinessRow } from "@/lib/leads/arbox-trial-sync-run";
import {
  listArboxDailyBusinessIds,
  runArboxDailyTriggersForBusiness,
  type ArboxDailyBusiness,
} from "@/lib/leads/arbox-daily-triggers-run";
import { resolveAllLeadsReportDateRange } from "@/lib/leads/arbox-new-lead";
import { leadStatusShouldReseed } from "@/lib/leads/arbox-lead-status-change";
import { eventBeforeRuleActivation, ruleActivationMs } from "@/lib/rule-activation";
import { lookupArboxMembershipByPhone } from "@/lib/wa-membership-lookup";
import { getOccurrenceRawData } from "@/lib/arbox-occurrence-state";

type Op = { table: string; op: "select" | "update"; payload?: unknown; filters: [string, string, unknown][] };

function fakeAdmin(tables: Record<string, Record<string, unknown>[]>, log: Op[]) {
  return {
    from(table: string) {
      const entry: Op = { table, op: "select", filters: [] };
      log.push(entry);
      const chain: Record<string, unknown> = {};
      const filter = (kind: string) => (column: string, value?: unknown) => {
        entry.filters.push([kind, column, value]);
        return chain;
      };
      chain.select = () => chain;
      chain.update = (payload: unknown) => {
        entry.op = "update";
        entry.payload = payload;
        return chain;
      };
      for (const kind of ["eq", "neq", "or", "not", "in", "is", "gte", "lte", "lt", "order", "limit"]) {
        chain[kind] = filter(kind);
      }
      chain.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: entry.op === "update" ? [] : tables[table] ?? [], error: null }).then(resolve, reject);
      return chain;
    },
  } as never;
}

async function main() {
  const arboxCalls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const text = String(url);
    if (text.includes("arboxapp.com")) arboxCalls.push(text);
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;

  // Flag reading.
  assert.equal(isArboxBackgroundPaused({ arbox_background_pause: true }), true);
  assert.equal(isArboxBackgroundPaused({ arbox_background_pause: "true" }), false);
  assert.equal(isArboxBackgroundPaused(null), false);
  assert.equal(rowArboxBackgroundPaused({ arbox_background_pause: true }), true);
  assert.equal(rowArboxBackgroundPaused({ arbox_background_pause: null }), false);
  assert.equal(rowArboxBackgroundPaused({ social_links: { arbox_background_pause: true } }), true);

  // Cron-raised CRM kinds are gated; live-conversation kinds are not.
  for (const kind of ["no_response", "idle_no_response", "template_sent", "template_no_response"]) {
    assert.equal(isBackgroundCrmKind(kind), true, kind);
  }
  for (const kind of ["trial_registered", "human_requested", "not_relevant"]) {
    assert.equal(isBackgroundCrmKind(kind), false, kind);
  }

  const businesses = [
    { id: 1, slug: "acrobyjoe", crm_api_key: "k1", crm_box_id: "3068", arbox_trial_membership_type_ids: [80378], arbox_background_pause: true },
    { id: 2, slug: "other", crm_api_key: "k2", crm_box_id: "20547", arbox_trial_membership_type_ids: [5], arbox_background_pause: null },
  ];
  const rules = [
    { business_id: 1, trigger_type: "birthday", template_name: "bday", delay_days: 0 },
    { business_id: 2, trigger_type: "birthday", template_name: "bday", delay_days: 0 },
  ];

  // Paused business gets no worker in either dispatcher; the other business is unaffected.
  {
    const log: Op[] = [];
    const listed = await listArboxTrialSyncBusinessIds(fakeAdmin({ businesses, template_triggers: rules }, log));
    assert.deepEqual(listed, { ok: true, ids: [2], paused: [1] });
    const rulesQuery = log.find((op) => op.table === "template_triggers");
    assert.deepEqual(rulesQuery?.filters.find(([kind, col]) => kind === "in" && col === "business_id")?.[2], [2]);
  }
  for (const slot of ["morning", "evening"] as const) {
    const listed = await listArboxDailyBusinessIds(
      fakeAdmin({ businesses, template_triggers: rules.map((r) => ({ ...r, trigger_type: "trial_reminder" })) }, []),
      { slot }
    );
    assert.deepEqual(listed, { ok: true, ids: [2], paused: [1] });
  }

  // A paused business makes zero Arbox calls and evaluates no triggers, even if a worker is called directly.
  const noAdmin = new Proxy({}, { get: () => { throw new Error("admin must not be touched"); } }) as never;
  {
    const business: BusinessRow = {
      id: 1,
      slug: "acrobyjoe",
      apiKey: "k1",
      crm_box_id: "3068",
      arbox_last_sync_at: null,
      arbox_trial_membership_type_ids: [80378],
      arbox_sales_sync_seeded: true,
      arbox_credit_refusal_seeded: false,
      arbox_leads_seeded: false,
      arbox_cancellation_seeded: false,
      arbox_freeze_seeded: false,
      arbox_post_trial_followup_seeded: false,
      arbox_lost_lead_seeded: false,
      arbox_background_paused: true,
    };
    const summary = await runArboxTrialSyncForBusiness({ admin: noAdmin, business });
    assert.equal(summary.skip_reason, ARBOX_BACKGROUND_PAUSED);
    assert.equal(summary.cursor_advanced, false);

    const daily: ArboxDailyBusiness = {
      id: 1,
      slug: "acrobyjoe",
      apiKey: "k1",
      crm_box_id: "3068",
      arbox_cancellation_seeded: false,
      arbox_missed_class_seeded: false,
      arbox_attendance_gap_seeded: false,
      arbox_post_trial_followup_seeded: false,
      arbox_freeze_seeded: false,
      arbox_lost_lead_seeded: false,
      arbox_trial_reminder_seeded: false,
      arbox_days_in_club_seeded: false,
      arbox_nth_workout_seeded: false,
      arbox_trial_membership_type_ids: [80378],
      arbox_background_paused: true,
    };
    for (const slot of ["morning", "evening"] as const) {
      const run = await runArboxDailyTriggersForBusiness({ admin: noAdmin, business: daily, slot });
      assert.equal(run.summary.skip_reason, ARBOX_BACKGROUND_PAUSED);
      assert.equal(run.arbox_calls, 0);
      assert.deepEqual(run.steps, []);
    }
    assert.equal(arboxCalls.length, 0);

    // Same row unpaused passes the gate (night hold is the next stop, before any Arbox call).
    const night = new Date("2026-10-08T20:30:00.000Z");
    const unpaused = await runArboxTrialSyncForBusiness({
      admin: fakeAdmin({ template_triggers: [] }, []),
      business: { ...business, arbox_background_paused: false },
      now: night,
      dryRun: true,
    });
    assert.equal(unpaused.skip_reason, "quiet_hours");
  }

  // In-conversation Arbox paths take no pause input and still call Arbox for a paused business.
  {
    arboxCalls.length = 0;
    await lookupArboxMembershipByPhone({ apiKey: "k1", boxId: "3068", lookupPhone: "972501234567" });
    assert.ok(arboxCalls.some((url) => url.includes("/v3/users/searchUser")), "membership lookup calls Arbox");
    arboxCalls.length = 0;
    await getOccurrenceRawData({ businessId: 1, apiKey: "k1", boxId: "3068", date: "2026-10-09", skipCache: true });
    assert.ok(arboxCalls.length > 0, "class-space read calls Arbox");
  }

  // Hold tick moves only the paused businesses' clocks.
  const pauseStart = new Date("2026-10-01T09:00:00.000Z");
  const heldAt = new Date("2026-10-08T07:45:00.000Z");
  {
    const log: Op[] = [];
    const held = await holdArboxBackgroundClocks(fakeAdmin({}, log), [1], heldAt);
    assert.equal(held.ok, true);
    const biz = log.find((op) => op.table === "businesses");
    const trg = log.find((op) => op.table === "template_triggers");
    assert.deepEqual(biz?.payload, { arbox_last_sync_at: heldAt.toISOString() });
    assert.deepEqual(biz?.filters, [["in", "id", [1]]]);
    assert.deepEqual(trg?.payload, { updated_at: heldAt.toISOString() });
    assert.deepEqual(trg?.filters, [["in", "business_id", [1]]]);
    const empty: Op[] = [];
    await holdArboxBackgroundClocks(fakeAdmin({}, empty), [], heldAt);
    assert.equal(empty.length, 0);
  }

  // Unpause: the next run starts at the last tick. Nothing from the paused window is sendable.
  {
    const resumeNow = new Date("2026-10-08T08:00:00.000Z");
    const eventDuringPause = new Date("2026-10-03T10:00:00.000Z");
    const eventAfterResume = new Date("2026-10-08T07:50:00.000Z");
    const rule = { id: "r1", created_at: "2026-06-01T00:00:00.000Z", updated_at: heldAt.toISOString() };
    assert.equal(eventBeforeRuleActivation(eventDuringPause, rule), true);
    assert.equal(eventBeforeRuleActivation(eventAfterResume, rule), false);

    const neverPaused = { id: "r2", created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-01T00:00:00.000Z" };
    assert.equal(eventBeforeRuleActivation(eventDuringPause, neverPaused), false);

    assert.deepEqual(resolveAllLeadsReportDateRange({ arboxLastSyncAt: heldAt.toISOString(), now: resumeNow }), {
      fromDate: "2026-10-08",
      toDate: "2026-10-08",
    });
    assert.equal(
      leadStatusShouldReseed({
        snapshotCount: 40,
        lastScannedAt: pauseStart.toISOString(),
        now: resumeNow,
        ruleActivationMs: [ruleActivationMs(rule)],
      }),
      true
    );
  }

  globalThis.fetch = realFetch;
  console.log("arbox-background-pause tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
