/**
 * Classify MARKETING templates that still need Meta's opt-out button.
 *
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts --execute
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts --only-deferred
 *
 * Default is read-only. --execute submits the canary, then the rest.
 * --only-deferred resubmits templates that are editable now and still lack the button.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createWabaTemplate, getWabaTemplate, listWabaTemplates, updateWabaTemplate, type MetaWabaTemplate } from "@/lib/meta-templates";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import { withMarketingOptOutButton } from "@/lib/meta-marketing-opt-out-button";
import {
  classifyMarketingOptOutTemplate,
  countPlan,
  estimatedDurationMs,
  OPTOUT_RESUBMIT_THROTTLE_MS,
  originalTemplateName,
  plannedWriteCalls,
  templateHasOptOutButton,
  type OptOutPlanClass,
  type OptOutPlanItem,
} from "@/lib/marketing-optout-resubmit-plan";
import { applyOptOutVersionSwitchover } from "@/lib/marketing-optout-switchover";
import { shouldSuppressLeadTemplate } from "@/lib/wa-marketing-opt-out";

const EXECUTE = process.argv.includes("--execute");
const ONLY_DEFERRED = process.argv.includes("--only-deferred");
const CANARY_SLUG = "acrobyjoe";
const CANARY_NAME = "after_class";
const APEX_CATEGORY_NAMES = [
  "trainer_trial_heads_up",
  "freeze_ending_unbooked",
  "freeze_created",
  "membership_cancelled",
  "registered_after_trial",
  "registered_after_trial1",
  "pilates_survey",
];

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

function mismatchesFor(
  meta: { name: string; language: string; status: string; category: string }[],
  db: DbTemplate[],
  dbTable: string
) {
  const dbByKey = new Map<string, DbTemplate>();
  for (const row of db) {
    dbByKey.set(`${row.name}\n${row.language.toLowerCase()}`, row);
  }
  const seen = new Set<string>();
  const out: { name: string; language: string; kind: string; db_table: string; meta?: string; db?: string }[] = [];
  for (const row of meta) {
    const key = `${row.name}\n${row.language.toLowerCase()}`;
    seen.add(key);
    const local = dbByKey.get(key);
    if (!local) {
      out.push({ name: row.name, language: row.language, kind: "missing_in_db", db_table: dbTable });
      continue;
    }
    if (local.status.toUpperCase() !== row.status.toUpperCase()) {
      out.push({
        name: row.name,
        language: row.language,
        kind: "status",
        db_table: dbTable,
        meta: row.status,
        db: local.status,
      });
    }
    if (local.category.toUpperCase() !== row.category.toUpperCase()) {
      out.push({
        name: row.name,
        language: row.language,
        kind: "category",
        db_table: dbTable,
        meta: row.category,
        db: local.category,
      });
    }
  }
  for (const row of db) {
    const key = `${row.name}\n${row.language.toLowerCase()}`;
    if (!seen.has(key)) {
      out.push({
        name: row.name,
        language: row.language,
        kind: "missing_on_meta",
        db_table: dbTable,
        db: row.status,
      });
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

type CategoryWrite = { name: string; language: string; db_table: string; meta?: string; db?: string };

type WorkUnit = {
  group: WabaGroup;
  templates: MetaWabaTemplate[];
  items: OptOutPlanItem[];
  categoryWrites: CategoryWrite[];
};

type ExecLog = {
  started_at: string;
  canary: Record<string, unknown> | null;
  calls: Record<string, unknown>[];
  category_updates: Record<string, unknown>[];
  switchovers: Record<string, unknown>[];
  verification: Record<string, unknown>[];
};

function groupLabel(group: WabaGroup): string {
  return [
    ...group.businesses.map((b) => b.slug || b.name || String(b.id)),
    ...(group.includesZoeAdmin ? ["zoe-admin"] : []),
  ].join(", ");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /429|80008|#4\b|"code"\s*:\s*4\b|"code"\s*:\s*613\b|rate limit|too many calls/i.test(text);
}

async function metaCall<T>(fn: () => Promise<T>): Promise<T> {
  let delay = OPTOUT_RESUBMIT_THROTTLE_MS;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimit(error)) throw error;
      console.warn(`  rate limit, backing off ${delay}ms`);
      await sleep(delay);
      delay = Math.min(delay * 2, 60_000);
    }
  }
}

function componentsFor(template: MetaWabaTemplate): unknown[] | null {
  if (!Array.isArray(template.components)) return null;
  const next = withMarketingOptOutButton(template.components, template.language);
  if (!templateHasOptOutButton({ ...template, components: next })) return null;
  return next;
}

async function syncCategory(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  group: WabaGroup,
  write: CategoryWrite
) {
  const nowIso = new Date().toISOString();
  if (write.db_table === "marketing_whatsapp_templates") {
    const { error } = await admin
      .from("marketing_whatsapp_templates")
      .update({ category: "MARKETING", updated_at: nowIso })
      .eq("name", write.name)
      .eq("language", write.language);
    if (error) throw new Error(error.message);
    return;
  }
  for (const business of group.businesses) {
    const { error } = await admin
      .from("whatsapp_templates")
      .update({ category: "MARKETING", updated_at: nowIso })
      .eq("business_id", business.id)
      .eq("name", write.name)
      .eq("language", write.language);
    if (error) throw new Error(error.message);
  }
}

async function rememberVersion(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  group: WabaGroup,
  source: MetaWabaTemplate,
  versionName: string,
  versionId: string,
  status: string,
  components: unknown[]
) {
  const nowIso = new Date().toISOString();
  const shared = {
    waba_template_id: versionId,
    name: versionName,
    category: "MARKETING",
    language: source.language,
    status: status || "PENDING",
    components,
    updated_at: nowIso,
  };
  if (group.includesZoeAdmin) {
    const existing = await admin
      .from("marketing_whatsapp_templates")
      .select("id")
      .eq("name", source.name)
      .eq("language", source.language)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data || group.businesses.length === 0) {
      const { error } = await admin
        .from("marketing_whatsapp_templates")
        .upsert(shared, { onConflict: "name,language" });
      if (error) throw new Error(error.message);
    }
  }
  for (const business of group.businesses) {
    const existing = await admin
      .from("whatsapp_templates")
      .select("id")
      .eq("business_id", business.id)
      .eq("name", source.name)
      .eq("language", source.language)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data && group.businesses.length > 1) continue;
    const { error } = await admin.from("whatsapp_templates").upsert(
      { ...shared, business_id: business.id },
      { onConflict: "business_id,name,language" }
    );
    if (error) throw new Error(error.message);
  }
}

async function markEdited(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  group: WabaGroup,
  template: MetaWabaTemplate,
  components: unknown[],
  alsoCategory: boolean
) {
  const nowIso = new Date().toISOString();
  const patch = {
    components,
    status: "PENDING",
    updated_at: nowIso,
    ...(alsoCategory ? { category: "MARKETING" } : {}),
  };
  for (const business of group.businesses) {
    const { error } = await admin
      .from("whatsapp_templates")
      .update(patch)
      .eq("business_id", business.id)
      .eq("name", template.name)
      .eq("language", template.language);
    if (error) throw new Error(error.message);
  }
  if (group.includesZoeAdmin) {
    const { error } = await admin
      .from("marketing_whatsapp_templates")
      .update(patch)
      .eq("name", template.name)
      .eq("language", template.language);
    if (error && !/0 rows|does not exist/i.test(error.message)) {
      const check = await admin
        .from("marketing_whatsapp_templates")
        .select("id")
        .eq("name", template.name)
        .eq("language", template.language)
        .maybeSingle();
      if (check.data) throw new Error(error.message);
    }
  }
}

async function runExecute(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  work: WorkUnit[],
  log: ExecLog,
  flush: () => void
) {
  const skip = new Set<string>();

  async function submitOne(unit: WorkUnit, template: MetaWabaTemplate, item: OptOutPlanItem) {
    const key = `${unit.group.wabaId}:${template.name}:${template.language}`;
    if (skip.has(key)) return;
    if (item.class === "EXCLUDED_ACCOUNT_ALERT" || item.class === "DEFERRED" || item.class === "MANUAL") return;
    if (item.class === "SKIP_HAS_BUTTON") {
      const write = unit.categoryWrites.find((row) => row.name === template.name && row.language === template.language);
      if (write && String(write.meta ?? "").toUpperCase() === "MARKETING") {
        await syncCategory(admin, unit.group, write);
        log.category_updates.push({ name: write.name, language: write.language, table: write.db_table, from: write.db, to: "MARKETING" });
        flush();
      }
      return;
    }
    if (ONLY_DEFERRED && item.class !== "EDIT_IN_PLACE" && item.class !== "NEW_VERSION") return;

    const components = componentsFor(template);
    if (!components) {
      log.calls.push({ waba: groupLabel(unit.group), name: template.name, action: "manual", error: "button_not_added" });
      flush();
      return;
    }
    const categoryWrite = unit.categoryWrites.find(
      (row) => row.name === template.name && row.language === template.language && String(row.meta ?? "").toUpperCase() === "MARKETING"
    );
    try {
      if (item.class === "NEW_VERSION" || item.class === "SKIP_HAS_VERSION") {
        const versionName = item.planned_name || "";
        const existing = unit.templates.find((row) => row.name === versionName && row.language === template.language);
        if (item.class === "SKIP_HAS_VERSION" && existing) {
          await rememberVersion(admin, unit.group, template, existing.name, existing.id, existing.status, existing.components ?? components);
        } else if (versionName) {
          const created = await metaCall(() =>
            createWabaTemplate(unit.group.wabaId, {
              name: versionName,
              category: "MARKETING",
              language: template.language,
              components,
            })
          );
          log.calls.push({
            at: new Date().toISOString(),
            waba: groupLabel(unit.group),
            name: template.name,
            action: "create",
            request: { name: versionName, category: "MARKETING", language: template.language, components },
            response: created,
          });
          flush();
          await sleep(OPTOUT_RESUBMIT_THROTTLE_MS);
          await rememberVersion(admin, unit.group, template, versionName, created.id, created.status, components);
        }
      } else if (item.class === "EDIT_IN_PLACE") {
        const updated = await metaCall(() => updateWabaTemplate(template.id, { components }));
        log.calls.push({
          at: new Date().toISOString(),
          waba: groupLabel(unit.group),
          name: template.name,
          action: "edit",
          request: { id: template.id, components },
          response: updated,
        });
        flush();
        await sleep(OPTOUT_RESUBMIT_THROTTLE_MS);
        await markEdited(admin, unit.group, template, components, Boolean(categoryWrite));
      }
      if (categoryWrite && item.class !== "EDIT_IN_PLACE") {
        await syncCategory(admin, unit.group, categoryWrite);
        log.category_updates.push({ name: categoryWrite.name, language: categoryWrite.language, table: categoryWrite.db_table, from: categoryWrite.db, to: "MARKETING" });
        flush();
      } else if (categoryWrite && item.class === "EDIT_IN_PLACE") {
        log.category_updates.push({ name: categoryWrite.name, language: categoryWrite.language, table: categoryWrite.db_table, from: categoryWrite.db, to: "MARKETING", with: "edit" });
        flush();
      }
      skip.add(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED ${template.name}: ${message}`);
      log.calls.push({
        at: new Date().toISOString(),
        waba: groupLabel(unit.group),
        name: template.name,
        action: item.class,
        error: message,
        request_components: components,
      });
      flush();
    }
  }

  if (EXECUTE && !ONLY_DEFERRED) {
    const unit = work.find((row) => row.group.businesses.some((b) => b.slug === CANARY_SLUG));
    const template = unit?.templates.find((row) => row.name === CANARY_NAME && row.language.toLowerCase().startsWith("he"));
    const item = unit?.items.find((row) => row.name === CANARY_NAME);
    if (!unit || !template || !item) {
      throw new Error("canary template acrobyjoe/after_class not found");
    }
    if (item.class !== "EDIT_IN_PLACE" && item.class !== "SKIP_HAS_BUTTON") {
      throw new Error(`canary class is ${item.class}, expected EDIT_IN_PLACE`);
    }
    const sent = componentsFor(template);
    if (item.class === "EDIT_IN_PLACE") {
      if (!sent) throw new Error("canary button could not be added");
      const updated = await metaCall(() => updateWabaTemplate(template.id, { components: sent }));
      log.canary = { submitted: true, template_id: template.id, response: updated, components_sent: sent };
      flush();
      console.log("CANARY_SUBMITTED", template.id);
      let decision = "PENDING";
      for (let attempt = 1; attempt <= 30; attempt += 1) {
        await sleep(60_000);
        const current = await metaCall(() => getWabaTemplate(template.id));
        console.log(`CANARY_POLL ${attempt} ${current.status}`);
        log.canary = { ...log.canary, poll: attempt, status: current.status, rejected_reason: current.rejected_reason };
        flush();
        if (current.status.toUpperCase() === "APPROVED") {
          if (!templateHasOptOutButton(current)) {
            log.canary = { ...log.canary, result: "approved_without_button", components: current.components };
            flush();
            console.error("CANARY_REJECTED approved without opt-out button");
            console.error(JSON.stringify(sent, null, 2));
            process.exit(1);
          }
          decision = "APPROVED";
          break;
        }
        if (current.status.toUpperCase() === "REJECTED") {
          log.canary = { ...log.canary, result: "rejected", rejected_reason: current.rejected_reason, components_sent: sent };
          flush();
          console.error("CANARY_REJECTED", current.rejected_reason || "(no reason)");
          console.error(JSON.stringify(sent, null, 2));
          process.exit(1);
        }
      }
      if (decision !== "APPROVED") {
        log.canary = { ...log.canary, result: "still_pending" };
        flush();
        console.error("CANARY_PENDING after 30 min");
        process.exit(1);
      }
      await markEdited(admin, unit.group, template, sent, false);
      console.log("CANARY_APPROVED");
    } else {
      log.canary = { result: "already_had_button" };
      console.log("CANARY_APPROVED already had the button");
    }
    skip.add(`${unit.group.wabaId}:${template.name}:${template.language}`);
    log.canary = { ...(log.canary ?? {}), result: "approved" };
    flush();
  }

  await Promise.all(
    work.map(async (unit) => {
      for (const item of unit.items) {
        if (ONLY_DEFERRED && item.class !== "EDIT_IN_PLACE" && item.class !== "NEW_VERSION") continue;
        const template = unit.templates.find((row) => row.name === item.name && row.language === item.language);
        if (!template) continue;
        await submitOne(unit, template, item);
      }
    })
  );

  console.log("EXECUTE_DONE");
  const fallthrough: string[] = [];
  for (const unit of work) {
    let fresh: MetaWabaTemplate[] = [];
    try {
      fresh = await listWabaTemplates(unit.group.wabaId, { fields: LIST_FIELDS, max: LIST_MAX });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fallthrough.push(`${groupLabel(unit.group)} LIST FAILED ${message}`);
      continue;
    }
    const marketing = fresh.filter((row) => norm(row.category).toUpperCase() === "MARKETING");
    for (const template of marketing) {
      if (template.name === "quota_warning_80" || template.name === "quota_limit_reached") continue;
      if (templateHasOptOutButton(template)) continue;
      const version = fresh.find(
        (row) =>
          originalTemplateName(row.name) === template.name &&
          row.language === template.language &&
          templateHasOptOutButton(row)
      );
      if (version) continue;
      fallthrough.push(`${groupLabel(unit.group)} ${template.name} (${template.language}, ${template.status})`);
    }
    for (const template of fresh) {
      if (!originalTemplateName(template.name) || template.status.toUpperCase() !== "APPROVED") continue;
      if (!templateHasOptOutButton(template)) continue;
      const businessId = unit.group.businesses.length === 1 ? unit.group.businesses[0].id : null;
      for (const business of unit.group.businesses) {
        const result = await applyOptOutVersionSwitchover(admin, {
          name: template.name,
          status: template.status,
          category: template.category,
          components: template.components,
          businessId: business.id,
          marketingLine: false,
        });
        log.switchovers.push({ name: template.name, business_id: business.id, result });
      }
      if (unit.group.includesZoeAdmin) {
        const result = await applyOptOutVersionSwitchover(admin, {
          name: template.name,
          status: template.status,
          category: template.category,
          components: template.components,
          businessId: businessId,
          marketingLine: true,
        });
        log.switchovers.push({ name: template.name, marketing_line: true, result });
      }
    }
  }
  log.verification.push({ fallthrough });

  const apex = work.find((row) => row.group.businesses.some((b) => b.slug === "apex"));
  const apexId = apex?.group.businesses.find((b) => b.slug === "apex")?.id;
  if (apexId) {
    const { data, error } = await admin
      .from("whatsapp_templates")
      .select("name, category")
      .eq("business_id", apexId)
      .in("name", APEX_CATEGORY_NAMES);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const category = String((row as { category?: string }).category ?? "");
      log.verification.push({
        name: (row as { name?: string }).name,
        category,
        would_block_marketing_opt_out: shouldSuppressLeadTemplate({
          category,
          optedOut: false,
          marketingOptedOut: true,
        }),
      });
    }
  }
  const { data: switchedTriggers } = await admin
    .from("template_triggers")
    .select("id, business_id, template_name")
    .eq("enabled", true)
    .like("template_name", "%_v2");
  log.verification.push({ triggers_pointing_at_version: switchedTriggers ?? [] });
  flush();
  if (fallthrough.length) {
    console.log("FELL_THROUGH");
    for (const line of fallthrough) console.log(" ", line);
  } else {
    console.log("VERIFICATION_OK no marketing template left without a button or a _v2");
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
  const work: WorkUnit[] = [];
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
    const mismatches = [
      ...(dbRows.length ? mismatchesFor(templates, dbRows, "whatsapp_templates") : []),
      ...(group.includesZoeAdmin
        ? mismatchesFor(templates, marketingDb, "marketing_whatsapp_templates")
        : []),
    ];
    const categoryWrites = mismatches.filter((row) => row.kind === "category");

    console.log(
      `  MARKETING ${marketing.length} / ${templates.length} on Meta` +
        (templates.length >= LIST_MAX ? "  TRUNCATED" : "")
    );
    console.log(
      `  EDIT_IN_PLACE ${counts.EDIT_IN_PLACE}  NEW_VERSION ${counts.NEW_VERSION}  DEFERRED ${counts.DEFERRED}  MANUAL ${counts.MANUAL}  EXCLUDED_ACCOUNT_ALERT ${counts.EXCLUDED_ACCOUNT_ALERT}  already ${counts.SKIP_HAS_BUTTON}  versioned ${counts.SKIP_HAS_VERSION}`
    );
    console.log(`  planned Meta writes: ${writes}   planned category DB updates: ${categoryWrites.length}`);
    const by = (name: OptOutPlanClass) => items.filter((item) => item.class === name);
    printClass("EDIT_IN_PLACE", by("EDIT_IN_PLACE"));
    printClass("NEW_VERSION", by("NEW_VERSION"));
    printClass("DEFERRED", by("DEFERRED"));
    printClass("MANUAL", by("MANUAL"));
    printClass("EXCLUDED_ACCOUNT_ALERT", by("EXCLUDED_ACCOUNT_ALERT"));
    if (categoryWrites.length) {
      console.log(`  category DB updates (${categoryWrites.length})`);
      for (const row of categoryWrites) {
        console.log(`    ${row.db_table} ${row.name} (${row.language}) ${row.db} -> ${row.meta}`);
      }
    }

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
      planned_category_db_updates: categoryWrites,
      items,
      mismatches,
    });
    work.push({ group, templates, items, categoryWrites });
  }

  const totals = {
    wabas: reports.length,
    list_get_calls: listCalls,
    planned_write_calls: writeCallsPerWaba.reduce((sum, n) => sum + n, 0),
    planned_category_db_updates: reports.reduce(
      (sum, report) => sum + ((report as { planned_category_db_updates?: unknown[] }).planned_category_db_updates?.length ?? 0),
      0
    ),
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
  console.log(`Planned Meta writes: ${totals.planned_write_calls}`);
  console.log(`Planned category DB updates: ${totals.planned_category_db_updates}`);
  console.log(EXECUTE || ONLY_DEFERRED ? "Canary: acrobyjoe after_class" : "Canary (not run): acrobyjoe after_class");
  console.log(`Estimated execute duration: ${Math.ceil(totals.estimated_duration_ms / 1000)}s`);
  console.log(`Report: ${OUT_PATH}`);

  if (EXECUTE || ONLY_DEFERRED) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(process.cwd(), "scripts", "out", `marketing-optout-execute-${stamp}.json`);
    const log: ExecLog = {
      started_at: new Date().toISOString(),
      canary: null,
      calls: [],
      category_updates: [],
      switchovers: [],
      verification: [],
    };
    const flush = () => writeFileSync(logPath, JSON.stringify(log, null, 2));
    flush();
    console.log(`Execute log: ${logPath}`);
    await runExecute(admin, work, log, flush);
    console.log(`Execute log: ${logPath}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
