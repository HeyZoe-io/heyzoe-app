import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countNotifiedSends,
  cronTimeOverrideDecision,
  isCronJobOrgUserAgent,
  rejectCronTimeOverride,
  resolveCronNow,
} from "@/lib/cron-clock";

{
  const params = new URLSearchParams("now=2026-10-08T06:00:00.000Z");
  assert.deepEqual(cronTimeOverrideDecision(params), {
    action: "reject",
    error: "time_override_requires_dry_run",
  });
}

{
  for (const key of ["date", "today", "at", "as_of", "asof"]) {
    const params = new URLSearchParams(`${key}=2026-10-08`);
    assert.equal(cronTimeOverrideDecision(params).action, "reject", key);
  }
}

{
  const params = new URLSearchParams("dry_run=1&now=2026-10-08T06:00:00.000Z");
  const decision = cronTimeOverrideDecision(params);
  assert.equal(decision.action, "use");
  if (decision.action === "use") {
    assert.equal(decision.now.toISOString(), "2026-10-08T06:00:00.000Z");
  }
}

{
  const params = new URLSearchParams("dry_run=1&date=2026-10-08");
  const decision = cronTimeOverrideDecision(params);
  assert.equal(decision.action, "use");
  if (decision.action === "use") assert.equal(decision.now.toISOString(), "2026-10-08T06:00:00.000Z");
}

{
  const params = new URLSearchParams("dry_run=1&now=not-a-date");
  assert.deepEqual(cronTimeOverrideDecision(params), {
    action: "reject",
    error: "invalid_time_override",
  });
}

{
  assert.deepEqual(cronTimeOverrideDecision(new URLSearchParams("slot=evening")), { action: "none" });
  assert.deepEqual(cronTimeOverrideDecision(new URLSearchParams("dry_run=1&slot=morning")), {
    action: "none",
  });
}

{
  const real = new Date("2026-10-07T15:20:00.000Z");
  const thursday = new Date("2026-10-08T06:00:00.000Z");
  assert.deepEqual(resolveCronNow(thursday, false, real), {
    ok: false,
    error: "time_override_requires_dry_run",
  });
  const preview = resolveCronNow(thursday, true, real);
  assert.equal(preview.ok, true);
  if (preview.ok) assert.equal(preview.now.toISOString(), thursday.toISOString());
  const live = resolveCronNow(undefined, false, real);
  assert.equal(live.ok && live.now.toISOString(), real.toISOString());
}

assert.equal(isCronJobOrgUserAgent("cron-job.org (https://cron-job.org)"), true);
assert.equal(isCronJobOrgUserAgent("node"), false);
assert.equal(isCronJobOrgUserAgent(""), false);

assert.equal(
  countNotifiedSends({
    trial_reminder: { notified: 2 },
    post_trial_followup: { notified: 1 },
    slug: "or-ia",
  }),
  3
);

function cronRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cronRouteFiles(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

{
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "app", "api", "cron");
  const files = cronRouteFiles(root);
  assert.ok(files.length >= 16, `expected every cron route, got ${files.length}`);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const guard = text.indexOf("rejectCronTimeOverride(req");
    assert.ok(guard > 0, file);
    const handler = text.indexOf("export async function GET");
    const db = text.indexOf("createSupabaseAdminClient(", handler);
    if (db > handler) assert.ok(guard < db, `${file} guard must run before any admin client`);
  }
}

{
  const res = rejectCronTimeOverride({
    nextUrl: { searchParams: new URLSearchParams("now=2026-10-08T06:00:00.000Z") },
  } as never);
  assert.equal(res?.status, 400);
  const preview = rejectCronTimeOverride(
    { nextUrl: { searchParams: new URLSearchParams("dry_run=1&now=2026-10-08T06:00:00.000Z") } } as never,
    true
  );
  assert.equal(preview, null);
  const unsupported = rejectCronTimeOverride({
    nextUrl: { searchParams: new URLSearchParams("dry_run=1&now=2026-10-08T06:00:00.000Z") },
  } as never);
  assert.equal(unsupported?.status, 400);
  const allowed = rejectCronTimeOverride({
    nextUrl: { searchParams: new URLSearchParams("dry_run=1&slot=evening") },
  } as never);
  assert.equal(allowed, null);
}

console.log("cron-clock.test.ts: ok");
