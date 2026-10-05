import assert from "node:assert/strict";
import {
  ARBOX_TRIAL_SYNC_WORKER_ABORT_MS,
  arboxTrialSyncWorkerUrl,
  dispatchArboxTrialSyncWorkers,
  resolveArboxTrialSyncWorkerOrigin,
} from "@/lib/leads/arbox-trial-sync-dispatch";
import { trialSyncBusinessNeedsWorker } from "@/lib/leads/arbox-trial-sync-run";

assert.equal(
  trialSyncBusinessNeedsWorker({
    slug: "other",
    trialMembershipTypeIds: [],
    enabledTriggerTypes: [],
  }),
  false
);
assert.equal(
  trialSyncBusinessNeedsWorker({
    slug: "other",
    trialMembershipTypeIds: [],
    enabledTriggerTypes: ["purchase"],
  }),
  true
);
assert.equal(
  trialSyncBusinessNeedsWorker({
    slug: "tights",
    trialMembershipTypeIds: [],
    enabledTriggerTypes: [],
  }),
  true
);
assert.equal(
  trialSyncBusinessNeedsWorker({
    slug: "acrobyjoe",
    trialMembershipTypeIds: [12],
    enabledTriggerTypes: [],
  }),
  true
);

const prev = process.env.NEXT_PUBLIC_SITE_URL;
process.env.NEXT_PUBLIC_SITE_URL = "https://heyzoe.io";
try {
  assert.equal(
    resolveArboxTrialSyncWorkerOrigin({
      headers: { get: (name) => (name === "host" ? "localhost:3000" : null) },
    }),
    "http://localhost:3000"
  );
  assert.equal(
    arboxTrialSyncWorkerUrl("https://heyzoe.io", 4, false),
    "https://heyzoe.io/api/cron/arbox-trial-sync/business?business_id=4"
  );
} finally {
  if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = prev;
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const id = new URL(String(url)).searchParams.get("business_id");
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (id === "2") throw new Error("worker exploded");
    if (id === "3") {
      return new Response(JSON.stringify({ error: "unknown_arbox_business" }), { status: 400 });
    }
    return new Response(JSON.stringify({ ok: true, business_id: Number(id) }), { status: 200 });
  }) as typeof fetch;

  try {
    const started = Date.now();
    const dispatched = await dispatchArboxTrialSyncWorkers({
      origin: "http://localhost:3000",
      businessIds: [1, 2, 3],
      dryRun: false,
      authorization: "Bearer test",
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3_000, `dispatcher waited ${elapsed}ms`);
    assert.ok(elapsed < 450, `workers ran sequentially (${elapsed}ms)`);
    assert.equal(dispatched.businesses.length, 3);
    assert.equal(dispatched.businesses[0]?.outcome, "ok");
    assert.equal(dispatched.businesses[1]?.outcome, "failed");
    assert.match(dispatched.businesses[1]?.error ?? "", /exploded/);
    assert.equal(dispatched.businesses[2]?.outcome, "failed");
    assert.equal(dispatched.businesses[2]?.http, 400);
    assert.equal(ARBOX_TRIAL_SYNC_WORKER_ABORT_MS, 285_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main()
  .then(() => console.log("arbox-trial-sync-dispatch.test ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
