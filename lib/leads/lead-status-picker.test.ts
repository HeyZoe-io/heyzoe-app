import assert from "node:assert/strict";
import { refreshArboxLeadStatusCatalog } from "@/lib/leads/arbox-lead-status-change";
import {
  distinctNonEmptyLeadStatuses,
  leadStatusPickerAfterRefresh,
  leadStatusRefreshArboxError,
} from "@/lib/leads/lead-status-picker";

const now = new Date("2026-10-07T06:00:00.000Z");

async function main() {

function memoryAdmin(seed: Record<string, Record<string, unknown>[]>) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const writes: string[] = [];
  return {
    tables,
    writes,
    from(table: string) {
      const filters: [string, unknown][] = [];
      let op: "select" | "upsert" | "update" | "insert" | "delete" = "select";
      let payload: Record<string, unknown>[] = [];
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        limit() {
          return builder;
        },
        upsert(rows: Record<string, unknown>[]) {
          op = "upsert";
          payload = rows;
          writes.push(`${table}:upsert`);
          return builder;
        },
        update() {
          op = "update";
          writes.push(`${table}:update`);
          return builder;
        },
        insert() {
          op = "insert";
          writes.push(`${table}:insert`);
          return builder;
        },
        delete() {
          op = "delete";
          writes.push(`${table}:delete`);
          return builder;
        },
        then(resolve: (value: { data: unknown; error: null; count: number }) => void) {
          const rows = () => tables[table] ?? [];
          const matches = (row: Record<string, unknown>) =>
            filters.every(([column, value]) => row[column] === value);
          if (op === "upsert") {
            tables[table] ??= [];
            for (const row of payload) {
              const index = tables[table].findIndex(
                (existing) =>
                  existing.business_id === row.business_id &&
                  existing.status === row.status &&
                  existing.lead_id === row.lead_id
              );
              if (index >= 0) Object.assign(tables[table][index], row);
              else tables[table].push({ ...row });
            }
            resolve({ data: payload, error: null, count: payload.length });
            return;
          }
          const matched = rows().filter(matches);
          resolve({ data: matched, error: null, count: matched.length });
        },
      };
      return builder;
    },
  };
}

{
  const admin = memoryAdmin({
    arbox_lead_known_statuses: [],
    arbox_lead_status_snapshot: [{ business_id: 3646, lead_id: "keep", status: "בטיפול" }],
    arbox_lead_status_change_sync_log: [],
    businesses: [{ id: 3646, arbox_lead_status_last_scanned_at: "2026-10-06T00:00:00.000Z" }],
  });
  const result = await refreshArboxLeadStatusCatalog({
    admin: admin as never,
    businessId: 3646,
    apiKey: "key",
    boxId: "box",
    now,
    fetchLeads: async () => ({
      ok: true,
      pagesFetched: 1,
      rows: [
        { user_id: "1", lead_status: "ללא מענה 1" },
        { user_id: "2", lead_status: "" },
        { user_id: "3", lead_status: null },
        { user_id: "4", lead_status: "  " },
        { user_id: "5", lead_status: "ללא מענה 1" },
      ],
    }),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.statuses.map((row) => row.status),
      ["ללא מענה 1"]
    );
  }
  assert.deepEqual(admin.writes, ["arbox_lead_known_statuses:upsert"]);
  assert.equal(admin.tables.arbox_lead_status_snapshot.length, 1);
  assert.equal(admin.tables.arbox_lead_status_snapshot[0].status, "בטיפול");
  assert.equal(admin.tables.businesses[0].arbox_lead_status_last_scanned_at, "2026-10-06T00:00:00.000Z");
  assert.equal(admin.tables.arbox_lead_status_change_sync_log.length, 0);
  assert.equal(admin.tables.arbox_lead_known_statuses.length, 1);
  assert.equal(distinctNonEmptyLeadStatuses([{ lead_status: "" }, { lead_status: "  " }]).length, 0);
}

{
  const admin = memoryAdmin({
    arbox_lead_known_statuses: [],
    arbox_lead_status_snapshot: [{ business_id: 3646, lead_id: "keep", status: "בטיפול" }],
    businesses: [{ id: 3646, arbox_lead_status_last_scanned_at: "2026-10-06T00:00:00.000Z" }],
  });
  const failed = await refreshArboxLeadStatusCatalog({
    admin: admin as never,
    businessId: 3646,
    apiKey: "key",
    boxId: "box",
    now,
    fetchLeads: async () => ({ ok: false, error: "page_failed", pagesFetched: 2 }),
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error, "page_failed");
  assert.deepEqual(admin.writes, []);
  assert.equal(admin.tables.arbox_lead_known_statuses.length, 0);
  assert.equal(admin.tables.arbox_lead_status_snapshot[0].status, "בטיפול");
  assert.equal(admin.tables.businesses[0].arbox_lead_status_last_scanned_at, "2026-10-06T00:00:00.000Z");
}

{
  let fetches = 0;
  const admin = memoryAdmin({
    arbox_lead_known_statuses: [
      { business_id: 3646, status: "ללא מענה 1", last_seen_at: now.toISOString() },
    ],
    arbox_lead_status_snapshot: [],
    businesses: [],
  });
  const cached = await refreshArboxLeadStatusCatalog({
    admin: admin as never,
    businessId: 3646,
    apiKey: "key",
    boxId: "box",
    now: new Date(now.getTime() + 30_000),
    fetchLeads: async () => {
      fetches += 1;
      return { ok: true, pagesFetched: 1, rows: [] };
    },
  });
  assert.equal(cached.ok, true);
  if (cached.ok) {
    assert.equal(cached.throttled, true);
    assert.equal(cached.statuses[0]?.status, "ללא מענה 1");
  }
  assert.equal(fetches, 0);
  assert.deepEqual(admin.writes, []);
}

{
  const fallback = leadStatusPickerAfterRefresh({
    ok: false,
    statuses: [{ status: "ללא מענה 1", last_seen_at: now.toISOString() }],
  });
  assert.equal(fallback.error, null);
  assert.equal(fallback.statuses[0]?.status, "ללא מענה 1");
  const empty = leadStatusPickerAfterRefresh({ ok: false, statuses: [] });
  assert.equal(empty.statuses.length, 0);
  assert.equal(typeof empty.error, "string");
  assert.equal(empty.error?.includes("—"), false);
}

{
  assert.equal(leadStatusRefreshArboxError({ crm_type: "plan_do", crm_api_key: "x", crm_box_id: "1" }), "arbox_not_connected");
  assert.equal(leadStatusRefreshArboxError({ crm_type: "arbox", crm_api_key: "", crm_box_id: "1" }), "arbox_not_connected");
  assert.equal(leadStatusRefreshArboxError({ crm_type: "arbox", crm_api_key: "key", crm_box_id: "" }), "arbox_not_connected");
  assert.equal(leadStatusRefreshArboxError({ crm_type: "arbox", crm_api_key: "key", crm_box_id: "9" }), null);
}

console.log("lead-status-picker.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
