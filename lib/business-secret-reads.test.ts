import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FIELDS = ["crm_api_key", "conversions_api_token", "leads_webhook_secret"] as const;

const ALLOWED = new Set([
  "lib/business-secrets.ts",
  "lib/business-secret-backfill.ts",
  "lib/field-encryption.ts",
  "lib/business-secret-read.ts",
  "app/api/leads/incoming/route.ts",
  "app/dashboard/[slug]/settings/page.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const path = join(dir, name);
    const rel = path.slice(ROOT.length + 1);
    const st = statSync(path);
    if (st.isDirectory()) {
      walk(path, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (rel.endsWith(".test.ts")) continue;
    if (rel.startsWith("supabase/")) continue;
    out.push(rel);
  }
  return out;
}

const bare = FIELDS.map((field) => new RegExp(`\\b${field}\\b(?!_enc)`, "g"));
const offenders: string[] = [];

for (const rel of walk(ROOT)) {
  if (ALLOWED.has(rel)) continue;
  const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
  lines.forEach((line, index) => {
    for (let i = 0; i < FIELDS.length; i += 1) {
      bare[i].lastIndex = 0;
      if (!bare[i].test(line)) continue;
      if (!line.includes(`${FIELDS[i]}_enc`)) {
        offenders.push(`${rel}:${index + 1}`);
      }
    }
  });
}

assert.deepEqual(offenders, []);
console.log("business-secret-reads.test.ts ok");
