/**
 * Event gate end to end (the real gate code, with the in-memory client injected as the
 * process admin client) and the planned-row outcome in the daily unsent summary.
 * No network: fetch is stubbed to fail the test if anything tries to call out.
 */
import assert from "node:assert/strict";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadAdminDailyUnsent, MANUAL_BLOCK_REASON, PLAN_HELD_REASON, PLAN_NOT_DISPATCHED_REASON } from "@/lib/admin-daily-unsent-summary";
import { runArboxDailyContext } from "@/lib/leads/arbox-daily-run-context";
import { claimQueuedTemplateSend, settleQueuedTemplateSend } from "@/lib/leads/sync-log-claim";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { DUPLICATE_GUARD_ERROR } from "@/lib/notifications/template-duplicate-guard";
import { enqueueScheduledTemplateSend } from "@/lib/scheduled-template-sends";
import type { HeldAlertSend } from "@/lib/send-plan/alerts";
import { israelWallInstant } from "@/lib/send-plan/checks";
import { SendPlanCollector } from "@/lib/send-plan/collector";
import { dispatchPlannedSends, type DispatchDeps } from "@/lib/send-plan/dispatch";
import { PLAN_SUPERSEDED_REASON } from "@/lib/send-plan/errors";
import { FakeAdmin } from "@/lib/send-plan/fake-admin";
import { cancelHeld, loadActivePauses, releaseHeld, resumeTriggerPause } from "@/lib/send-plan/holds";
import { eventSendGate, resetEventSendGateCache, SENDS_HOLD_GATE_ERROR } from "@/lib/send-plan/inline";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const il = (ymd: string, hm: string) => israelWallInstant(ymd, hm)!;

let network = 0;
globalThis.fetch = (async () => {
  network += 1;
  throw new Error("network call in test");
}) as typeof fetch;

let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL - ${name}`);
    console.error(e);
  }
}

/** A fresh in-memory database, installed as the process admin client. */
function freshDb(): { db: FakeAdmin; admin: Admin } {
  const db = new FakeAdmin();
  (globalThis as unknown as { __hzSupabaseAdmin?: unknown }).__hzSupabaseAdmin = db;
  resetEventSendGateCache();
  db.seed("businesses", [{ id: 5, name: "סטודיו", slug: "studio", social_links: {} }]);
  db.seed("whatsapp_channels", [{ phone_number_id: "pn-5", business_id: 5 }]);
  db.seed("template_triggers", [
    { id: "t-conf", trigger_type: "trial_booked" },
    { id: "t-tr", trigger_type: "trainer_trial_heads_up" },
  ]);
  db.seed("whatsapp_templates", [
    { business_id: 5, name: "conf_tpl", category: "UTILITY", language: "he", status: "APPROVED", disabled: false, components: [{ type: "BODY", text: "היי {{1}}, נרשמת לאימון" }] },
    { business_id: 5, name: "tr_tpl", category: "UTILITY", language: "he", status: "APPROVED", disabled: false, components: [{ type: "BODY", text: "מתאמן ניסיון {{1}} מגיע מחר ב-{{2}}" }] },
  ]);
  return { db, admin: db as unknown as Admin };
}

const confirm = (phone: string, name = "דנה") => ({
  to: phone,
  phoneNumberId: "pn-5",
  templateName: "conf_tpl",
  languageCode: "he",
  alertTriggerId: "t-conf",
  eventDedupKey: `trial_booked:5:t-conf:${phone.slice(-3)}:2026-10-13`,
  components: [{ type: "body" as const, parameters: [{ type: "text" as const, text: name }] }],
});

async function main() {
  const now = il("2026-10-12", "11:00");

  await test("event gate: empty variable is held, and stays held on the next try", async () => {
    const { db } = freshDb();
    const first = await eventSendGate(confirm("972501110001", " "), { now });
    assert.deepEqual(first, { ok: false, error: SENDS_HOLD_GATE_ERROR });
    const row = db.rows("scheduled_template_sends")[0]!;
    assert.equal(row.status, "held");
    assert.equal(row.hold_reason, "empty_variable");
    assert.equal(row.plan_slot, "event");
    const again = await eventSendGate(confirm("972501110001", " "), { now });
    assert.deepEqual(again, { ok: false, error: SENDS_HOLD_GATE_ERROR });
    assert.equal(db.rows("scheduled_template_sends").length, 1);
  });

  await test("sendBusinessTemplate runs the gate before its own empty-variable failure", async () => {
    freshDb();
    const prev = process.env.META_ACCESS_TOKEN;
    process.env.META_ACCESS_TOKEN = "test-placeholder";
    try {
      const r = await sendBusinessTemplate(confirm("972501110002", ""));
      assert.deepEqual(r, { ok: false, error: SENDS_HOLD_GATE_ERROR });
    } finally {
      if (prev === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prev;
    }
  });

  await test("event gate: breaker trips, pauses the trigger, holds the rest, alerts once; resume lets sends through; a released copy is a duplicate", async () => {
    const { db, admin } = freshDb();
    // 10 sends of this trigger in the last hour, no normal volume for this hour: limit 10.
    db.seed(
      "wa_template_send_refs",
      Array.from({ length: 10 }, (_, i) => ({
        wamid: `w${i}`,
        business_id: 5,
        trigger_id: "t-conf",
        created_at: new Date(now.getTime() - (5 + i) * 60_000).toISOString(),
      }))
    );
    const alerts: string[] = [];
    const alert = (async (input: { bodyParams: string[] }) => {
      alerts.push(input.bodyParams.join(" | "));
      return { ok: true };
    }) as unknown as HeldAlertSend;

    const tripped = await eventSendGate(confirm("972501110003"), { now, alert });
    assert.deepEqual(tripped, { ok: false, error: SENDS_HOLD_GATE_ERROR });
    const pause = db.rows("send_trigger_pauses")[0]!;
    assert.equal(pause.trigger_key, "t-conf");
    assert.equal(pause.sent_last_hour, 10);
    assert.equal(pause.resumed_at, null);
    assert.equal(pause.paused_until, il("2026-10-13", "00:00").toISOString());
    assert.equal(alerts.length, 1);
    assert.match(alerts[0]!, /מפסק נפח/);

    const rest = await eventSendGate(confirm("972501110004"), { now: new Date(now.getTime() + 60_000), alert });
    assert.deepEqual(rest, { ok: false, error: SENDS_HOLD_GATE_ERROR }, "the rest is held while paused");
    assert.equal(alerts.length, 1, "one alert per trip");
    const held = db.rows("scheduled_template_sends").filter((r) => r.hold_reason === "circuit_breaker");
    assert.equal(held.length, 2);
    assert.equal((await loadActivePauses(admin, now)).length, 1, "listed on the admin page");

    // Resume from the admin page (the API calls resumeTriggerPause).
    assert.equal(await resumeTriggerPause(admin, 5, "t-conf", "lior@test", now), true);
    assert.equal(pause.resumed_by, "lior@test");
    assert.equal((await loadActivePauses(admin, now)).length, 0);
    const after = await eventSendGate(confirm("972501110005"), { now: new Date(now.getTime() + 2 * 60_000), alert });
    assert.equal(after, null, "resumed today: sends go out, the breaker does not re-trip");
    assert.equal(alerts.length, 1);

    // Release a held event send: it goes out now; the event cron's next try is a duplicate.
    const sent: unknown[] = [];
    const deps: DispatchDeps = {
      send: (async (i: unknown) => (sent.push(i), { ok: true })) as typeof sendBusinessTemplate,
      log: async () => {},
    };
    const heldRow = held.find((r) => String(r.contact_phone).endsWith("0003"))!;
    const released = await releaseHeld(admin, { ids: [String(heldRow.id)] }, "lior@test", new Date(now.getTime() + 3 * 60_000), deps);
    assert.equal(released.sent_now, 1);
    assert.equal(heldRow.status, "sent");
    const retry = await eventSendGate(confirm("972501110003"), { now: new Date(now.getTime() + 15 * 60_000), alert });
    assert.deepEqual(retry, { ok: false, error: DUPLICATE_GUARD_ERROR }, "duplicate blocked");
  });

  await test("summary counts the planned row's real outcome, not the trainer queue row marked at PLAN", async () => {
    const { db, admin } = freshDb();
    const planNow = il("2026-10-12", "08:00");
    const dispatchAt = il("2026-10-12", "09:00");
    const collector = new SendPlanCollector(admin, 5, "morning", "2026-10-12", dispatchAt, false, planNow, "plan");
    const ctx = { businessId: 5, dryRun: false, timeoutMs: 1000, arboxCalls: 0, arboxReports: [], membershipTypesByKey: new Map(), sendPlan: collector };

    // The trainer heads-up path: enqueue its own row, claim it, send now, settle sent.
    const trainer = async (key: string, phone: string, client: string) =>
      runArboxDailyContext(ctx, async () => {
        const enq = await enqueueScheduledTemplateSend({
          admin,
          businessId: 5,
          triggerId: "t-tr",
          contactPhone: phone,
          templateName: "tr_tpl",
          dueAt: planNow,
          dedupKey: key,
          recipientKind: "staff",
        });
        assert.equal(enq.ok, true);
        assert.equal(await claimQueuedTemplateSend(admin, key), "won");
        const r = await sendBusinessTemplate({
          to: phone,
          phoneNumberId: "pn-5",
          templateName: "tr_tpl",
          recipientKind: "staff",
          components: [{ type: "body", parameters: [{ type: "text", text: client }, { type: "text", text: "18:00" }] }],
        });
        assert.equal(r.ok, true, "the run sees a send");
        await settleQueuedTemplateSend(admin, key, "sent");
      });
    await trainer("trainer_trial_heads_up:5:t-tr:972509990001:777:2026-10-13:18%3A00#%D7%93%D7%A0%D7%94", "972509990001", "דנה");
    await trainer("trainer_trial_heads_up:5:t-tr:972509990002:778:2026-10-12:18%3A00#%D7%A8%D7%95%D7%9F", "972509990002", "רון");
    await collector.finalize();

    const rows = db.rows("scheduled_template_sends");
    const queueRows = rows.filter((r) => String(r.dedup_key).startsWith("trainer_trial_heads_up:"));
    assert.equal(queueRows.length, 2);
    assert.ok(queueRows.every((r) => r.status === "canceled" && r.last_error === PLAN_SUPERSEDED_REASON), "queue rows are not marked sent");
    const planA = rows.find((r) => String(r.dedup_key).startsWith("plan:") && String(r.contact_phone).endsWith("0001"))!;
    const planB = rows.find((r) => String(r.dedup_key).startsWith("plan:") && String(r.contact_phone).endsWith("0002"))!;
    assert.equal(planA.status, "planned");
    assert.equal(planA.trigger_id, "t-tr");
    assert.equal(planB.status, "held", "«מחר» for a class today");
    assert.equal(db.rows("wa_template_send_refs").length, 0, "PLAN writes no delivery refs");

    // Writes stamp updated_at with the wall clock; put them on the test day.
    const lines = async (at: Date) => {
      for (const r of db.rows("scheduled_template_sends")) r.updated_at = new Date(at.getTime() - 10 * 60_000).toISOString();
      return (await loadAdminDailyUnsent(admin, at)).map((row) => row.reason);
    };

    // 09:40, DISPATCH never ran: the planned row is a problem; the held row is listed as held.
    let reasons = await lines(il("2026-10-12", "09:40"));
    assert.ok(reasons.includes(PLAN_NOT_DISPATCHED_REASON), JSON.stringify(reasons));
    assert.ok(reasons.includes(PLAN_HELD_REASON), JSON.stringify(reasons));
    assert.equal(reasons.length, 2, `queue rows add nothing: ${JSON.stringify(reasons)}`);

    // DISPATCH sends the planned row; Lior cancels the held one.
    const deps: DispatchDeps = { send: (async () => ({ ok: true })) as typeof sendBusinessTemplate, log: async () => {} };
    const out = await dispatchPlannedSends({ admin, slot: "morning", now: dispatchAt, deps });
    assert.deepEqual(out.outcomes, { sent: 1 });
    await cancelHeld(admin, { ids: [String(planB.id)] }, "lior@test");
    reasons = await lines(il("2026-10-12", "09:40"));
    assert.deepEqual(reasons, [MANUAL_BLOCK_REASON], "sent counts as sent, canceled as a manual block");

    // A planned row that DISPATCH sent but Meta failed shows as failed.
    planA.status = "failed";
    planA.last_error = "meta_131026";
    reasons = await lines(il("2026-10-12", "09:40"));
    assert.ok(reasons.includes("נכשל"), JSON.stringify(reasons));
  });

  await test("no 20:50 retry time left in the evening-run code and docs", async () => {
    const { readFileSync } = await import("node:fs");
    const { EVENING_RETRY_SLOT_IL, EVENING_SLOT_IL } = await import("@/lib/daily-run-slots");
    assert.equal(EVENING_SLOT_IL, "20:00");
    assert.equal(EVENING_RETRY_SLOT_IL, "20:20");
    for (const file of [
      "app/api/cron/arbox-daily-triggers/route.ts",
      "lib/leads/arbox-daily-run-status.ts",
      "lib/leads/arbox-daily-triggers-dispatch.ts",
      "lib/send-plan/runs.ts",
      "lib/send-plan/dispatch.ts",
      "lib/admin-daily-unsent-summary.ts",
      "supabase/arbox_daily_run_status.sql",
      "supabase/plan_before_send.sql",
    ]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /20:50|20:30/, file);
    }
  });

  assert.equal(network, 0, "no network calls");
  if (failures) {
    console.error(`\n${failures} failed`);
    process.exit(1);
  }
  console.log("\nall send-plan gate tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
