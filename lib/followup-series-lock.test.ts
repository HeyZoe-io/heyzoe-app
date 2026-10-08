/**
 * Follow-up series once per contact. Run: npx tsx lib/followup-series-lock.test.ts
 * Scenarios run through the real patch builders, the real gate, and the real tag logic.
 */
import assert from "node:assert/strict";
import {
  claimFollowupSeriesStart,
  decideFollowupSeriesGate,
  FOLLOWUP_SERIES_OPEN_OR_IN_PROGRESS,
  isMissingFollowupLockColumnError,
  lockFollowupSeriesForHumanInvolvement,
  resetFollowupSeriesLockProbeForTests,
} from "@/lib/followup-series-lock";
import {
  buildHumanReplyClearsRequestPatch,
  buildHumanRequestedContactPatch,
  buildHumanRequestedReactivationPatch,
  HUMAN_REPLY_FOLLOWUP_HOLD_STAGE,
  isHumanReplyFollowupHold,
} from "@/lib/human-requested";
import { buildNoResponseContactPatch, buildNoResponseReactivationPatch } from "@/lib/wa-no-response";
import { shouldResetWaFollowupCycleOnInbound, WA_FOLLOWUP_CYCLE_RESET_PATCH } from "@/lib/wa-followup-cycle-reset";
import { computeContactStatus } from "@/lib/contact-status";

type Contact = {
  wa_followup_stage: number;
  followup_series_locked_at: string | null;
  human_requested_at: string | null;
  wa_no_response_at: string | null;
  wa_next_followup_at: string | null;
  last_contact_at: string;
  session_phase: string;
  source: string;
};

const T0 = "2026-10-08T09:00:00.000Z";

function newLead(): Contact {
  return {
    wa_followup_stage: 0,
    followup_series_locked_at: null,
    human_requested_at: null,
    wa_no_response_at: null,
    wa_next_followup_at: T0,
    last_contact_at: T0,
    session_phase: "warmup",
    source: "whatsapp",
  };
}

function apply(c: Contact, patch: Record<string, unknown>): void {
  Object.assign(c, patch);
}

/** Lead message: the same patches the webhook applies today, in the same order. */
function leadWrites(c: Contact, atIso: string): void {
  if (c.wa_no_response_at) apply(c, buildNoResponseReactivationPatch());
  if (shouldResetWaFollowupCycleOnInbound(c)) apply(c, WA_FOLLOWUP_CYCLE_RESET_PATCH);
  if (isHumanReplyFollowupHold(c.wa_followup_stage)) apply(c, WA_FOLLOWUP_CYCLE_RESET_PATCH);
  apply(c, { last_contact_at: atIso, wa_next_followup_at: atIso });
}

/**
 * One cron pass over a due contact: the query filters (human_requested_at null, stage < 3,
 * lock gate) and then the per-contact gate + CAS claim before the send.
 */
function cronTick(c: Contact, lockColumn = true): boolean {
  if (c.human_requested_at || c.wa_no_response_at || c.wa_followup_stage >= 3) return false;
  const gate = decideFollowupSeriesGate({
    lockColumn,
    lockedAt: c.followup_series_locked_at,
    stageCurrent: c.wa_followup_stage,
  });
  if (gate === "locked") return false;
  if (gate === "start_series") c.followup_series_locked_at = new Date().toISOString();
  c.wa_followup_stage += 1;
  return true;
}

/** Human involvement in the DB: lock when null, stages 1–2 to the hold stage. */
function humanInvolvement(c: Contact): void {
  if (!c.followup_series_locked_at) c.followup_series_locked_at = new Date().toISOString();
  if (c.wa_followup_stage === 1 || c.wa_followup_stage === 2) {
    c.wa_followup_stage = HUMAN_REPLY_FOLLOWUP_HOLD_STAGE;
    c.wa_next_followup_at = null;
  }
}

function tag(c: Contact) {
  return computeContactStatus(c);
}

function sendsUntilSilent(c: Contact): number {
  let n = 0;
  for (let i = 0; i < 5; i += 1) if (cronTick(c)) n += 1;
  return n;
}

async function main() {
  // Gate decisions.
  assert.equal(decideFollowupSeriesGate({ lockColumn: false, lockedAt: T0, stageCurrent: 0 }), "no_lock_column");
  assert.equal(decideFollowupSeriesGate({ lockColumn: true, lockedAt: null, stageCurrent: 0 }), "start_series");
  assert.equal(decideFollowupSeriesGate({ lockColumn: true, lockedAt: null, stageCurrent: 1 }), "start_series");
  assert.equal(decideFollowupSeriesGate({ lockColumn: true, lockedAt: T0, stageCurrent: 1 }), "continue_series");
  assert.equal(decideFollowupSeriesGate({ lockColumn: true, lockedAt: T0, stageCurrent: 2 }), "continue_series");
  assert.equal(decideFollowupSeriesGate({ lockColumn: true, lockedAt: T0, stageCurrent: 0 }), "locked");
  assert.equal(decideFollowupSeriesGate({ lockColumn: true, lockedAt: T0, stageCurrent: 4 }), "locked");
  assert.equal(FOLLOWUP_SERIES_OPEN_OR_IN_PROGRESS, "followup_series_locked_at.is.null,wa_followup_stage.gt.0");
  assert.equal(
    isMissingFollowupLockColumnError({ code: "42703", message: "column contacts.followup_series_locked_at does not exist" }),
    true
  );
  assert.equal(isMissingFollowupLockColumnError({ code: "57014", message: "statement timeout" }), false);

  // A brand-new lead gets the series exactly as today: 3 sends, tags followup then no_response.
  {
    const c = newLead();
    assert.equal(tag(c), "active");
    assert.equal(cronTick(c), true);
    assert.ok(c.followup_series_locked_at, "first send locks");
    assert.equal(tag(c), "followup");
    assert.equal(cronTick(c), true);
    assert.equal(cronTick(c), true);
    assert.equal(c.wa_followup_stage, 3);
    assert.equal(tag(c), "no_response");
    assert.equal(cronTick(c), false);
  }

  // A series completes, the lead writes (tag lifts), then goes silent: no new series.
  {
    const c = newLead();
    sendsUntilSilent(c);
    apply(c, buildNoResponseContactPatch("2026-10-09T10:00:00.000Z"));
    assert.equal(tag(c), "no_response");
    leadWrites(c, "2026-10-09T12:00:00.000Z");
    assert.equal(c.wa_followup_stage, 0, "stage still resets for tags");
    assert.equal(tag(c), "active", "a lead message still lifts «ללא מענה»");
    assert.equal(sendsUntilSilent(c), 0);
  }

  // Inbound after 48h mid-series resets the cycle, but no new series starts.
  {
    const c = newLead();
    assert.equal(cronTick(c), true);
    c.last_contact_at = "2026-10-05T09:00:00.000Z";
    leadWrites(c, "2026-10-08T09:00:00.000Z");
    assert.equal(c.wa_followup_stage, 0);
    assert.equal(sendsUntilSilent(c), 0);
  }

  // A human request mid-series cancels it; «אשמח לפרטים» reopens the flow but not follow-ups.
  {
    const c = newLead();
    assert.equal(cronTick(c), true);
    apply(c, buildHumanRequestedContactPatch("2026-10-08T10:00:00.000Z"));
    humanInvolvement(c);
    assert.equal(tag(c), "human_requested");
    assert.equal(cronTick(c), false);
    apply(c, buildHumanRequestedReactivationPatch());
    leadWrites(c, "2026-10-08T11:00:00.000Z");
    assert.equal(c.human_requested_at, null);
    assert.equal(c.wa_followup_stage, 0);
    assert.equal(sendsUntilSilent(c), 0);
  }

  // Human request before any follow-up: never a series afterwards.
  {
    const c = newLead();
    apply(c, buildHumanRequestedContactPatch("2026-10-08T10:00:00.000Z"));
    humanInvolvement(c);
    apply(c, buildHumanRequestedReactivationPatch());
    leadWrites(c, "2026-10-08T11:00:00.000Z");
    assert.equal(sendsUntilSilent(c), 0);
  }

  // Staff app reply, lead writes, Zoe answers after the pause, lead goes silent: no follow-ups.
  {
    const c = newLead();
    assert.equal(cronTick(c), true);
    assert.equal(tag(c), "followup");
    humanInvolvement(c);
    assert.equal(c.wa_followup_stage, HUMAN_REPLY_FOLLOWUP_HOLD_STAGE);
    assert.equal(c.wa_next_followup_at, null);
    assert.equal(tag(c), "active", "cancelled series no longer shows «פולואפ»");
    leadWrites(c, "2026-10-08T15:00:00.000Z");
    assert.equal(c.wa_followup_stage, 0);
    assert.equal(sendsUntilSilent(c), 0);
  }

  // Staff reply after a human request clears the tag exactly as today; still no follow-ups.
  {
    const c = newLead();
    apply(c, buildHumanRequestedContactPatch("2026-10-08T10:00:00.000Z"));
    humanInvolvement(c);
    apply(c, buildHumanReplyClearsRequestPatch());
    humanInvolvement(c);
    assert.equal(c.human_requested_at, null);
    assert.equal(tag(c), "active");
    leadWrites(c, "2026-10-08T16:00:00.000Z");
    assert.equal(sendsUntilSilent(c), 0);
  }

  // Column missing: today's behavior, including a second series after a 48h reset.
  {
    const c = newLead();
    let sent = 0;
    for (let i = 0; i < 3; i += 1) if (cronTick(c, false)) sent += 1;
    assert.equal(sent, 3);
    assert.equal(c.followup_series_locked_at, null);
    apply(c, buildNoResponseContactPatch("2026-10-09T10:00:00.000Z"));
    leadWrites(c, "2026-10-10T12:00:00.000Z");
    assert.equal(cronTick(c, false), true);
  }

  // DB writes: claim is a CAS on the lock; human involvement locks (CAS), cancels 1–2, clears stage-0 due.
  {
    const ops: { table: string; payload?: unknown; filters: unknown[][] }[] = [];
    const admin = fakeAdmin(ops, { claimRows: [] });
    const lost = await claimFollowupSeriesStart({ admin, contactId: 7, nowIso: T0 });
    assert.equal(lost.claimed, false);
    assert.deepEqual(ops[0]?.filters, [
      ["eq", "id", 7],
      ["is", "followup_series_locked_at", null],
    ]);

    ops.length = 0;
    resetFollowupSeriesLockProbeForTests(true);
    const res = await lockFollowupSeriesForHumanInvolvement({
      admin: fakeAdmin(ops, { claimRows: [{ id: 1 }] }),
      businessId: 5,
      phone: "0508318162",
      nowIso: T0,
      reason: "staff_app_reply",
    });
    assert.deepEqual(res, { locked: 1, cancelled: 1 });
    assert.deepEqual(ops[0]?.payload, { followup_series_locked_at: T0 });
    assert.ok(ops[0]?.filters.some((f) => f[0] === "is" && f[1] === "followup_series_locked_at" && f[2] === null));
    assert.deepEqual(ops[1]?.payload, { wa_followup_stage: HUMAN_REPLY_FOLLOWUP_HOLD_STAGE, wa_next_followup_at: null });
    assert.ok(ops[1]?.filters.some((f) => f[0] === "in" && f[1] === "wa_followup_stage"));
    assert.deepEqual(ops[2]?.payload, { wa_next_followup_at: null });
    assert.ok(ops.every((op) => op.filters.some((f) => f[0] === "eq" && f[1] === "business_id" && f[2] === 5)));

    ops.length = 0;
    resetFollowupSeriesLockProbeForTests(false);
    const skipped = await lockFollowupSeriesForHumanInvolvement({
      admin: fakeAdmin(ops, { claimRows: [] }),
      businessId: 5,
      phone: "0508318162",
      nowIso: T0,
      reason: "dashboard_send",
    });
    assert.equal(skipped.skipped, "no_lock_column");
    assert.equal(ops.length, 0, "no writes before the migration");
  }

  console.log("followup-series-lock.test.ts ok");
}

function fakeAdmin(
  ops: { table: string; payload?: unknown; filters: unknown[][] }[],
  opts: { claimRows: { id: number }[] }
) {
  return {
    from(table: string) {
      const op: { table: string; payload?: unknown; filters: unknown[][] } = { table, filters: [] };
      const chain: Record<string, unknown> = {};
      const record = (kind: string) => (...args: unknown[]) => {
        op.filters.push([kind, ...args]);
        return chain;
      };
      for (const kind of ["eq", "in", "is", "or", "not", "limit"]) chain[kind] = record(kind);
      chain.update = (payload: unknown) => {
        op.payload = payload;
        ops.push(op);
        return chain;
      };
      chain.select = () => chain;
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: opts.claimRows, error: null }).then(resolve, reject);
      return chain;
    },
  } as never;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
