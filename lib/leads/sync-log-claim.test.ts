import assert from "node:assert/strict";
import {
  claimQueuedTemplateSend,
  claimSettleForDispatch,
  claimSyncLogBeforeSend,
  settleForSendError,
  missingColumnFromError,
  sendWithSyncLogClaim,
  settleQueuedTemplateSend,
  type SyncLogSettle,
} from "./sync-log-claim";
import {
  TRIAL_BOOKING_RETRYABLE,
  trialBookingAlreadyHandled,
  trialBookingClaimKey,
} from "./arbox-trial-booking-confirm";
import { isCancellationSyncLogTerminal, nextCancellationSyncLogAfterDispatch } from "./arbox-membership-cancelled";
import { templateFailureDispatch } from "../business-sends-hold";
import { sendErrorBodyIsExplicit, thrownSendOutcome } from "../notifications/graph-whatsapp-send";
import { trialSaleClaimKey } from "./arbox-trial-sale-registered";
import { firstPaidPurchaseClaimKey } from "./arbox-first-paid-purchase";
import { arboxNewLeadClaimKey } from "./arbox-new-lead";
import { classCancelNotifyClaimKey } from "./arbox-class-cancelled-customer";
import {
  companionClaimFailures,
  recordCompanionTemplateSent,
  settleCompanionTemplateSent,
} from "../same-trigger-template-order";

type Row = Record<string, unknown>;
type TableSpec = { columns: string[]; pk: string[]; statuses?: string[] };

/** In-memory PostgREST: missing columns, unique keys and status checks fail like Supabase. */
function fakeDb(specs: Record<string, TableSpec>) {
  const data: Record<string, Row[]> = {};
  for (const name of Object.keys(specs)) data[name] = [];

  function from(table: string) {
    const spec = specs[table]!;
    const rows = data[table]!;
    const missing = (payload: Row) => Object.keys(payload).find((key) => !spec.columns.includes(key));
    const missingErr = (column: string) => ({
      code: "PGRST204",
      message: `Could not find the '${column}' column of '${table}' in the schema cache`,
    });
    const checkErr = (payload: Row) =>
      spec.statuses && "status" in payload && !spec.statuses.includes(String(payload.status))
        ? { code: "23514", message: "violates check constraint" }
        : null;
    const keyOf = (row: Row) => spec.pk.map((column) => String(row[column])).join("|");

    function filtered(op: "select" | "update" | "delete", patch?: Row) {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      let selected = false;
      const run = () => {
        const bad = [...eqs.map(([column]) => column), ...ins.map(([column]) => column)].find(
          (column) => !spec.columns.includes(column)
        );
        if (bad) return { data: null, error: { code: "42703", message: `column ${table}.${bad} does not exist` } };
        if (patch) {
          const column = missing(patch);
          if (column) return { data: null, error: missingErr(column) };
          const check = checkErr(patch);
          if (check) return { data: null, error: check };
        }
        const matched = rows.filter(
          (row) =>
            eqs.every(([column, value]) => row[column] === value) &&
            ins.every(([column, values]) => values.includes(row[column]))
        );
        if (op === "update") for (const row of matched) Object.assign(row, patch);
        if (op === "delete") for (const row of matched) rows.splice(rows.indexOf(row), 1);
        return { data: op === "select" || selected ? matched.map((row) => ({ ...row })) : null, error: null };
      };
      const query = {
        eq(column: string, value: unknown) {
          eqs.push([column, value]);
          return query;
        },
        in(column: string, values: unknown[]) {
          ins.push([column, values]);
          return query;
        },
        select() {
          selected = true;
          return query;
        },
        maybeSingle() {
          const result = run();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return query;
    }

    return {
      insert(payload: Row) {
        const column = missing(payload);
        if (column) return Promise.resolve({ error: missingErr(column) });
        if (rows.some((row) => keyOf(row) === keyOf(payload))) {
          return Promise.resolve({ error: { code: "23505", message: "duplicate key value" } });
        }
        const check = checkErr(payload);
        if (check) return Promise.resolve({ error: check });
        rows.push({ ...payload });
        return Promise.resolve({ error: null });
      },
      upsert(payload: Row) {
        const column = missing(payload);
        if (column) return Promise.resolve({ error: missingErr(column) });
        const check = checkErr(payload);
        if (check) return Promise.resolve({ error: check });
        const existing = rows.find((row) => keyOf(row) === keyOf(payload));
        if (existing) Object.assign(existing, payload);
        else rows.push({ ...payload });
        return Promise.resolve({ error: null });
      },
      update: (patch: Row) => filtered("update", patch),
      delete: () => filtered("delete"),
      select: () => filtered("select"),
    };
  }

  return { admin: { from } as never, data };
}

const SYNC_COLUMNS = ["status", "attempts", "reason", "processed_at"];
const ALL_STATUSES = ["pending", "seeded", "sent", "abandoned", "no_phone", "skipped", "sending", "failed"];

type Key = { table: string; row: Row; filters: Array<[string, string | number]>; retryable?: readonly string[] };

type Path = {
  name: string;
  spec: TableSpec;
  key: (attempts: number) => Key;
  /** Meta error on this path: retried (failed) or released for an outer retry counter. */
  metaSettle: SyncLogSettle;
};

const now = new Date("2026-10-08T06:00:00.000Z");

const paths: Path[] = [
  {
    name: "trial booking confirm",
    spec: {
      columns: [
        "business_id", "trigger_id", "user_id", "class_date", "class_time", "class_name", "channel",
        "confirm_status", "template_status", ...SYNC_COLUMNS,
      ],
      pk: ["business_id", "trigger_id", "user_id", "class_date", "class_time", "class_name", "channel"],
      statuses: ALL_STATUSES,
    },
    key: (attempts) => ({
      ...trialBookingClaimKey(
        1,
        { userId: 11, classDate: "2026-10-09", classTime: "18:00", className: "Power" },
        "rule-a",
        "template",
        attempts,
        now
      ),
      retryable: TRIAL_BOOKING_RETRYABLE,
    }),
    metaSettle: "failed",
  },
  {
    name: "trial sale / purchase",
    spec: {
      columns: ["business_id", "sale_id", "trigger_id", "contact_id", ...SYNC_COLUMNS],
      pk: ["business_id", "sale_id", "trigger_id"],
      statuses: ALL_STATUSES,
    },
    key: (attempts) => trialSaleClaimKey(1, 500, "rule-a", null, attempts),
    metaSettle: "failed",
  },
  {
    name: "first purchase",
    spec: {
      columns: ["business_id", "trigger_id", "user_id", "sale_id", "seeded", "status", "attempts", "reason"],
      pk: ["business_id", "trigger_id", "user_id"],
      statuses: ALL_STATUSES,
    },
    key: (attempts) => firstPaidPurchaseClaimKey(1, "rule-a", 11, 500, attempts),
    metaSettle: "failed",
  },
  {
    name: "arbox new lead",
    spec: {
      columns: ["business_id", "trigger_id", "lead_id", "contact_id", ...SYNC_COLUMNS],
      pk: ["business_id", "trigger_id", "lead_id"],
      statuses: ALL_STATUSES,
    },
    key: (attempts) => arboxNewLeadClaimKey(1, "rule-a", 900, null, attempts),
    metaSettle: "failed",
  },
  {
    name: "class cancelled customer / trainer",
    spec: {
      columns: ["business_id", "trigger_id", "schedule_id", "user_id", "status", "reason", "processed_at"],
      pk: ["business_id", "trigger_id", "schedule_id", "user_id"],
    },
    key: () => classCancelNotifyClaimKey(1, "rule-a", { schedule_id: "77", user_id: "11" }, now),
    metaSettle: "release",
  },
];

async function send(key: Key, admin: never, settle: SyncLogSettle | "throw") {
  let graphCalls = 0;
  const outcome = await sendWithSyncLogClaim({
    admin,
    ...key,
    send: async () => {
      graphCalls += 1;
      if (settle === "throw") throw new Error("worker died after Graph");
      return { settle, value: settle };
    },
  }).catch(() => ({ claim: "won" as const, value: "throw" }));
  return { claim: outcome.claim, graphCalls };
}

async function pathTests(path: Path) {
  const table = path.key(0).table;
  const fresh = () => fakeDb({ [table]: path.spec });
  const statusOf = (db: ReturnType<typeof fakeDb>) => db.data[table]![0]?.status;

  // Success: one Graph call, final sent, a rerun does not call Graph.
  {
    const db = fresh();
    assert.deepEqual(await send(path.key(0), db.admin, "sent"), { claim: "won", graphCalls: 1 }, path.name);
    assert.equal(statusOf(db), "sent", path.name);
    assert.deepEqual(await send(path.key(0), db.admin, "sent"), { claim: "lost", graphCalls: 0 }, path.name);
  }

  // Meta error: the claim does not stay at sending, and the next run sends again.
  {
    const db = fresh();
    await send(path.key(0), db.admin, path.metaSettle);
    if (path.metaSettle === "failed") {
      assert.equal(statusOf(db), "failed", path.name);
      assert.equal(db.data[table]![0]?.attempts, 1, path.name);
    } else {
      assert.equal(db.data[table]!.length, 0, path.name);
    }
    assert.deepEqual(await send(path.key(1), db.admin, "sent"), { claim: "won", graphCalls: 1 }, path.name);
    assert.equal(statusOf(db), "sent", path.name);
  }

  // Unknown outcome (network error, timeout): final, never sent again.
  {
    const db = fresh();
    await send(path.key(0), db.admin, "unknown");
    const row = db.data[table]![0];
    if (path.spec.statuses) {
      assert.equal(row?.status, "sending", `${path.name}: before the SQL, unknown is stored as sending`);
      assert.equal(row?.reason, "send_outcome_unknown", path.name);
    }
    assert.deepEqual(await send(path.key(1), db.admin, "sent"), { claim: "lost", graphCalls: 0 }, path.name);
    const after = fakeDb({ [table]: { ...path.spec, statuses: path.spec.statuses && [...path.spec.statuses, "unknown"] } });
    await send(path.key(0), after.admin, "unknown");
    if (path.spec.statuses) assert.equal(after.data[table]![0]?.status, "unknown", path.name);
    assert.deepEqual(await send(path.key(1), after.admin, "sent"), { claim: "lost", graphCalls: 0 }, path.name);
  }

  // Worker death after the Graph call: the row stays at sending and is never sent again.
  {
    const db = fresh();
    await send(path.key(0), db.admin, "throw");
    assert.equal(statusOf(db), "sending", path.name);
    assert.deepEqual(await send(path.key(0), db.admin, "sent"), { claim: "lost", graphCalls: 0 }, path.name);
  }

  // A hold releases the claim: no row, the next run may send.
  {
    const db = fresh();
    await send(path.key(0), db.admin, "release");
    assert.equal(db.data[table]!.length, 0, path.name);
  }
}

async function capTests() {
  const spec: TableSpec = {
    columns: ["business_id", "trigger_id", "user_id", ...SYNC_COLUMNS],
    pk: ["business_id", "trigger_id", "user_id"],
    statuses: ALL_STATUSES,
  };
  const db = fakeDb({ arbox_birthday_sync_log: spec });
  const key = (attempts: number): Key => ({
    table: "arbox_birthday_sync_log",
    row: { business_id: 1, trigger_id: "r", user_id: 11, attempts },
    filters: [
      ["business_id", 1],
      ["trigger_id", "r"],
      ["user_id", 11],
    ],
  });
  await send(key(0), db.admin, "failed");
  await send(key(1), db.admin, "failed");
  await send(key(2), db.admin, "failed");
  assert.equal(db.data.arbox_birthday_sync_log![0]?.status, "abandoned");
  assert.deepEqual(await send(key(3), db.admin, "sent"), { claim: "lost", graphCalls: 0 });

  // A caller that always passes attempts 0 still reaches the cap from the stored count.
  const zero = fakeDb({ arbox_birthday_sync_log: spec });
  for (let i = 0; i < 3; i += 1) await send(key(0), zero.admin, "failed");
  assert.equal(zero.data.arbox_birthday_sync_log![0]?.status, "abandoned");
  assert.deepEqual(await send(key(0), zero.admin, "sent"), { claim: "lost", graphCalls: 0 });
}

async function legacyTableTests() {
  // Before the migration: no status / attempts / reason columns.
  const spec: TableSpec = { columns: ["business_id", "trigger_id", "user_id", "processed_at"], pk: ["business_id", "trigger_id", "user_id"] };
  const key: Key = {
    table: "arbox_birthday_sync_log",
    row: { business_id: 1, trigger_id: "r", user_id: 11, processed_at: now.toISOString(), attempts: 0 },
    filters: [
      ["business_id", 1],
      ["trigger_id", "r"],
      ["user_id", 11],
    ],
  };
  const sent = fakeDb({ arbox_birthday_sync_log: spec });
  assert.deepEqual(await send(key, sent.admin, "sent"), { claim: "won", graphCalls: 1 });
  assert.equal(sent.data.arbox_birthday_sync_log!.length, 1);
  assert.deepEqual(await send(key, sent.admin, "sent"), { claim: "lost", graphCalls: 0 });

  const failed = fakeDb({ arbox_birthday_sync_log: spec });
  await send(key, failed.admin, "failed");
  assert.equal(failed.data.arbox_birthday_sync_log!.length, 0, "legacy failed send leaves no row");

  const died = fakeDb({ arbox_birthday_sync_log: spec });
  await send(key, died.admin, "throw");
  assert.deepEqual(await send(key, died.admin, "sent"), { claim: "lost", graphCalls: 0 });

  // Status check without sending/failed yet: claim is stored as sent + reason sending.
  const checked = fakeDb({
    arbox_birthday_sync_log: { columns: ["business_id", "trigger_id", "user_id", ...SYNC_COLUMNS], pk: spec.pk, statuses: ["sent", "pending", "skipped"] },
  });
  assert.equal(await claimSyncLogBeforeSend({ admin: checked.admin, ...key }), "won");
  assert.equal(checked.data.arbox_birthday_sync_log![0]?.status, "sent");
  assert.equal(checked.data.arbox_birthday_sync_log![0]?.reason, "sending");
}

async function companionTests() {
  // site_lead + no_response: claim row in scheduled_template_sends before the Graph call.
  const spec: TableSpec = {
    columns: ["business_id", "trigger_id", "contact_phone", "template_name", "due_at", "status", "dedup_key", "last_error", "updated_at", "id"],
    pk: ["dedup_key"],
  };
  const input = { dedupKey: "site:1:r:972500000000:2026-10-08", businessId: 1, ruleId: "r", phone: "972500000000", templateName: "t", nowIso: now.toISOString() };
  const db = fakeDb({ scheduled_template_sends: spec });
  const rows = db.data.scheduled_template_sends!;

  assert.equal(await recordCompanionTemplateSent(db.admin, input), true);
  assert.equal(await recordCompanionTemplateSent(db.admin, input), false, "held claim is not taken twice");
  await settleCompanionTemplateSent(db.admin, input.dedupKey, "failed");
  assert.equal(rows[0]?.status, "failed");
  assert.equal(companionClaimFailures(rows[0]?.last_error), 1);
  assert.equal(await recordCompanionTemplateSent(db.admin, input), true, "Meta failure is retried");
  await settleCompanionTemplateSent(db.admin, input.dedupKey, "failed");
  assert.equal(await recordCompanionTemplateSent(db.admin, input), true);
  await settleCompanionTemplateSent(db.admin, input.dedupKey, "failed");
  assert.equal(companionClaimFailures(rows[0]?.last_error), 3);
  assert.equal(await recordCompanionTemplateSent(db.admin, input), false, "attempt cap");

  const ok = fakeDb({ scheduled_template_sends: spec });
  assert.equal(await recordCompanionTemplateSent(ok.admin, input), true);
  await settleCompanionTemplateSent(ok.admin, input.dedupKey, "sent");
  assert.equal(ok.data.scheduled_template_sends![0]?.status, "sent");
  assert.equal(await recordCompanionTemplateSent(ok.admin, input), false);

  const held = fakeDb({ scheduled_template_sends: spec });
  assert.equal(await recordCompanionTemplateSent(held.admin, input), true);
  await settleCompanionTemplateSent(held.admin, input.dedupKey, "release");
  assert.equal(held.data.scheduled_template_sends!.length, 0);

  const unknown = fakeDb({ scheduled_template_sends: spec });
  assert.equal(await recordCompanionTemplateSent(unknown.admin, input), true);
  await settleCompanionTemplateSent(unknown.admin, input.dedupKey, "unknown");
  assert.equal(unknown.data.scheduled_template_sends![0]?.status, "canceled");
  assert.equal(unknown.data.scheduled_template_sends![0]?.last_error, "send_outcome_unknown");
  assert.equal(await recordCompanionTemplateSent(unknown.admin, input), false, "unknown is never taken again");
}

async function queuedTests() {
  // Trainer heads-up immediate: pending → sending before Graph, so the drain cannot send it too.
  const spec: TableSpec = { columns: ["dedup_key", "status", "last_error", "updated_at", "id"], pk: ["dedup_key"] };
  const db = fakeDb({ scheduled_template_sends: spec });
  const rows = db.data.scheduled_template_sends!;
  rows.push({ id: 1, dedup_key: "k", status: "pending", last_error: null });
  assert.equal(await claimQueuedTemplateSend(db.admin, "k"), "won");
  assert.equal(rows[0]?.status, "sending");
  assert.equal(await claimQueuedTemplateSend(db.admin, "k"), "lost", "worker death: never sent again");
  await settleQueuedTemplateSend(db.admin, "k", "failed", "trainer_template_pending");
  assert.equal(rows[0]?.status, "pending");
  assert.equal(rows[0]?.last_error, "trainer_template_pending");
  assert.equal(await claimQueuedTemplateSend(db.admin, "k"), "won");
  await settleQueuedTemplateSend(db.admin, "k", "sent");
  assert.equal(rows[0]?.status, "sent");
  assert.equal(await claimQueuedTemplateSend(db.admin, "k"), "lost");

  // Unknown: final. Before the SQL allows `unknown`, it is stored as failed + send_outcome_unknown.
  const legacy = fakeDb({ scheduled_template_sends: { ...spec, statuses: ["pending", "sending", "sent", "canceled", "failed"] } });
  legacy.data.scheduled_template_sends!.push({ id: 2, dedup_key: "u", status: "pending", last_error: null });
  assert.equal(await claimQueuedTemplateSend(legacy.admin, "u"), "won");
  await settleQueuedTemplateSend(legacy.admin, "u", "unknown");
  assert.equal(legacy.data.scheduled_template_sends![0]?.status, "failed");
  assert.equal(legacy.data.scheduled_template_sends![0]?.last_error, "send_outcome_unknown");
  assert.equal(await claimQueuedTemplateSend(legacy.admin, "u"), "lost");
}

function classificationTests() {
  const meta = `{"error":{"message":"(#131026) Message undeliverable","code":131026}}`;
  assert.equal(sendErrorBodyIsExplicit(meta), true);
  assert.equal(sendErrorBodyIsExplicit("<html>502 Bad Gateway</html>"), false);
  assert.equal(sendErrorBodyIsExplicit(""), false);
  assert.equal(thrownSendOutcome(new Error(`[Meta WA send] 400 Bad Request: ${meta}`)), "explicit");
  assert.equal(thrownSendOutcome(new Error("[Meta WA send] 503 Service Unavailable: ")), "unknown");
  assert.equal(thrownSendOutcome(new TypeError("fetch failed")), "unknown");
  assert.equal(thrownSendOutcome(new DOMException("The operation was aborted due to timeout", "TimeoutError")), "unknown");
  assert.equal(templateFailureDispatch("(#131026) Message undeliverable"), "send_failed");
  assert.equal(templateFailureDispatch("send_outcome_unknown: fetch failed"), "send_unknown");
  assert.equal(templateFailureDispatch("sends_hold"), "gated");
  assert.equal(settleForSendError("send_outcome_unknown:http_502"), "unknown");
  assert.equal(settleForSendError("(#131026) Message undeliverable"), "failed");
  assert.equal(settleForSendError("sends_hold"), "release");
  assert.equal(claimSettleForDispatch("send_unknown"), "unknown");
  assert.deepEqual(nextCancellationSyncLogAfterDispatch({ dispatch: "send_unknown", attemptsSoFar: 1 }), {
    attempts: 1,
    status: "unknown",
    hitCap: false,
  });
  assert.equal(isCancellationSyncLogTerminal("unknown"), true);
  assert.equal(trialBookingAlreadyHandled("failed"), false, "trial booking: a Meta failure is retried");
  assert.equal(trialBookingAlreadyHandled("unknown"), true);
  assert.equal(trialBookingAlreadyHandled("sending"), true);
}

async function main() {
  assert.equal(missingColumnFromError({ message: "column arbox_birthday_sync_log.status does not exist" }), "status");
  assert.equal(
    missingColumnFromError({ message: "Could not find the 'attempts' column of 'arbox_birthday_sync_log' in the schema cache" }),
    "attempts"
  );
  classificationTests();
  for (const path of paths) await pathTests(path);
  await capTests();
  await legacyTableTests();
  await companionTests();
  await queuedTests();
  console.log("sync-log-claim.test.ts ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
