import assert from "node:assert/strict";
import { runWithArboxCallCount, setArboxCallCounterSlug } from "@/lib/crm/arbox-call-counter";
import { normalizeArboxPath, noteArboxCall } from "@/lib/crm/arbox-call-counter-bridge";
import { resolveStoredCrmApiKey } from "@/lib/crm/crm-api-key-mask";

const stored = "secret-key-9876";

assert.equal(resolveStoredCrmApiKey(undefined, stored), stored);
assert.equal(resolveStoredCrmApiKey("", stored), stored);
assert.equal(resolveStoredCrmApiKey("••••9876", stored), stored);
assert.equal(resolveStoredCrmApiKey("****9876", stored), stored);
assert.equal(resolveStoredCrmApiKey("  ", stored), stored);
assert.equal(resolveStoredCrmApiKey("brand-new-key", stored), "brand-new-key");
assert.equal(resolveStoredCrmApiKey(undefined, ""), null);

assert.equal(
  normalizeArboxPath("/v3/users/searchUser?type=phone&value=0501234567"),
  "/v3/users/searchUser"
);
assert.equal(normalizeArboxPath("/v3/users/12345"), "/v3/users/{id}");
assert.equal(
  normalizeArboxPath("https://arboxserver.arboxapp.com/api/public/v3/reports/salesReport?page=2&fromDate=2026-10-01"),
  "/v3/reports/salesReport"
);

async function main() {
const lines: string[] = [];
const original = console.info;
console.info = ((msg?: unknown) => {
  lines.push(String(msg));
}) as typeof console.info;

await Promise.all([
  runWithArboxCallCount({ cron: "conversation", slug: "pending", emitIfEmpty: false }, async () => {
    setArboxCallCounterSlug("apex");
    noteArboxCall("/v3/users/searchUser?type=phone&value=0500000000");
    noteArboxCall("/v3/reports/salesReport?page=1");
    await new Promise((resolve) => setTimeout(resolve, 15));
    noteArboxCall("/v3/reports/salesReport?page=2");
  }),
  runWithArboxCallCount({ cron: "arbox-trial-sync", slug: "tights", emitIfEmpty: true }, async () => {
    noteArboxCall("/v3/locations");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }),
]);

await runWithArboxCallCount({ cron: "arbox-trial-sync", slug: "omers-place", emitIfEmpty: true }, async () => {
  // Night hold: no Arbox calls. Still one summary line.
});

console.info = original;

assert.equal(lines.length, 3);
const parsed = lines.map((line) => JSON.parse(line) as { tag: string; cron: string; slug: string; total: number; by_endpoint: Record<string, number>; pages: Record<string, number> });
const apex = parsed.find((row) => row.slug === "apex");
const tights = parsed.find((row) => row.slug === "tights");
const omers = parsed.find((row) => row.slug === "omers-place");
assert.ok(apex && tights && omers);
assert.equal(apex.tag, "arbox_calls");
assert.equal(apex.cron, "conversation");
assert.equal(apex.total, 3);
assert.equal(apex.by_endpoint["/v3/users/searchUser"], 1);
assert.equal(apex.by_endpoint["/v3/reports/salesReport"], 2);
assert.equal(apex.pages["/v3/reports/salesReport"], 2);
assert.equal(apex.pages["/v3/users/searchUser"], undefined);
assert.equal(tights.total, 1);
assert.equal(tights.by_endpoint["/v3/locations"], 1);
assert.deepEqual(tights.pages, {});
assert.equal(omers.total, 0);
assert.equal(JSON.stringify(apex).includes("0500000000"), false);
assert.equal(JSON.stringify(apex).includes("api-key"), false);
}

main();
