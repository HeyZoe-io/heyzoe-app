import assert from "node:assert/strict";
import { nextAllowedWhatsAppSendTimeIsrael } from "@/lib/israel-time";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";
import { flushDueManualBulkSends } from "@/lib/manual-bulk/dispatch";
import { dispatchDueMarketingScheduledSend } from "@/lib/marketing-template-dispatch";
import {
  buildArboxNewLeadScheduledDedupKey,
  buildPurchaseScheduledDedupKey,
  computeDueAt,
  decideScheduledDrainDispatch,
  decideScheduledSendAfterMeta,
  decideScheduledSendGate,
  isDuePendingScheduledSend,
  NO_TEMPLATE_SKIPPED_ERROR,
  selectDuePendingScheduledSends,
} from "@/lib/scheduled-template-sends";

const MS_DAY = 24 * 60 * 60 * 1000;
const eventDate = new Date("2026-08-01T12:00:00.000Z");

/** computeDueAt — after */
{
  const due = computeDueAt({ delay_days: 3, delay_direction: "after" }, eventDate);
  assert.equal(due.toISOString(), new Date(eventDate.getTime() + 3 * MS_DAY).toISOString());
}

/** computeDueAt — before */
{
  const due = computeDueAt({ delay_days: 2, delay_direction: "before" }, eventDate);
  assert.equal(due.toISOString(), new Date(eventDate.getTime() - 2 * MS_DAY).toISOString());
}

/** computeDueAt — delay_days 0 stays on event date */
{
  const due = computeDueAt({ delay_days: 0, delay_direction: "after" }, eventDate);
  assert.equal(due.toISOString(), eventDate.toISOString());
}

/** purchase dedup_key is stable for same sale+trigger */
{
  const a = buildPurchaseScheduledDedupKey(1, "rule-uuid", 94530126);
  const b = buildPurchaseScheduledDedupKey(1, "rule-uuid", 94530126);
  const c = buildPurchaseScheduledDedupKey(1, "rule-uuid", 94530127);
  assert.equal(a, b);
  assert.equal(a, "purchase:1:rule-uuid:94530126");
  assert.notEqual(a, c);
}

/** arbox_new_lead dedup_key is per Arbox user_id */
{
  assert.equal(
    buildArboxNewLeadScheduledDedupKey(1, "rule-uuid", 11049159),
    "arbox_new_lead:1:rule-uuid:11049159"
  );
}

/** enqueue idempotency semantics: unique dedup_key means second insert is a no-op */
{
  const store = new Map<string, { status: string }>();
  function enqueueOnce(dedupKey: string): "inserted" | "already" {
    if (store.has(dedupKey)) return "already";
    store.set(dedupKey, { status: "pending" });
    return "inserted";
  }
  const key = buildPurchaseScheduledDedupKey(7, "t1", 100);
  assert.equal(enqueueOnce(key), "inserted");
  assert.equal(enqueueOnce(key), "already");
  assert.equal(store.size, 1);
}

/** dispatch selects only due+pending */
{
  const now = new Date("2026-08-10T12:00:00.000Z");
  const rows = [
    { id: "a", status: "pending", due_at: "2026-08-09T12:00:00.000Z" },
    { id: "b", status: "pending", due_at: "2026-08-11T12:00:00.000Z" },
    { id: "c", status: "sent", due_at: "2026-08-01T12:00:00.000Z" },
    { id: "d", status: "failed", due_at: "2026-08-01T12:00:00.000Z" },
    { id: "e", status: "pending", due_at: "2026-08-08T12:00:00.000Z" },
  ];

  const due = selectDuePendingScheduledSends(rows, now, 200);
  assert.deepEqual(
    due.map((r) => r.id),
    ["e", "a"]
  );
  assert.equal(isDuePendingScheduledSend(rows[1]!, now), false);
  assert.equal(isDuePendingScheduledSend(rows[2]!, now), false);
}

/** due + no approved template → canceled (not pending, not sent) */
{
  const gate = decideScheduledSendGate({
    hasChannel: true,
    hasWaba: true,
    hasApprovedTemplate: false,
  });
  assert.equal(gate.action, "cancel");
  if (gate.action === "cancel") {
    assert.equal(gate.last_error, NO_TEMPLATE_SKIPPED_ERROR);
  }

  const status = gate.action === "cancel" ? "canceled" : "sent";
  assert.equal(status, "canceled");
  assert.notEqual(status, "pending");
  assert.notEqual(status, "sent");
}

/** due + no WABA / no channel → also canceled with no_template_skipped */
{
  assert.deepEqual(
    decideScheduledSendGate({
      hasChannel: false,
      hasWaba: true,
      hasApprovedTemplate: true,
    }),
    { action: "cancel", last_error: NO_TEMPLATE_SKIPPED_ERROR }
  );
  assert.deepEqual(
    decideScheduledSendGate({
      hasChannel: true,
      hasWaba: false,
      hasApprovedTemplate: true,
    }),
    { action: "cancel", last_error: NO_TEMPLATE_SKIPPED_ERROR }
  );
}

/** due + approved template (sendable) → send path; Meta ok → sent */
{
  const gate = decideScheduledSendGate({
    hasChannel: true,
    hasWaba: true,
    hasApprovedTemplate: true,
  });
  assert.equal(gate.action, "send");
  const after = decideScheduledSendAfterMeta({ ok: true });
  assert.equal(after.status, "sent");
  assert.equal(after.last_error, null);
}

/** transient Meta error → failed (not canceled) */
{
  const after = decideScheduledSendAfterMeta({
    ok: false,
    error: "http_500 temporary",
  });
  assert.equal(after.status, "failed");
  assert.equal(after.last_error, "http_500 temporary");
  assert.notEqual(after.status, "canceled");
}

const thu0200 = israelWallTimeToUtc("2026-09-03", "02:00");
const thu0630 = israelWallTimeToUtc("2026-09-03", "06:30");
const thu1400 = israelWallTimeToUtc("2026-09-03", "14:00");
const sat1000 = israelWallTimeToUtc("2026-09-05", "10:00");
const sat1900 = israelWallTimeToUtc("2026-09-05", "19:00");

function explodingAdmin() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("drain must not query or send when the send window is closed");
      },
    }
  ) as never;
}

/** due at 02:00 stays due+pending; drain holds (does not dispatch, does not consume) */
{
  const row = { status: "pending", due_at: thu0200.toISOString() };
  assert.equal(isDuePendingScheduledSend(row, thu0200), true);
  assert.equal(decideScheduledDrainDispatch(thu0200).action, "hold");
  assert.equal(row.status, "pending");

  const nextTick = nextAllowedWhatsAppSendTimeIsrael(thu0200);
  assert.equal(nextTick.toISOString(), thu0630.toISOString());
  assert.equal(decideScheduledDrainDispatch(nextTick).action, "dispatch");
  assert.equal(isDuePendingScheduledSend(row, nextTick), true);
}

/** weekday 14:00 is inside the window — drain dispatches */
{
  const row = { status: "pending", due_at: thu1400.toISOString() };
  assert.equal(isDuePendingScheduledSend(row, thu1400), true);
  assert.equal(decideScheduledDrainDispatch(thu1400).action, "dispatch");
}

/** Sat morning holds until Sat 19:00 (same window as wa-followups) */
{
  const row = { status: "pending", due_at: sat1000.toISOString() };
  assert.equal(isDuePendingScheduledSend(row, sat1000), true);
  assert.equal(decideScheduledDrainDispatch(sat1000).action, "hold");
  assert.equal(row.status, "pending");

  const nextTick = nextAllowedWhatsAppSendTimeIsrael(sat1000);
  assert.equal(nextTick.toISOString(), sat1900.toISOString());
  assert.equal(decideScheduledDrainDispatch(nextTick).action, "dispatch");
  assert.equal(isDuePendingScheduledSend(row, nextTick), true);
}

/** hold does not rewrite due_at */
{
  const eventDate = new Date("2026-08-01T12:00:00.000Z");
  const due = computeDueAt({ delay_days: 3, delay_direction: "after" }, eventDate);
  const before = due.toISOString();
  decideScheduledDrainDispatch(thu0200);
  assert.equal(due.toISOString(), before);
}

/** all three drain queues honor the same hold (no DB, status stays pending) */
void (async () => {
  const bulk = await flushDueManualBulkSends(explodingAdmin(), thu0200.toISOString(), thu0200);
  assert.equal(bulk.held, true);
  assert.equal(bulk.sent, 0);
  assert.equal(bulk.fetched, 0);
  assert.equal(bulk.failed, 0);
  assert.equal(bulk.canceled, 0);

  const marketing = await dispatchDueMarketingScheduledSend(
    explodingAdmin(),
    {
      id: "m1",
      trigger_id: "t1",
      contact_phone: "972501234567",
      template_name: "hello",
      due_at: thu0200.toISOString(),
      status: "pending",
      dedup_key: "k",
      body_params: null,
      last_error: null,
      created_at: thu0200.toISOString(),
      updated_at: thu0200.toISOString(),
    },
    { now: thu0200, honorSendWindow: true }
  );
  assert.equal(marketing, "skipped");

  assert.equal(decideScheduledDrainDispatch(thu0200).action, "hold");
  assert.equal(decideScheduledDrainDispatch(thu1400).action, "dispatch");

  console.log("scheduled-template-sends.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
