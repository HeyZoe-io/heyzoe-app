import assert from "node:assert/strict";
import {
  ARBOX_DAILY_WORKER_ABORT_MS,
  arboxDailyWorkerUrl,
  dispatchArboxDailyWorkers,
  resolveArboxDailyWorkerOrigin,
} from "@/lib/leads/arbox-daily-triggers-dispatch";

const prev = process.env.NEXT_PUBLIC_SITE_URL;
process.env.NEXT_PUBLIC_SITE_URL = "https://heyzoe.io";
try {
  assert.equal(
    resolveArboxDailyWorkerOrigin({
      headers: { get: (name) => (name === "host" ? "localhost:3000" : null) },
    }),
    "http://localhost:3000"
  );
  assert.equal(
    resolveArboxDailyWorkerOrigin({
      headers: { get: (name) => (name === "host" ? "heyzoe.io" : null) },
    }),
    "https://heyzoe.io"
  );
} finally {
  if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = prev;
}

assert.equal(
  arboxDailyWorkerUrl("https://heyzoe.io", 3445, true),
  "https://heyzoe.io/api/cron/arbox-daily-triggers/business?business_id=3445&dry_run=1"
);
assert.equal(ARBOX_DAILY_WORKER_ABORT_MS, 285_000);

async function main() {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  AbortSignal.timeout = ((ms: number) => {
    assert.equal(ms, ARBOX_DAILY_WORKER_ABORT_MS);
    return originalTimeout(40);
  }) as typeof AbortSignal.timeout;

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const id = new URL(String(url)).searchParams.get("business_id");
    if (id === "999999") {
      return new Response(JSON.stringify({ error: "unknown_arbox_business" }), { status: 400 });
    }
    if (id === "777") {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          const reason = signal?.reason;
          const err = reason instanceof Error ? reason : new Error("The operation was aborted due to timeout");
          if (err.name === "Error") err.name = "TimeoutError";
          reject(err);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    return new Response(JSON.stringify({ ok: true, business_id: Number(id) }), { status: 200 });
  }) as typeof fetch;

  try {
    const dispatched = await dispatchArboxDailyWorkers({
      origin: "http://localhost:3000",
      businessIds: [3251, 999999, 777, 3445],
      dryRun: true,
      authorization: "Bearer test",
    });
    assert.equal(dispatched.businesses.length, 4);
    assert.equal(dispatched.businesses[0]?.ok, true);
    assert.equal(dispatched.businesses[0]?.outcome, "ok");
    assert.equal(dispatched.businesses[0]?.http, 200);
    assert.equal(dispatched.businesses[1]?.ok, false);
    assert.equal(dispatched.businesses[1]?.outcome, "failed");
    assert.equal(dispatched.businesses[1]?.http, 400);
    assert.equal(dispatched.businesses[1]?.business_id, 999999);
    assert.equal(dispatched.businesses[2]?.ok, false);
    assert.equal(dispatched.businesses[2]?.outcome, "timeout_unknown_outcome");
    assert.equal(dispatched.businesses[2]?.http, 0);
    assert.equal(dispatched.businesses[2]?.business_id, 777);
    assert.ok((dispatched.businesses[2]?.elapsed_ms ?? 0) < 285_000);
    assert.equal(dispatched.businesses[3]?.ok, true);
    assert.equal(dispatched.businesses[3]?.outcome, "ok");
    assert.ok(dispatched.total_ms >= 0);
    assert.ok(dispatched.total_ms < 5_000);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
}

main()
  .then(() => console.log("arbox-daily-triggers-dispatch.test ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
