import assert from "node:assert/strict";
import {
  alertBusinessBlockingErrors,
  blockingAlertModel,
  isBusinessBlockingError,
  renderBlockingAlertText,
  resetBlockingAlertThrottle,
  shouldAlertForSendFailure,
} from "./wa-blocking-error-alert";
import { MARKETING_WA_PHONE_NUMBER_ID } from "./marketing-whatsapp";

type SendInput = { to: string; templateName: string; bodyParams: string[] };

/** Emulates claim_wa_blocking_error_alert: a row per (business, code) with last_alert_at. */
function fakeAdmin(opts: { rpcMissing?: boolean; templateApproved?: boolean; priorMessage?: boolean } = {}) {
  const claims = new Map<string, number>();
  const rpcCalls: string[] = [];
  let clock = 0;
  const admin = {
    setClock(ms: number) {
      clock = ms;
    },
    async rpc(name: string, args: Record<string, number>) {
      rpcCalls.push(name);
      if (opts.rpcMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      const key = `${args.p_business_id}:${args.p_error_code}`;
      const windowMs = args.p_window_minutes * 60_000;
      if (name === "release_wa_blocking_error_alert") {
        claims.set(key, clock - windowMs + 10 * 60_000);
        return { data: null, error: null };
      }
      const last = claims.get(key);
      if (last != null && clock - last < windowMs) return { data: false, error: null };
      claims.set(key, clock);
      return { data: true, error: null };
    },
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: { name: "סטודיו TIGHTS", slug: "tights" }, error: null }),
        then: (resolve: (r: unknown) => void) => {
          if (table === "marketing_whatsapp_templates") {
            resolve({ data: opts.templateApproved ? [{ status: "APPROVED", disabled: false }] : [], error: null });
          } else if (table === "messages") {
            resolve({ data: opts.priorMessage ? [{ created_at: "x" }] : [], error: null });
          } else resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
  return { admin, rpcCalls };
}

assert.equal(isBusinessBlockingError(131042), true);
assert.equal(isBusinessBlockingError(131031), true);
assert.equal(isBusinessBlockingError(132015), true);
assert.equal(isBusinessBlockingError(132016), true);
assert.equal(isBusinessBlockingError(133010), true);
assert.equal(isBusinessBlockingError(131026), false);
assert.equal(isBusinessBlockingError(131049), false);
assert.equal(isBusinessBlockingError(null), false);

const rendered = renderBlockingAlertText({ businessName: "סטודיו TIGHTS", errorCode: 131042 });
assert.match(rendered.text, /סטודיו TIGHTS/);
assert.match(rendered.text, /תשלום/);
assert.match(rendered.text, /מה לעשות:/);
assert.match(rendered.text, /131042/);

assert.equal(shouldAlertForSendFailure(MARKETING_WA_PHONE_NUMBER_ID, 5, 131042), false);
assert.equal(shouldAlertForSendFailure("123", null, 131042), false);
assert.equal(shouldAlertForSendFailure("123", 5, 131042), true);
assert.equal(shouldAlertForSendFailure("123", 5, 131026), false);

async function main() {
  const H = 60 * 60_000;

  // Batch dedup + once per 6h + other code is separate
  {
    resetBlockingAlertThrottle();
    const { admin } = fakeAdmin();
    const sends: SendInput[] = [];
    const logs: string[] = [];
    const send = async (i: SendInput) => (sends.push(i), { ok: true });
    const log = async (i: { model_used?: string | null }) => void logs.push(String(i.model_used));
    const ev = { businessId: 3543, errorCode: 131042, source: "status_webhook" as const };
    admin.setClock(0);
    const first = await alertBusinessBlockingErrors([ev, ev, ev, { ...ev, businessId: 0 }, { ...ev, errorCode: 131026 }], {
      admin: admin as never,
      now: new Date(0),
      send: send as never,
      log: log as never,
    });
    assert.deepEqual(first.map((o) => o.outcome), ["sent"]);
    assert.equal(sends.length, 1);
    assert.equal(sends[0]!.to, "972508318162");
    assert.equal(sends[0]!.templateName, "zoe_admin_daily_unsent");
    assert.equal(sends[0]!.bodyParams.length, 2);
    assert.match(sends[0]!.bodyParams[1]!, /התראה מיידית/);
    assert.match(sends[0]!.bodyParams[1]!, /סטודיו TIGHTS/);
    assert.deepEqual(logs, [blockingAlertModel(3543, 131042)]);

    // 5h later, a new instance (memory throttle reset): DB claim still holds
    resetBlockingAlertThrottle();
    admin.setClock(5 * H);
    const again = await alertBusinessBlockingErrors([ev], { admin: admin as never, now: new Date(5 * H), send: send as never, log: log as never });
    assert.deepEqual(again.map((o) => o.outcome), ["throttled"]);
    assert.equal(sends.length, 1);

    // Another code for the same business alerts on its own
    const other = await alertBusinessBlockingErrors([{ ...ev, errorCode: 132015, detail: "trial_reminder" }], {
      admin: admin as never,
      now: new Date(5 * H),
      send: send as never,
      log: log as never,
    });
    assert.deepEqual(other.map((o) => o.outcome), ["sent"]);
    assert.match(sends[1]!.bodyParams[1]!, /trial_reminder/);

    // After 6h → alerts again
    resetBlockingAlertThrottle();
    admin.setClock(6 * H + 1);
    const later = await alertBusinessBlockingErrors([ev], { admin: admin as never, now: new Date(6 * H + 1), send: send as never, log: log as never });
    assert.deepEqual(later.map((o) => o.outcome), ["sent"]);
  }

  // Dedicated template once approved: 3 params
  {
    resetBlockingAlertThrottle();
    const { admin } = fakeAdmin({ templateApproved: true });
    const sends: SendInput[] = [];
    admin.setClock(0);
    await alertBusinessBlockingErrors([{ businessId: 1, errorCode: 131031, source: "send_api" }], {
      admin: admin as never,
      now: new Date(0),
      send: (async (i: SendInput) => (sends.push(i), { ok: true })) as never,
      log: (async () => undefined) as never,
    });
    assert.equal(sends[0]!.templateName, "zoe_admin_blocking_error");
    assert.equal(sends[0]!.bodyParams.length, 3);
  }

  // Send failure releases the claim for a retry in 10 minutes, not 6h
  {
    resetBlockingAlertThrottle();
    const { admin, rpcCalls } = fakeAdmin();
    admin.setClock(0);
    const failed = await alertBusinessBlockingErrors([{ businessId: 2, errorCode: 368, source: "status_webhook" }], {
      admin: admin as never,
      now: new Date(0),
      send: (async () => ({ ok: false, error: "x" })) as never,
      log: (async () => undefined) as never,
    });
    assert.equal(failed[0]!.outcome, "send_failed");
    assert.ok(rpcCalls.includes("release_wa_blocking_error_alert"));
    admin.setClock(11 * 60_000);
    const retry = await alertBusinessBlockingErrors([{ businessId: 2, errorCode: 368, source: "status_webhook" }], {
      admin: admin as never,
      now: new Date(11 * 60_000),
      send: (async () => ({ ok: true })) as never,
      log: (async () => undefined) as never,
    });
    assert.equal(retry[0]!.outcome, "sent");
  }

  // Before the SQL runs: messages lookup decides
  {
    resetBlockingAlertThrottle();
    const prior = fakeAdmin({ rpcMissing: true, priorMessage: true });
    const r1 = await alertBusinessBlockingErrors([{ businessId: 9, errorCode: 131042, source: "status_webhook" }], {
      admin: prior.admin as never,
      send: (async () => ({ ok: true })) as never,
      log: (async () => undefined) as never,
    });
    assert.equal(r1[0]!.outcome, "throttled");
    resetBlockingAlertThrottle();
    const fresh = fakeAdmin({ rpcMissing: true });
    const sends: unknown[] = [];
    const send = (async (i: unknown) => (sends.push(i), { ok: true })) as never;
    const r2 = await alertBusinessBlockingErrors([{ businessId: 9, errorCode: 131042, source: "status_webhook" }], {
      admin: fresh.admin as never,
      send,
      log: (async () => undefined) as never,
    });
    assert.equal(r2[0]!.outcome, "sent");
    // Same instance, second burst: in-memory throttle
    const r3 = await alertBusinessBlockingErrors([{ businessId: 9, errorCode: 131042, source: "status_webhook" }], {
      admin: fresh.admin as never,
      send,
      log: (async () => undefined) as never,
    });
    assert.equal(r3[0]!.outcome, "throttled");
    assert.equal(sends.length, 1);
  }

  console.log("wa-blocking-error-alert tests passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
