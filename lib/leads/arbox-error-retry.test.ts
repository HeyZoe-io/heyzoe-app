import assert from "node:assert/strict";
import { ARBOX_ERROR_REASON, retryArboxOnce, writeArboxErrorRows } from "./arbox-error-retry";
import { unsentReason } from "../admin-daily-unsent-summary";

type Row = Record<string, unknown>;

function fakeAdmin(existing: Row[] = []) {
  const rows = [...existing];
  const calls: Array<{ payload: Row; options: Row }> = [];
  const admin = {
    from() {
      return {
        upsert(payload: Row, options: Row) {
          calls.push({ payload, options });
          const keys = String(options.onConflict).split(",");
          const hit = rows.find((r) => keys.every((k) => r[k] === payload[k]));
          if (!hit) rows.push({ ...payload });
          else if (!options.ignoreDuplicates) Object.assign(hit, payload);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { admin: admin as never, rows, calls };
}

async function main() {
  {
    let calls = 0;
    const out = await retryArboxOnce("t", async () => ({ ok: true, n: ++calls }));
    assert.equal(out.n, 1, "a good first read is not repeated");
  }
  {
    let calls = 0;
    const out = await retryArboxOnce("t", async () => {
      calls += 1;
      return { ok: calls > 1 };
    });
    assert.equal(calls, 2, "one retry after a failed read");
    assert.equal(out.ok, true);
  }
  {
    let calls = 0;
    const out = await retryArboxOnce("t", async () => ({ ok: false, n: ++calls }));
    assert.equal(calls, 2, "no third Arbox call in the same run");
    assert.equal(out.ok, false);
  }

  {
    const sent = { business_id: 1, trigger_id: "r1", user_id: 7, class_date: "2026-10-07", status: "sent" };
    const { admin, rows, calls } = fakeAdmin([sent]);
    const failed = await writeArboxErrorRows({
      admin,
      table: "arbox_post_trial_followup_sync_log",
      onConflict: "business_id,trigger_id,user_id,class_date",
      rows: [
        { business_id: 1, trigger_id: "r1", user_id: 7, class_date: "2026-10-07" },
        { business_id: 1, trigger_id: "r2", user_id: 7, class_date: "2026-10-07" },
      ],
    });
    assert.equal(failed, 0);
    assert.equal(calls.every((c) => c.options.ignoreDuplicates === true), true);
    assert.equal(rows[0].status, "sent", "an existing sent row is not reopened");
    assert.equal(rows[1].status, "pending");
    assert.equal(rows[1].reason, ARBOX_ERROR_REASON);
  }

  assert.equal(unsentReason({ status: "pending", lastError: ARBOX_ERROR_REASON, overdue: false }), "שגיאת ארבוקס");
  assert.equal(unsentReason({ status: "pending", lastError: null, overdue: false }), null);
  assert.equal(unsentReason({ status: "sent", lastError: ARBOX_ERROR_REASON, overdue: true }), null);

  console.log("arbox-error-retry.test: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
