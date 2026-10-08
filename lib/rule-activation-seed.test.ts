import assert from "node:assert/strict";
import {
  activationCatchUpDue,
  markRulesSeeded,
  ruleIdsActiveSinceActivation,
  ruleSeededForActivation,
} from "@/lib/rule-activation";
import { earlyCutoffNormalSendAt, trialReminderNormalSendAt } from "@/lib/leads/arbox-trial-reminder";
import { israelWallTimeToUtc } from "@/lib/marketing-call-time";

// ── Part 7a: OR-IA, rule created 7.10 09:56 IL, delay 1, class 8.10 17:00 ──
const oria = { id: "056065bd", created_at: "2026-10-07T06:56:07.000Z", updated_at: "2026-10-07T06:56:07.000Z" };
const classDateYmd = "2026-10-08";
const classTime = "17:00";
const classStartAt = israelWallTimeToUtc(classDateYmd, classTime);
const trainerSendAt = earlyCutoffNormalSendAt({ classDateYmd, classTime, delayDays: 1 });
assert.equal(trainerSendAt?.toISOString(), "2026-10-07T06:00:00.000Z", "normal heads-up slot is 7.10 09:00");

const evening7 = new Date("2026-10-07T17:00:00.000Z"); // 7.10 20:00 IL
const morning8 = new Date("2026-10-08T06:00:00.000Z"); // 8.10 09:00 IL
const afterClass = new Date("2026-10-08T14:30:00.000Z"); // 8.10 17:30 IL

const due = (rule: typeof oria, now: Date, sameDayOnly: boolean, sendAt: Date | null = trainerSendAt) =>
  activationCatchUpDue({ sendAt, classStartAt, rule, now, sameDayOnly });

assert.equal(due(oria, evening7, false), true, "dated body: 7.10 evening run carries tomorrow's heads-up");
assert.equal(due(oria, evening7, true), true, "undated body: same day as the normal slot is fine");
assert.equal(due(oria, morning8, false), true, "dated body: still due on 8.10 morning before the class");
assert.equal(due(oria, morning8, true), false, "undated body may say «מחר»: never on the class day");
assert.equal(due(oria, afterClass, false), false, "class already started: nothing to send");
assert.equal(due(oria, new Date("2026-10-07T06:30:00.000Z"), false), false, "before the rule existed: no catch-up");

const earlyRule = { id: "early", created_at: "2026-10-07T05:00:00.000Z", updated_at: "2026-10-07T05:00:00.000Z" };
assert.equal(due(earlyRule, evening7, false), false, "rule active at the normal slot stays on the normal path");
assert.equal(due(oria, evening7, false, null), false, "unknown send time: no catch-up");

// Class reminder delay 1: normal 7.10 20:00. Rule created 7.10 20:05 → 20:20 retry, same day only.
const reminderSendAt = trialReminderNormalSendAt({ classDateYmd, classTime, delayDays: 1 });
assert.equal(reminderSendAt?.toISOString(), "2026-10-07T17:00:00.000Z");
const lateReminder = { id: "rem", created_at: "2026-10-07T17:05:00.000Z", updated_at: "2026-10-07T17:05:00.000Z" };
assert.equal(
  activationCatchUpDue({
    sendAt: reminderSendAt,
    classStartAt,
    rule: lateReminder,
    now: new Date("2026-10-07T17:20:00.000Z"),
    sameDayOnly: true,
  }),
  true
);
assert.equal(
  activationCatchUpDue({ sendAt: reminderSendAt, classStartAt, rule: lateReminder, now: morning8, sameDayOnly: true }),
  false,
  "«מחכים לך מחר» must not go out on the class day"
);

// ── Part 7b: explicit seeded_at marker ──
const old = { id: "old", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const reenabled = { id: "re", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-10-07T10:00:00.000Z" };
const brandNew = { id: "new", created_at: "2026-10-07T10:00:00.000Z", updated_at: "2026-10-07T10:00:00.000Z" };

assert.equal(ruleSeededForActivation(old, Date.parse("2026-01-01T00:00:00.000Z")), true);
assert.equal(ruleSeededForActivation(old, null), false);
assert.equal(ruleSeededForActivation(reenabled, Date.parse("2026-01-02T00:00:00.000Z")), false, "re-enable seeds again");

type Call = { table: string; op: string; payload?: unknown };

function fakeAdmin(opts: {
  seeded?: Record<string, string | null>;
  seededError?: string;
  dedupRows?: Record<string, number>;
  calls: Call[];
}) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          opts.calls.push({ table, op: `select ${columns}` });
          const chain = {
            in: async (_c: string, ids: string[]) => {
              if (opts.seededError) return { data: null, error: { message: opts.seededError } };
              if (!opts.seeded) return { data: ids.map((id) => ({ id })), error: null };
              return { data: ids.map((id) => ({ id, seeded_at: opts.seeded![id] ?? null })), error: null };
            },
            eq: () => ({
              eq: (_c: string, triggerId: unknown) => ({
                gte: () => ({
                  limit: async () => ({
                    data: Array.from({ length: opts.dedupRows?.[String(triggerId)] ?? 0 }, () => ({
                      trigger_id: triggerId,
                    })),
                    error: null,
                  }),
                }),
              }),
            }),
          };
          return chain;
        },
        update(row: Record<string, unknown>) {
          return {
            in: async (_c: string, ids: string[]) => {
              opts.calls.push({ table, op: "update", payload: { row, ids } });
              return { error: null };
            },
          };
        },
      };
    },
  };
}

async function main() {
  const rules = [old, reenabled, brandNew];

  // Column present: long-existing rule with no queue rows is NOT new.
  {
    const calls: Call[] = [];
    const admin = fakeAdmin({
      calls,
      seeded: { old: "2026-01-01T00:00:00.000Z", re: "2026-02-01T00:00:00.000Z", new: null },
      dedupRows: {},
    });
    const active = await ruleIdsActiveSinceActivation(admin, "arbox_trial_reminder_sync_log", 1, rules);
    assert.deepEqual([...(active ?? [])].sort(), ["old"]);
    assert.ok(!calls.some((c) => c.table === "arbox_trial_reminder_sync_log"), "no per-rule log reads");
  }

  // Column missing (SQL not run yet): old row logic.
  {
    const calls: Call[] = [];
    const admin = fakeAdmin({ calls, dedupRows: { new: 1 } });
    const active = await ruleIdsActiveSinceActivation(admin, "arbox_trial_reminder_sync_log", 1, rules);
    assert.deepEqual([...(active ?? [])], ["new"]);
  }
  {
    const calls: Call[] = [];
    const admin = fakeAdmin({ calls, seededError: 'column template_triggers.seeded_at does not exist (42703)' });
    const active = await ruleIdsActiveSinceActivation(admin, "x", 1, rules);
    assert.deepEqual([...(active ?? [])], []);
  }

  // Read failure: null, callers stop.
  {
    const calls: Call[] = [];
    const admin = fakeAdmin({ calls, seededError: "connection reset" });
    assert.equal(await ruleIdsActiveSinceActivation(admin, "x", 1, rules), null);
  }

  // markRulesSeeded: one batched update, deduped ids.
  {
    const calls: Call[] = [];
    const admin = fakeAdmin({ calls });
    const now = new Date("2026-10-07T17:00:00.000Z");
    await markRulesSeeded(admin, ["new", "new", " ", "re"], now);
    const updates = calls.filter((c) => c.op === "update");
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].payload, { row: { seeded_at: now.toISOString() }, ids: ["new", "re"] });
  }

  // markRulesSeeded: skipped in a dry run.
  {
    const g = globalThis as { __hzArboxDaily?: unknown };
    const prev = g.__hzArboxDaily;
    g.__hzArboxDaily = { context: () => undefined, isDryRun: () => true };
    try {
      const calls: Call[] = [];
      await markRulesSeeded(fakeAdmin({ calls }), ["new"], new Date());
      assert.equal(calls.length, 0);
    } finally {
      g.__hzArboxDaily = prev;
    }
  }

  // markRulesSeeded never throws.
  await markRulesSeeded({ from: () => { throw new Error("boom"); } }, ["new"], new Date());

  console.log("rule-activation-seed.test.ts: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
