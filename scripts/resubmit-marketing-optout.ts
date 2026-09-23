/**
 * Dry run: classify MARKETING templates that still need Meta's opt-out button.
 *
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts
 *
 * Read-only. GET message_templates + Supabase selects. No Meta writes, no DB writes.
 * Writes scripts/out/marketing-optout-dry-run.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { listWabaTemplates } from "@/lib/meta-templates";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import {
  classifyMarketingOptOutTemplate,
  countPlan,
  estimatedDurationMs,
  OPTOUT_RESUBMIT_THROTTLE_MS,
  plannedWriteCalls,
  type OptOutPlanClass,
  type OptOutPlanItem,
} from "@/lib/marketing-optout-resubmit-plan";

const LIST_FIELDS = "id,name,status,category,language,components";
const LIST_MAX = 5000;
const PAGE = 1000;
const OUT_PATH = path.join(process.cwd(), "scripts", "out", "marketing-optout-dry-run.json");

type BusinessRow = { id: number; slug: string; name: string; waba_id: string };
type DbTemplate = { name: string; language: string; status: string; category: string };

type WabaGroup = {
  wabaId: string;
  businesses: BusinessRow[];
  includesZoeAdmin: boolean;
};

async function selectPages<T>(
  load: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (Array.isArray(data) ? data : []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function namesFromRows(rows: { template_name?: unknown; enabled?: unknown; status?: unknown }[], mode: "enabled" | "pending"): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    if (mode === "enabled" && row.enabled !== true) continue;
    if (mode === "pending" && norm(row.status).toLowerCase() !== "pending") continue;
    const name = norm(row.template_name);
    if (name) names.add(name);
  }
  return names;
}

function mismatchesFor(meta: { name: string; language: string; status: string; category: string }[], db: DbTemplate[]) {
  const dbByKey = new Map<string, DbTemplate>();
  for (const row of db) {
    dbByKey.set(`${row.name}\n${row.language.toLowerCase()}`, row);
  }
  const seen = new Set<string>();
  const out: { name: string; language: string; kind: string; meta?: string; db?: string }[] = [];
  for (const row of meta) {
    const key = `${row.name}\n${row.language.toLowerCase()}`;
    seen.add(key);
    const local = dbByKey.get(key);
    if (!local) {
      out.push({ name: row.name, language: row.language, kind: "missing_in_db" });
      continue;
    }
    if (local.status.toUpperCase() !== row.status.toUpperCase()) {
      out.push({
        name: row.name,
        language: row.language,
        kind: "status",
        meta: row.status,
        db: local.status,
      });
    }
    if (local.category.toUpperCase() !== row.category.toUpperCase()) {
      out.push({
        name: row.name,
        language: row.language,
        kind: "category",
        meta: row.category,
        db: local.category,
      });
    }
  }
  for (const row of db) {
    const key = `${row.name}\n${row.language.toLowerCase()}`;
    if (!seen.has(key)) {
      out.push({ name: row.name, language: row.language, kind: "missing_on_meta", db: row.status });
    }
  }
  return out;
}

function printClass(title: string, items: OptOutPlanItem[]) {
  if (!items.length) return;
  console.log(`  ${title} (${items.length})`);
  for (const item of items) {
    const extra = item.planned_name ? ` -> ${item.planned_name}` : "";
    const reason = item.reason ? ` [${item.reason}]` : "";
    const used = item.in_use ? " in-use" : "";
    console.log(`    ${item.name} (${item.language}, ${item.status}${used})${extra}${reason}`);
  }
}

async function main() {
  const admin = createSupabaseAdminClient();
  const businessRows = await selectPages<BusinessRow>((from, to) =>
    admin
      .from("businesses")
      .select("id, slug, name, waba_id")
      .not("waba_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const businesses = businessRows
    .map((row) => ({
      id: Number(row.id),
      slug: norm(row.slug),
      name: norm(row.name),
      waba_id: norm(row.waba_id).replace(/\s+/g, ""),
    }))
    .filter((row) => row.waba_id && Number.isFinite(row.id));

  const marketingWabaId = await resolveMarketingWabaId();
  const groups = new Map<string, WabaGroup>();
  for (const business of businesses) {
    const group = groups.get(business.waba_id) ?? {
      wabaId: business.waba_id,
      businesses: [],
      includesZoeAdmin: false,
    };
    group.businesses.push(business);
    groups.set(business.waba_id, group);
  }
  if (marketingWabaId) {
    const group = groups.get(marketingWabaId) ?? {
      wabaId: marketingWabaId,
      businesses: [],
      includesZoeAdmin: false,
    };
    group.includesZoeAdmin = true;
    groups.set(marketingWabaId, group);
  }

  const triggerRows = await selectPages<{ business_id: number; template_name: string; enabled: boolean }>(
    (from, to) =>
      admin
        .from("template_triggers")
        .select("business_id, template_name, enabled")
        .range(from, to)
  );
  const scheduledRows = await selectPages<{ business_id: number; template_name: string; status: string }>(
    (from, to) =>
      admin
        .from("scheduled_template_sends")
        .select("business_id, template_name, status")
        .eq("status", "pending")
        .range(from, to)
  );
  const marketingTriggerRows = await selectPages<{ template_name: string; enabled: boolean }>((from, to) =>
    admin
      .from("marketing_template_triggers")
      .select("template_name, enabled")
      .range(from, to)
  );
  const marketingScheduledRows = await selectPages<{ template_name: string; status: string }>((from, to) =>
    admin
      .from("scheduled_marketing_template_sends")
      .select("template_name, status")
      .eq("status", "pending")
      .range(from, to)
  );

  const inUseByBusiness = new Map<number, Set<string>>();
  for (const row of triggerRows) {
    if (row.enabled !== true) continue;
    const name = norm(row.template_name);
    if (!name) continue;
    const set = inUseByBusiness.get(Number(row.business_id)) ?? new Set<string>();
    set.add(name);
    inUseByBusiness.set(Number(row.business_id), set);
  }
  for (const row of scheduledRows) {
    const name = norm(row.template_name);
    if (!name) continue;
    const set = inUseByBusiness.get(Number(row.business_id)) ?? new Set<string>();
    set.add(name);
    inUseByBusiness.set(Number(row.business_id), set);
  }
  const marketingInUse = namesFromRows(marketingTriggerRows, "enabled");
  for (const name of namesFromRows(marketingScheduledRows, "pending")) marketingInUse.add(name);
  // Quota alerts are sent by name from the Zoe admin WABA, not via a trigger row.
  for (const name of ["quota_warning_80", "quota_warning_95", "quota_limit_reached"]) {
    marketingInUse.add(name);
  }

  const leadTemplateRows = await selectPages<{ id: number; lead_template_name: string | null }>((from, to) =>
    admin.from("businesses").select("id, lead_template_name").range(from, to)
  );
  for (const row of leadTemplateRows) {
    const name = norm(row.lead_template_name);
    if (!name) continue;
    const set = inUseByBusiness.get(Number(row.id)) ?? new Set<string>();
    set.add(name);
    inUseByBusiness.set(Number(row.id), set);
  }

  const dbByBusiness = new Map<number, DbTemplate[]>();
  const dbTemplates = await selectPages<DbTemplate & { business_id: number }>((from, to) =>
    admin
      .from("whatsapp_templates")
      .select("business_id, name, language, status, category")
      .range(from, to)
  );
  for (const row of dbTemplates) {
    const list = dbByBusiness.get(Number(row.business_id)) ?? [];
    list.push({
      name: norm(row.name),
      language: norm(row.language),
      status: norm(row.status),
      category: norm(row.category),
    });
    dbByBusiness.set(Number(row.business_id), list);
  }
  const marketingDb = (
    await selectPages<DbTemplate>((from, to) =>
      admin
        .from("marketing_whatsapp_templates")
        .select("name, language, status, category")
        .range(from, to)
    )
  ).map((row) => ({
    name: norm(row.name),
    language: norm(row.language),
    status: norm(row.status),
    category: norm(row.category),
  }));

  const reports = [];
  const writeCallsPerWaba: number[] = [];
  let listCalls = 0;

  for (const group of groups.values()) {
    const label = [
      ...group.businesses.map((b) => b.slug || b.name || String(b.id)),
      ...(group.includesZoeAdmin ? ["zoe-admin"] : []),
    ].join(", ");
    console.log(`\n${label}  waba ${group.wabaId}`);
    let templates;
    try {
      templates = await listWabaTemplates(group.wabaId, { fields: LIST_FIELDS, max: LIST_MAX });
      listCalls += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`  LIST FAILED: ${message}`);
      reports.push({ waba_id: group.wabaId, label, error: message });
      continue;
    }

    const marketing = templates.filter((row) => norm(row.category).toUpperCase() === "MARKETING");
    const inUse = new Set<string>();
    for (const business of group.businesses) {
      for (const name of inUseByBusiness.get(business.id) ?? []) inUse.add(name);
    }
    if (group.includesZoeAdmin) {
      for (const name of marketingInUse) inUse.add(name);
    }
    const taken = new Set(templates.map((row) => row.name));
    const items = marketing.map((template) =>
      classifyMarketingOptOutTemplate({
        template,
        inUse: inUse.has(template.name),
        takenNames: taken,
        allOnWaba: templates,
      })
    );
    const counts = countPlan(items);
    const writes = plannedWriteCalls(items);
    writeCallsPerWaba.push(writes);

    const dbRows = group.businesses.flatMap((b) => dbByBusiness.get(b.id) ?? []);
    const comparedDb = group.includesZoeAdmin ? [...dbRows, ...marketingDb] : dbRows;
    const mismatches = mismatchesFor(templates, comparedDb);

    console.log(
      `  MARKETING ${marketing.length} / ${templates.length} on Meta` +
        (templates.length >= LIST_MAX ? "  TRUNCATED" : "")
    );
    console.log(
      `  EDIT_IN_PLACE ${counts.EDIT_IN_PLACE}  NEW_VERSION ${counts.NEW_VERSION}  DEFERRED ${counts.DEFERRED}  MANUAL ${counts.MANUAL}  already ${counts.SKIP_HAS_BUTTON}  versioned ${counts.SKIP_HAS_VERSION}`
    );
    console.log(`  planned write calls: ${writes}`);
    const by = (name: OptOutPlanClass) => items.filter((item) => item.class === name);
    printClass("EDIT_IN_PLACE", by("EDIT_IN_PLACE"));
    printClass("NEW_VERSION", by("NEW_VERSION"));
    printClass("DEFERRED", by("DEFERRED"));
    printClass("MANUAL", by("MANUAL"));
    if (mismatches.length) console.log(`  db mismatches: ${mismatches.length}`);

    reports.push({
      waba_id: group.wabaId,
      label,
      includes_zoe_admin: group.includesZoeAdmin,
      business_ids: group.businesses.map((b) => b.id),
      meta_templates: templates.length,
      truncated: templates.length >= LIST_MAX,
      marketing: marketing.length,
      counts,
      planned_write_calls: writes,
      items,
      mismatches,
    });
  }

  const totals = {
    wabas: reports.length,
    list_get_calls: listCalls,
    planned_write_calls: writeCallsPerWaba.reduce((sum, n) => sum + n, 0),
    throttle_ms: OPTOUT_RESUBMIT_THROTTLE_MS,
    estimated_duration_ms: estimatedDurationMs(writeCallsPerWaba),
    estimated_duration_note: "Parallel across WABAs, 1 write / 2s inside a WABA. Duration is the slowest WABA.",
  };
  const payload = { generated_at: new Date().toISOString(), totals, wabas: reports };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));

  console.log("\n---");
  console.log(`WABAs: ${totals.wabas}`);
  console.log(`Meta list calls this run: ${totals.list_get_calls}`);
  console.log(`Planned write calls: ${totals.planned_write_calls}`);
  console.log(`Estimated execute duration: ${Math.ceil(totals.estimated_duration_ms / 1000)}s`);
  console.log(`Report: ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
