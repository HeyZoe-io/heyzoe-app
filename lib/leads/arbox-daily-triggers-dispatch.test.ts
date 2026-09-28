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
assert.equal(ARBOX_DAILY_WORKER_ABORT_MS, 310_000);

async function main() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const id = new URL(String(url)).searchParams.get("business_id");
    if (id === "999999") {
      return new Response(JSON.stringify({ error: "unknown_arbox_business" }), { status: 400 });
    }
    return new Response(JSON.stringify({ ok: true, business_id: Number(id) }), { status: 200 });
  }) as typeof fetch;

  try {
    const dispatched = await dispatchArboxDailyWorkers({
      origin: "http://localhost:3000",
      businessIds: [3251, 999999, 3445],
      dryRun: true,
      authorization: "Bearer test",
    });
    assert.equal(dispatched.businesses.length, 3);
    assert.equal(dispatched.businesses[0]?.ok, true);
    assert.equal(dispatched.businesses[0]?.http, 200);
    assert.equal(dispatched.businesses[1]?.ok, false);
    assert.equal(dispatched.businesses[1]?.http, 400);
    assert.equal(dispatched.businesses[1]?.business_id, 999999);
    assert.equal(dispatched.businesses[2]?.ok, true);
    assert.ok(dispatched.total_ms >= 0);
  } finally {
    globalThis.fetch = original;
  }
}

main()
  .then(() => console.log("arbox-daily-triggers-dispatch.test ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
