import assert from "node:assert/strict";
import { claimPhoneKey, claimTemplateSend, releaseTemplateSendClaim } from "./template-send-claim";
import { excludeQueuedRecipients, foldQueuedRows } from "../manual-bulk/queued-exclusion";

type Row = { claimed_at: number; claim_token: string };

/** Emulates claim_template_send with a real single-winner check on a shared map. */
function fakeAdmin(opts: { rpcMissing?: boolean; revokeAt?: string | null } = {}) {
  const claims = new Map<string, Row>();
  let clock = Date.parse("2026-10-08T09:00:00Z");
  const deletes: string[] = [];
  const admin = {
    claims,
    deletes,
    tick(ms: number) {
      clock += ms;
    },
    async rpc(_name: string, a: Record<string, unknown>) {
      if (opts.rpcMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      const key = `${a.p_business_id}|${a.p_phone}|${a.p_template_name}`;
      const row = claims.get(key);
      const windowMs = Number(a.p_window_seconds) * 1000;
      const reclaim = a.p_reclaim_before ? Date.parse(String(a.p_reclaim_before)) : null;
      if (!row || row.claimed_at < clock - windowMs || (reclaim != null && row.claimed_at < reclaim)) {
        claims.set(key, { claimed_at: clock, claim_token: String(a.p_token) });
        return { data: true, error: null };
      }
      return { data: false, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op = "select";
      const q = {
        select: () => q,
        delete: () => ((op = "delete"), q),
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        gte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: { slug: "tights" }, error: null }),
        then: (resolve: (r: unknown) => void) => {
          if (op === "delete") {
            const key = `${filters.business_id}|${filters.phone}|${filters.template_name}`;
            if (claims.get(key)?.claim_token === filters.claim_token) {
              claims.delete(key);
              deletes.push(key);
            }
            return resolve({ data: null, error: null });
          }
          if (table === "messages" && filters.content === "[revoke]") {
            return resolve({ data: opts.revokeAt ? [{ created_at: opts.revokeAt }] : [], error: null });
          }
          if (table === "messages") return resolve({ data: [], error: null });
          resolve({ data: null, error: null });
        },
      };
      return q;
    },
  };
  return admin;
}

const base = { businessId: 3543, phoneNumberId: "111", templateName: "trial_reminder", params: ["דנה"] };

assert.equal(claimPhoneKey("+972-50-123-4567"), "501234567");
assert.equal(claimPhoneKey("0501234567"), "501234567");

async function main() {
  // Two concurrent sends, different params, different phone formats: exactly one wins.
  {
    const admin = fakeAdmin();
    const [a, b] = await Promise.all([
      claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567", params: ["דנה", "17:00"] }),
      claimTemplateSend({ ...base, admin: admin as never, phone: "0501234567", params: ["דנה", "18:00"] }),
    ]);
    assert.deepEqual([a.kind, b.kind].sort(), ["claimed", "duplicate"]);
    // Another template for the same phone is independent
    const other = await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567", templateName: "x" });
    assert.equal(other.kind, "claimed");
    // After 20h → claimable again
    admin.tick(20 * 3600_000 + 1000);
    const later = await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567" });
    assert.equal(later.kind, "claimed");
  }

  // Explicit failure releases only our own claim
  {
    const admin = fakeAdmin();
    const first = await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567" });
    assert.equal(first.kind, "claimed");
    await releaseTemplateSendClaim(admin as never, first);
    assert.equal(admin.deletes.length, 1);
    const retry = await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567" });
    assert.equal(retry.kind, "claimed");
    await releaseTemplateSendClaim(admin as never, first);
    assert.equal(admin.deletes.length, 1, "stale token must not delete the newer claim");
  }

  // Revoke after the claim → re-claim allowed
  {
    const admin = fakeAdmin({ revokeAt: "2026-10-08T10:00:00Z" });
    await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567" });
    admin.tick(2 * 3600_000);
    const again = await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567" });
    assert.equal(again.kind, "claimed");
  }
  {
    const admin = fakeAdmin({ revokeAt: null });
    await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567" });
    const again = await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567" });
    assert.equal(again.kind, "duplicate");
  }

  // SQL not run yet: falls back to the messages lookup (no rows → send goes on)
  {
    const admin = fakeAdmin({ rpcMissing: true });
    const r = await claimTemplateSend({ ...base, admin: admin as never, phone: "972501234567" });
    assert.equal(r.kind, "unclaimed");
  }

  // Bulk cross-job exclusion
  {
    const q = foldQueuedRows([
      { job_id: "j1", recipient_key: "talked:c1", contact_phone: "972501111111", status: "pending", due_at: "2026-10-08T10:00:00Z" },
      { job_id: "j1", recipient_key: "talked:c2", contact_phone: "972502222222", status: "pending", due_at: "2026-10-08T09:00:00Z" },
      { job_id: "j0", recipient_key: "membership:7", contact_phone: "972503333333", status: "sent", due_at: null },
    ]);
    assert.deepEqual(q.pendingJobs, [{ job_id: "j1", pending: 2, first_due_at: "2026-10-08T09:00:00Z" }]);
    type R = { recipientKey: string; phone: string | null };
    const audience: { withPhone: R[]; withoutPhone: R[] } = {
      withPhone: [
        { recipientKey: "talked:c1", phone: "972501111111" },
        { recipientKey: "membership:99", phone: "0502222222" },
        { recipientKey: "talked:c9", phone: "972509999999" },
      ],
      withoutPhone: [{ recipientKey: "membership:7", phone: null }],
    };
    const removed = excludeQueuedRecipients(audience, q);
    assert.equal(removed, 3);
    assert.deepEqual(audience.withPhone.map((r) => r.recipientKey), ["talked:c9"]);
    assert.equal(audience.withoutPhone.length, 0);
  }

  console.log("template-send-claim tests passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
