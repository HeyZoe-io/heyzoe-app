/**
 * One-off: list Meta message templates for Sangha (info-2815).
 *
 *   npx tsx --env-file=.env.local scripts/test-list-templates.ts
 *
 * Read-only against Meta (GET message_templates only).
 */

import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { resolveMetaWabaId } from "../lib/meta-waba-resolve";
import { listWabaTemplates } from "../lib/meta-templates";

async function main() {
  const admin = createSupabaseAdminClient();
  const { data: biz, error } = await admin
    .from("businesses")
    .select("slug, waba_id")
    .eq("slug", "info-2815")
    .maybeSingle();

  if (error) {
    console.error("business lookup failed:", error.message);
    process.exit(1);
  }
  if (!biz) {
    console.error("business not found: info-2815");
    process.exit(1);
  }

  const dbWabaId = String((biz as { waba_id?: unknown }).waba_id ?? "")
    .trim()
    .replace(/\s+/g, "");
  const envFallback = process.env.META_WABA_ID?.trim() ?? "";
  const wabaId = resolveMetaWabaId(dbWabaId, envFallback);

  if (!dbWabaId) {
    console.log(
      "info-2815 has empty businesses.waba_id — falling back to META_WABA_ID."
    );
  }

  if (!wabaId) {
    console.error(
      "No WABA to query: businesses.waba_id is empty and META_WABA_ID is unset."
    );
    process.exit(1);
  }

  console.log(
    `Using WABA from: ${dbWabaId ? "businesses.waba_id" : "META_WABA_ID"} (${wabaId})`
  );

  const templates = await listWabaTemplates(wabaId);
  for (const t of templates) {
    console.log(`${t.name} | ${t.status} | ${t.category} | ${t.language}`);
  }
  console.log(`total: ${templates.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
