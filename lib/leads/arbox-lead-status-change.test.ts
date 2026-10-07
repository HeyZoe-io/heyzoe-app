import assert from "node:assert/strict";
import {
  diffLeadStatuses,
  isMissingLeadStatusSchema,
  leadStatusMassChangeBlocked,
  leadStatusRuleCanSend,
  leadStatusSendIsQueued,
  leadStatusShouldReseed,
  syncArboxLeadStatusForBusiness,
  type LeadStatusRule,
} from "@/lib/leads/arbox-lead-status-change";
import { minDelayDaysForTrigger, defaultDelayDays, formatDelayLabel } from "@/lib/trigger-catalog";
import { retentionRank } from "@/lib/leads/retention-daily-cap";
import { markRetentionSent } from "@/lib/leads/retention-daily-cap";

const now = new Date("2026-10-07T06:00:00.000Z");
const scanned = "2026-10-07T03:00:00.000Z";

assert.equal(minDelayDaysForTrigger("lead_status_changed"), 0);
assert.equal(defaultDelayDays("lead_status_changed"), 0);
assert.equal(formatDelayLabel("lead_status_changed", 0, "after"), "בריצה הקרובה (09:00 או 20:30)");
assert.equal(leadStatusSendIsQueued(0, now), false);
assert.equal(leadStatusSendIsQueued(1, now), true);
assert.ok(retentionRank("lost_lead") < retentionRank("lead_status_changed"));
assert.equal(isMissingLeadStatusSchema("relation does not exist"), true);
assert.equal(leadStatusMassChangeBlocked(21, 100), true);
assert.equal(leadStatusMassChangeBlocked(3, 10), true);
assert.equal(leadStatusMassChangeBlocked(2, 10), false);

{
  const previous = new Map([
    ["1", "א"],
    ["2", "ב"],
    ["3", "ג"],
  ]);
  const current = new Map([
    ["1", "ב"],
    ["2", "ב"],
    ["4", "א"],
  ]);
  const diff = diffLeadStatuses(previous, current);
  assert.deepEqual(diff.transitions, [{ leadId: "1", from: "א", to: "ב" }]);
  assert.deepEqual(diff.added, ["4"]);
  assert.deepEqual(diff.removed, ["3"]);
}

assert.equal(
  leadStatusShouldReseed({ snapshotCount: 0, lastScannedAt: scanned, now, ruleActivationMs: [1] }),
  true
);
assert.equal(
  leadStatusShouldReseed({
    snapshotCount: 2,
    lastScannedAt: new Date(now.getTime() - 40 * 3600_000).toISOString(),
    now,
    ruleActivationMs: [1],
  }),
  true
);
assert.equal(
  leadStatusShouldReseed({
    snapshotCount: 2,
    lastScannedAt: scanned,
    now,
    ruleActivationMs: [Date.parse("2026-10-07T05:00:00.000Z")],
  }),
  true
);

const rule = (delay: number, updated = "2026-10-01T00:00:00.000Z"): LeadStatusRule => ({
  id: "rule-1",
  delay_days: delay,
  delay_direction: "after",
  template_name: "lead_status_changed",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: updated,
  target_status: "ללא מענה 1",
});

assert.equal(leadStatusRuleCanSend(rule(0), scanned, now), true);
assert.equal(leadStatusRuleCanSend(rule(0, "2026-10-07T04:00:00.000Z"), scanned, now), false);

type Row = Record<string, unknown>;

function memoryAdmin(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { ...seed };
  return {
    tables,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: "select" | "upsert" | "insert" | "update" | "delete" = "select";
      let pending: Row | Row[] | null = null;
      const rows = () => (tables[table] ??= []);
      const matches = (row: Row) =>
        filters.every(([key, value]) => {
          if (Array.isArray(value)) return value.map(String).includes(String(row[key]));
          if (value && typeof value === "object" && "gte" in value) {
            return String(row[key] ?? "") >= String((value as { gte: unknown }).gte);
          }
          return String(row[key]) === String(value);
        });
      const builder = {
        select() {
          return builder;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return builder;
        },
        gte(key: string, value: unknown) {
          filters.push([key, { gte: value }]);
          return builder;
        },
        in(key: string, value: unknown[]) {
          filters.push([key, value]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          if (op !== "select") return Promise.resolve(apply());
          return Promise.resolve({ data: rows().filter(matches), error: null });
        },
        range() {
          return Promise.resolve({ data: rows().filter(matches), error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: rows().filter(matches)[0] ?? null, error: null });
        },
        upsert(row: Row | Row[]) {
          op = "upsert";
          pending = row;
          return Promise.resolve(apply());
        },
        insert(row: Row) {
          op = "insert";
          pending = row;
          return builder;
        },
        update(row: Row) {
          op = "update";
          pending = row;
          return builder;
        },
        delete() {
          op = "delete";
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(op === "select" ? { data: rows().filter(matches), error: null } : apply()).then(
            resolve,
            reject
          );
        },
      };
      function apply() {
        const batch = Array.isArray(pending) ? pending : pending ? [pending] : [];
        if (op === "delete") {
          tables[table] = rows().filter((row) => !matches(row));
          return { error: null, data: [] };
        }
        if (op === "update") {
          for (const row of rows().filter(matches)) Object.assign(row, batch[0] ?? {});
          return { error: null, data: rows().filter(matches) };
        }
        for (const row of batch) {
          if (op === "insert" && table === "arbox_lead_status_change_sync_log") {
            const clash = rows().some(
              (existing) =>
                String(existing.business_id) === String(row.business_id) &&
                String(existing.trigger_id) === String(row.trigger_id) &&
                String(existing.lead_id) === String(row.lead_id) &&
                String(existing.lead_status) === String(row.lead_status) &&
                String(existing.entered_at) === String(row.entered_at)
            );
            if (clash) return { error: { code: "23505", message: "duplicate" }, data: null };
          }
          const index = rows().findIndex((existing) => {
            if (table === "arbox_lead_status_snapshot") {
              return String(existing.lead_id) === String(row.lead_id);
            }
            if (table === "arbox_lead_known_statuses") return String(existing.status) === String(row.status);
            if (table === "arbox_lead_status_change_sync_log") {
              return (
                String(existing.trigger_id) === String(row.trigger_id) &&
                String(existing.lead_id) === String(row.lead_id) &&
                String(existing.lead_status) === String(row.lead_status) &&
                String(existing.entered_at) === String(row.entered_at)
              );
            }
            if (table === "businesses") return String(existing.id) === String(row.id ?? existing.id);
            return false;
          });
          if (index >= 0) rows()[index] = { ...rows()[index], ...row };
          else rows().push({ ...row });
        }
        return { error: null, data: batch };
      }
      return builder;
    },
  };
}

function lead(id: string, status: string, phone = "972501110010") {
  return { user_id: id, lead_status: status, phone, full_name: "דנה כהן" };
}

function withCrowd(changed: Record<string, unknown>) {
  return [
    changed,
    ...Array.from({ length: 9 }, (_, index) => lead(String(200 + index), "בטיפול", "972501110200")),
  ];
}

function baseTables(extra?: Record<string, Row[]>): Record<string, Row[]> {
  return {
    template_triggers: [
      {
        id: "rule-1",
        trigger_type: "lead_status_changed",
        business_id: 3646,
        delay_days: 0,
        delay_direction: "after",
        template_name: "lead_status_changed",
        enabled: true,
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
        target_status: "ללא מענה 1",
      },
    ],
    businesses: [{ id: 3646, arbox_lead_status_last_scanned_at: scanned }],
    arbox_lead_status_snapshot: [
      { business_id: 3646, lead_id: "10", status: "בטיפול" },
      ...Array.from({ length: 9 }, (_, index) => ({
        business_id: 3646,
        lead_id: String(200 + index),
        status: "בטיפול",
      })),
    ],
    arbox_lead_known_statuses: [
      { business_id: 3646, status: "ללא מענה 1" },
      { business_id: 3646, status: "בטיפול" },
    ],
    arbox_lead_status_change_sync_log: [],
    contacts: [],
    ...extra,
  };
}

async function run(
  tables: Record<string, Row[]>,
  rows: Record<string, unknown>[],
  delay = 0,
  when = now
) {
  tables.template_triggers = [{ ...tables.template_triggers[0], delay_days: delay }];
  const admin = memoryAdmin(tables);
  let fetches = 0;
  let sends = 0;
  const summary = await syncArboxLeadStatusForBusiness({
    admin: admin as never,
    businessId: 3646,
    businessSlug: "or-ia-wellness-vlub",
    apiKey: "key",
    boxId: "1",
    now: when,
    fetchLeads: async () => {
      fetches += 1;
      return { ok: true, rows, pagesFetched: 1 };
    },
    dispatchTemplate: async () => {
      sends += 1;
      return { dispatch: delay >= 1 ? "deferred" : "immediate", ok: true };
    },
  });
  return { summary, admin, fetches, sends };
}

async function cases() {
  const noRule = memoryAdmin({
    template_triggers: [],
    businesses: [],
    arbox_lead_status_snapshot: [],
    arbox_lead_known_statuses: [],
  });
  let fetches = 0;
  const skipped = await syncArboxLeadStatusForBusiness({
    admin: noRule as never,
    businessId: 1,
    businessSlug: "studio",
    apiKey: "key",
    boxId: "1",
    now,
    fetchLeads: async () => {
      fetches += 1;
      return { ok: true, rows: [], pagesFetched: 1 };
    },
  });
  assert.equal(fetches, 0);
  assert.equal(skipped.skip_reason, "no_rule");

  const missing = memoryAdmin({
    template_triggers: baseTables().template_triggers,
    businesses: [{ id: 3646, arbox_lead_status_last_scanned_at: scanned }],
  });
  const originalFrom = missing.from.bind(missing);
  missing.from = (table: string) => {
    if (table === "arbox_lead_status_snapshot") {
      return {
        select: () => ({
          eq: () => ({
            range: () => Promise.resolve({ data: null, error: { message: "relation does not exist" } }),
          }),
        }),
      } as never;
    }
    return originalFrom(table);
  };
  let missingFetches = 0;
  const inert = await syncArboxLeadStatusForBusiness({
    admin: missing as never,
    businessId: 3646,
    businessSlug: "or-ia-wellness-vlub",
    apiKey: "key",
    boxId: "1",
    now,
    fetchLeads: async () => {
      missingFetches += 1;
      return { ok: true, rows: [], pagesFetched: 1 };
    },
  });
  assert.equal(missingFetches, 0);
  assert.equal(inert.skip_reason, "schema_missing");
  assert.equal(inert.notified, 0);

  const seed = await run(
    baseTables({
      arbox_lead_status_snapshot: [],
      businesses: [{ id: 3646, arbox_lead_status_last_scanned_at: null }],
    }),
    [lead("10", "ללא מענה 1")]
  );
  assert.equal(seed.summary.seeded, true);
  assert.equal(seed.sends, 0);

  const stale = await run(
    baseTables({
      businesses: [{ id: 3646, arbox_lead_status_last_scanned_at: "2026-10-05T00:00:00.000Z" }],
    }),
    [lead("10", "ללא מענה 1")]
  );
  assert.equal(stale.summary.seeded, true);
  assert.equal(stale.sends, 0);

  const sent = await run(baseTables(), withCrowd(lead("10", "ללא מענה 1", "972501110011")));
  assert.equal(sent.sends, 1);
  assert.equal(sent.summary.notified, 1);
  assert.equal(sent.summary.added, 0);
  assert.equal(sent.summary.removed, 0);

  const duplicate = baseTables();
  duplicate.arbox_lead_status_change_sync_log = [
    {
      business_id: 3646,
      trigger_id: "rule-1",
      lead_id: "10",
      lead_status: "ללא מענה 1",
      entered_at: scanned,
      status: "sent",
    },
  ];
  const again = await run(duplicate, withCrowd(lead("10", "ללא מענה 1", "972501110012")));
  assert.equal(again.sends, 0);
  assert.equal(again.summary.already, 1);

  const fresh = await run(
    baseTables({ arbox_lead_known_statuses: [{ business_id: 3646, status: "בטיפול" }] }),
    [
    lead("10", "ללא מענה 1"),
  ]);
  assert.equal(fresh.sends, 0);
  assert.equal(fresh.summary.skipped_unknown_status, 1);

  const appeared = await run(baseTables(), [
    ...withCrowd(lead("10", "בטיפול")),
    lead("11", "ללא מענה 1", "972501110014"),
  ]);
  assert.equal(appeared.sends, 0);
  assert.equal(appeared.summary.added, 1);
  assert.equal(appeared.summary.transitions, 0);

  const gone = await run(baseTables(), withCrowd(lead("99", "בטיפול")).slice(1));
  assert.equal(gone.sends, 0);
  assert.equal(gone.summary.removed, 1);
  assert.equal(gone.summary.transitions, 0);

  const episodePhone = "972501110013";
  const firstEpisode = await run(baseTables(), withCrowd(lead("10", "ללא מענה 1", episodePhone)));
  assert.equal(firstEpisode.sends, 1);
  const left = await run(firstEpisode.admin.tables, withCrowd(lead("10", "בטיפול", episodePhone)));
  assert.equal(left.sends, 0);
  const back = await run(
    left.admin.tables,
    withCrowd(lead("10", "ללא מענה 1", episodePhone)),
    0,
    new Date("2026-10-08T06:00:00.000Z")
  );
  assert.equal(back.sends, 1);
  assert.equal(back.summary.notified, 1);

  const many = Array.from({ length: 21 }, (_, index) => lead(String(index + 1), "ללא מענה 1"));
  const massTables = baseTables({
    arbox_lead_status_snapshot: many.map((row) => ({
      business_id: 3646,
      lead_id: row.user_id,
      status: "בטיפול",
    })),
  });
  const mass = await run(massTables, many);
  assert.equal(mass.sends, 0);
  assert.equal(mass.summary.skipped_mass, 21);
  assert.ok(
    mass.admin.tables.arbox_lead_status_change_sync_log.every((row) => row.reason === "mass_change")
  );

  const lateRule = baseTables();
  lateRule.template_triggers[0].updated_at = "2026-10-07T04:00:00.000Z";
  const cutoff = await run(lateRule, withCrowd(lead("10", "ללא מענה 1", "972501110015")));
  assert.equal(cutoff.sends, 0);

  markRetentionSent(3646, "972501110099", now);
  const capped = await run(baseTables(), withCrowd(lead("10", "ללא מענה 1", "972501110099")));
  assert.equal(capped.sends, 0);
  assert.equal(capped.summary.skipped_cap, 1);

  const queued = await run(baseTables(), withCrowd(lead("10", "ללא מענה 1", "972501110088")), 2);
  assert.equal(queued.sends, 1);
  assert.equal(queued.summary.deferred, 1);
  assert.equal(queued.summary.notified, 0);

  const opted = baseTables({
    contacts: [
      {
        id: "c-out",
        business_id: 3646,
        arbox_user_id: "10",
        phone: "972501110016",
        full_name: "דנה",
        opted_out: true,
      },
    ],
  });
  const optedOut = await run(opted, withCrowd(lead("10", "ללא מענה 1", "972501110016")));
  assert.equal(optedOut.sends, 0);
  assert.equal(optedOut.summary.skipped_opt_out, 1);

  const shared = baseTables();
  const overlapRows = withCrowd(lead("10", "ללא מענה 1", "972501110077"));
  const [firstRun, secondRun] = await Promise.all([run(shared, overlapRows), run(shared, overlapRows)]);
  assert.equal(firstRun.sends + secondRun.sends, 1);
}

cases().then(
  () => console.log("arbox-lead-status-change.test.ts: ok"),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
