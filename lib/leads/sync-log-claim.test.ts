import assert from "node:assert/strict";
import { claimSyncLogBeforeSend } from "./sync-log-claim";

type Row = Record<string, unknown>;

function fakeAdmin(rows: Row[], opts?: { rejectFailed?: boolean }) {
  return {
    from() {
      return {
        insert(row: Row) {
          const key = `${row.business_id}|${row.user_id}`;
          if (rows.some((existing) => `${existing.business_id}|${existing.user_id}` === key)) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
          }
          if (opts?.rejectFailed && row.status === "sending") {
            return Promise.resolve({ error: { code: "23514", message: "check constraint" } });
          }
          rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
        update(patch: Row) {
          const filters: Array<[string, unknown]> = [];
          let allowed: string[] = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return query;
            },
            in(column: string, values: string[]) {
              allowed = values;
              const matched = rows.filter(
                (row) =>
                  filters.every(([key, value]) => row[key] === value) &&
                  allowed.includes(String(row[column] ?? ""))
              );
              if (opts?.rejectFailed && patch.status === "failed") {
                return {
                  select() {
                    return Promise.resolve({
                      data: null,
                      error: { code: "23514", message: "check constraint" },
                    });
                  },
                };
              }
              for (const row of matched) Object.assign(row, patch);
              return {
                select() {
                  return Promise.resolve({ data: matched.map((row) => ({ status: row.status })), error: null });
                },
              };
            },
            select() {
              return Promise.resolve({ data: [], error: null });
            },
          };
          return query;
        },
      };
    },
  };
}

const filters: Array<[string, string | number]> = [
  ["business_id", 1],
  ["user_id", 9],
];
const base = { business_id: 1, user_id: 9, trigger_id: "t", processed_at: "2026-10-08T06:00:00.000Z", attempts: 0 };

async function main() {
  const sentRows: Row[] = [];
  const won = await claimSyncLogBeforeSend({
    admin: fakeAdmin(sentRows) as never,
    table: "arbox_days_in_club_sync_log",
    row: base,
    filters,
  });
  assert.equal(won, "won");
  assert.equal(sentRows[0]?.status, "sending");
  sentRows[0]!.status = "sent";
  sentRows[0]!.reason = null;
  const again = await claimSyncLogBeforeSend({
    admin: fakeAdmin(sentRows) as never,
    table: "arbox_days_in_club_sync_log",
    row: base,
    filters,
  });
  assert.equal(again, "lost");

  const dead: Row[] = [];
  const first = await claimSyncLogBeforeSend({
    admin: fakeAdmin(dead) as never,
    table: "arbox_days_in_club_sync_log",
    row: base,
    filters,
  });
  assert.equal(first, "won");
  const second = await claimSyncLogBeforeSend({
    admin: fakeAdmin(dead) as never,
    table: "arbox_days_in_club_sync_log",
    row: base,
    filters,
  });
  assert.equal(second, "lost");
  assert.equal(dead[0]?.status, "sending");

  const meta: Row[] = [{ ...base, status: "sending", reason: "sending" }];
  const retry = await claimSyncLogBeforeSend({
    admin: fakeAdmin(meta) as never,
    table: "arbox_days_in_club_sync_log",
    row: { ...base, status: "failed" },
    filters,
  });
  meta[0]!.status = "failed";
  const reclaimed = await claimSyncLogBeforeSend({
    admin: fakeAdmin(meta) as never,
    table: "arbox_days_in_club_sync_log",
    row: base,
    filters,
  });
  assert.equal(retry, "lost");
  assert.equal(reclaimed, "won");
  assert.equal(meta[0]?.status, "sending");

  console.log("sync-log-claim.test.ts ok");
}

main();
