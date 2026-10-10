import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { keepServerWork } from "@/lib/keep-server-work";

async function main(): Promise<void> {
const scheduled: Array<() => Promise<void>> = [];
let ran = false;
keepServerWork(
  "unit",
  Promise.resolve().then(() => {
    ran = true;
  }),
  (task) => {
    scheduled.push(task);
  }
);
assert.equal(scheduled.length, 1);
await scheduled[0]!();
assert.equal(ran, true);

keepServerWork(
  "unit-fail",
  Promise.reject(new Error("boom")),
  (task) => {
    void task();
  }
);
await new Promise((resolve) => setTimeout(resolve, 20));

const roots = ["app/api", "lib"];
const forbidden = [
  /void\s+triggerLeadRegisteredNotification\s*\(/,
  /void\s+triggerHumanRequestedNotification\s*\(/,
  /void\s+dispatchCrmEvent\s*\(/,
  /void\s+sendMetaCapiEvent\s*\(/,
  /void\s+notifyAdminMarketingLeadOnPaid\s*\(/,
  /void\s+applyMarketingHumanAgentSideEffects\s*\(/,
  /void\s+markRegistrationCtaClicked\s*\(/,
  /void\s+syncContactToMetaAudience\s*\(/,
  /void\s+tryLogLpLandingTurn\s*\(/,
  /void\s+trackWaNewLead\s*\(/,
  /void\s+registerMetaNumberAndEmailAdmin\s*\(/,
  /void\s+tryRecordWaMarketingPurchase\s*\(/,
  /void\s+recordLpPurchaseIfNoMarketingMatch\s*\(/,
  /void\s+logMessage\s*\(/,
  /void\s+sendKnowledgeUpdateTemplate\s*\(/,
  /void\s+sendKnowledgeUpdateCard\s*\(/,
  /void\s+sendKnowledgeUpdateText\s*\(/,
];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
    if (name.endsWith(".test.ts")) continue;
    out.push(full);
  }
}

const files: string[] = [];
for (const root of roots) walk(path.join(process.cwd(), root), files);
const hits: string[] = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
  }
}
assert.deepEqual(hits, [], hits.join("\n"));

const human = readFileSync(path.join(process.cwd(), "lib/human-requested.ts"), "utf8");
assert.match(human, /await triggerHumanRequestedNotification\(/);
assert.doesNotMatch(human, /void triggerHumanRequestedNotification\(/);

console.log("keep-server-work.test.ts: ok");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "test failed");
  process.exit(1);
});
