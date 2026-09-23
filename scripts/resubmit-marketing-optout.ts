/**
 * Classify MARKETING templates that still need Meta's opt-out button.
 *
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts --execute
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts --only-deferred
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts --category-sync
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts --only-new-version
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts --watch-canary
 *   npx tsx --env-file=.env.local scripts/resubmit-marketing-optout.ts --only-held-edits
 *
 * Default is read-only. --execute submits the canary, then the rest.
 * --only-deferred resubmits templates that are editable now and still lack the button.
 * --category-sync updates the 7 Apex DB categories and checks the send gate. No Meta write.
 * --only-new-version creates _v2 rows only. Originals stay live.
 * --watch-canary polls after_class every 15 min (up to 24h). On APPROVED it submits held edits.
 * --only-held-edits submits the parked edit-in-place templates (not the canary).
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
import { evaluateLeadTemplateSend, shouldSuppressLeadTemplate } from "@/lib/wa-marketing-opt-out";

const EXECUTE = process.argv.includes("--execute");
const ONLY_DEFERRED = process.argv.includes("--only-deferred");
const CATEGORY_SYNC = process.argv.includes("--category-sync");
const ONLY_NEW_VERSION = process.argv.includes("--only-new-version");
const WATCH_CANARY = process.argv.includes("--watch-canary");
let heldEdits = process.argv.includes("--only-held-edits");
const CANARY_SLUG = "acrobyjoe";
const CANARY_NAME = "after_class";
const CANARY_TEMPLATE_ID = "1067538898946355";
const WATCH_INTERVAL_MS = 15 * 60 * 1000;
const WATCH_DEADLINE_MS = 24 * 60 * 60 * 1000;
const HELD_EDIT_NAMES = new Set([
  "sanga_welcome2",
  "sangha_lead_welcome",
  "registered_after_trial",
  "registered_after_trial1",
  "pilates_survey",
  "5_discount",
  "new_feature",
]);
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

function parseMetaError(message: string): { code: string; meta_message: string } {
  let code = "";
  let metaMessage = message;
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as { error?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown };
      const err = parsed.error ?? parsed;
      if (err.code != null) code = String(err.code);
      if (err.message) metaMessage = String(err.message);
    } catch {
      /* keep the raw message */
    }
  }
  if (!code) {
    const match = message.match(/"code"\s*:\s*(\d+)/) || message.match(/\(#(\d+)\)/);
    if (match) code = match[1];
  }
  return { code, meta_message: metaMessage };
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
    if (ONLY_NEW_VERSION && item.class !== "NEW_VERSION" && item.class !== "SKIP_HAS_VERSION") return;
    if (heldEdits && (item.class !== "EDIT_IN_PLACE" || !HELD_EDIT_NAMES.has(template.name))) return;

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
          log.calls.push({
            at: new Date().toISOString(),
            waba: groupLabel(unit.group),
            name: template.name,
            action: "already",
            status: existing.status,
            request: { name: existing.name },
            response: { id: existing.id, status: existing.status },
          });
          flush();
          console.log(`V2_ALREADY ${groupLabel(unit.group)} ${existing.name} ${existing.status}`);
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
          console.log(`V2_SUBMITTED ${groupLabel(unit.group)} ${versionName} ${created.status || "PENDING"}`);
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
      const parsed = parseMetaError(message);
      console.error(`  FAILED ${template.name}: ${parsed.code} ${parsed.meta_message}`);
      log.calls.push({
        at: new Date().toISOString(),
        waba: groupLabel(unit.group),
        name: template.name,
        action: item.class,
        error: message,
        error_code: parsed.code,
        error_message: parsed.meta_message,
        request_components: components,
      });
      flush();
    }
  }

  if (EXECUTE && !ONLY_DEFERRED && !ONLY_NEW_VERSION && !heldEdits) {
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
        if (ONLY_NEW_VERSION && item.class !== "NEW_VERSION" && item.class !== "SKIP_HAS_VERSION") continue;
        if (heldEdits && (item.class !== "EDIT_IN_PLACE" || !HELD_EDIT_NAMES.has(item.name))) continue;
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
  if (ONLY_NEW_VERSION) {
    printNewVersionReport(log);
  } else if (fallthrough.length) {
    console.log("FELL_THROUGH");
    for (const line of fallthrough) console.log(" ", line);
  } else {
    console.log("VERIFICATION_OK no marketing template left without a button or a _v2");
  }
  if (heldEdits) console.log("HELD_EDIT_DONE");
}

function printNewVersionReport(log: ExecLog) {
  const by = new Map<string, { submitted: string[]; failed: string[]; pending: string[] }>();
  for (const call of log.calls) {
    const waba = String(call.waba ?? "");
    const bucket = by.get(waba) ?? { submitted: [], failed: [], pending: [] };
    const request = call.request as { name?: string } | undefined;
    const versionName = String(request?.name || call.name || "");
    if (call.error) {
      const code = String(call.error_code ?? "");
      const message = String(call.error_message ?? call.error);
      bucket.failed.push(`${versionName}: ${code} ${message}`.trim());
    } else if (call.action === "already") {
      const status = String(call.status ?? "").toUpperCase();
      if (status === "PENDING") bucket.pending.push(versionName);
      else bucket.submitted.push(`${versionName} (כבר ${status})`);
    } else if (call.action === "create") {
      const response = call.response as { status?: string } | undefined;
      bucket.submitted.push(`${versionName} (${response?.status || "PENDING"})`);
    }
    by.set(waba, bucket);
  }
  console.log("NEW_VERSION_REPORT");
  for (const [waba, bucket] of by) {
    console.log(`  ${waba}`);
    console.log(`    submitted ${bucket.submitted.length}: ${bucket.submitted.join(", ") || "-"}`);
    console.log(`    failed ${bucket.failed.length}: ${bucket.failed.join(", ") || "-"}`);
    console.log(`    already_pending ${bucket.pending.length}: ${bucket.pending.join(", ") || "-"}`);
  }
}

async function runCategorySync(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const { data: biz, error: bizError } = await admin.from("businesses").select("id").eq("slug", "apex").maybeSingle();
  if (bizError || !biz) throw new Error(bizError?.message || "apex business missing");
  const apexId = Number((biz as { id: number }).id);
  const { data, error } = await admin
    .from("whatsapp_templates")
    .select("name, language, category")
    .eq("business_id", apexId)
    .in("name", APEX_CATEGORY_NAMES);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { name: string; language: string; category: string }[];
  const updates: Record<string, unknown>[] = [];
  for (const row of rows) {
    const from = String(row.category ?? "");
    if (from.toUpperCase() === "MARKETING") {
      updates.push({ name: row.name, language: row.language, from, to: "MARKETING", unchanged: true });
      continue;
    }
    const { error: updateError } = await admin
      .from("whatsapp_templates")
      .update({ category: "MARKETING", updated_at: new Date().toISOString() })
      .eq("business_id", apexId)
      .eq("name", row.name)
      .eq("language", row.language);
    if (updateError) throw new Error(updateError.message);
    updates.push({ name: row.name, language: row.language, from, to: "MARKETING" });
  }
  const found = new Set(rows.map((row) => row.name));
  const missing = APEX_CATEGORY_NAMES.filter((name) => !found.has(name));

  const probe = "pilates_survey";
  let phone = "";
  let createdId: number | null = null;
  const existing = await admin
    .from("contacts")
    .select("id, phone, opted_out")
    .eq("business_id", apexId)
    .eq("marketing_opted_out", true)
    .limit(20);
  if (existing.error) throw new Error(existing.error.message);
  const match = (existing.data ?? []).find((row) => (row as { opted_out?: boolean | null }).opted_out !== true) as
    | { phone?: string }
    | undefined;
  if (match?.phone) {
    phone = String(match.phone);
  } else {
    phone = "00000000991";
    const inserted = await admin
      .from("contacts")
      .insert({
        business_id: apexId,
        phone,
        source: "optout_gate_check",
        marketing_opted_out: true,
        opted_out: false,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "probe contact insert failed");
    createdId = Number((inserted.data as { id: number }).id);
  }

  let gate: Awaited<ReturnType<typeof evaluateLeadTemplateSend>> | null = null;
  try {
    gate = await evaluateLeadTemplateSend({
      admin,
      businessId: apexId,
      phone,
      templateName: probe,
    });
  } finally {
    if (createdId != null) {
      await admin.from("contacts").delete().eq("id", createdId).eq("business_id", apexId);
    }
  }
  const gateOk =
    gate != null &&
    gate.suppress === true &&
    String(gate.category ?? "").toUpperCase() === "MARKETING" &&
    gate.flags.marketingOptedOut === true &&
    gate.flags.optedOut === false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(process.cwd(), "scripts", "out", `marketing-optout-category-sync-${stamp}.json`);
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(
    logPath,
    JSON.stringify({ at: new Date().toISOString(), apex_id: apexId, updates, missing, probe, gate, gate_ok: gateOk }, null, 2)
  );
  console.log("CATEGORY_SYNC");
  for (const row of updates) console.log(`  ${row.name} ${row.language}: ${row.from} -> ${row.to}${row.unchanged ? " (כבר)" : ""}`);
  if (missing.length) console.log(`  missing: ${missing.join(", ")}`);
  console.log(gateOk ? "GATE_OK" : "GATE_FAILED", probe, JSON.stringify(gate ? { suppress: gate.suppress, category: gate.category, flags: gate.flags } : null));
  console.log(`Category log: ${logPath}`);
  if (!gateOk || missing.length) process.exit(1);
}

async function reportRejectedVersions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  reason: string
) {
  const businessRows = await selectPages<{ waba_id: string; slug: string }>((from, to) =>
    admin.from("businesses").select("waba_id, slug").not("waba_id", "is", null).range(from, to)
  );
  const marketingWabaId = await resolveMarketingWabaId();
  const wabas = new Map<string, string>();
  for (const row of businessRows) {
    const id = norm(row.waba_id).replace(/\s+/g, "");
    if (!id) continue;
    wabas.set(id, wabas.get(id) ? `${wabas.get(id)}, ${norm(row.slug)}` : norm(row.slug));
  }
  if (marketingWabaId) {
    wabas.set(marketingWabaId, wabas.get(marketingWabaId) ? `${wabas.get(marketingWabaId)}, zoe-admin` : "zoe-admin");
  }
  const same: string[] = [];
  const wanted = reason.trim().toUpperCase();
  for (const [wabaId, label] of wabas) {
    const templates = await listWabaTemplates(wabaId, {
      fields: "id,name,status,language,rejected_reason",
      max: LIST_MAX,
    });
    for (const template of templates) {
      if (!/_v\d+$/.test(template.name)) continue;
      if (template.status.toUpperCase() !== "REJECTED") continue;
      const current = await getWabaTemplate(template.id);
      const theirReason = String(current.rejected_reason ?? "").trim();
      if (wanted && theirReason.toUpperCase() === wanted) {
        same.push(`${label} ${template.name} (${theirReason})`);
      }
    }
  }
  console.log("V2_REJECTED_SAME_REASON");
  if (!same.length) console.log("  none");
  for (const line of same) console.log(`  ${line}`);
  return same;
}

async function pollCanary(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<"approved" | "rejected" | "timeout"> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(process.cwd(), "scripts", "out", `marketing-optout-canary-watch-${stamp}.json`);
  mkdirSync(path.dirname(logPath), { recursive: true });
  const started = Date.now();
  const log: Record<string, unknown> = { started_at: new Date().toISOString(), template_id: CANARY_TEMPLATE_ID, polls: [] };
  const flush = () => writeFileSync(logPath, JSON.stringify(log, null, 2));
  flush();
  console.log(`Canary watch log: ${logPath}`);
  for (let attempt = 1; ; attempt += 1) {
    const current = await metaCall(() => getWabaTemplate(CANARY_TEMPLATE_ID));
    const entry = {
      at: new Date().toISOString(),
      attempt,
      status: current.status,
      rejected_reason: current.rejected_reason,
      has_button: templateHasOptOutButton(current),
    };
    (log.polls as unknown[]).push(entry);
    flush();
    console.log(`CANARY_WATCH ${attempt} ${current.status}`);
    const status = current.status.toUpperCase();
    if (status === "APPROVED") {
      if (!templateHasOptOutButton(current)) {
        log.result = "approved_without_button";
        flush();
        console.error("CANARY_REJECTED approved without opt-out button");
        return "rejected";
      }
      log.result = "approved";
      flush();
      console.log("CANARY_APPROVED");
      return "approved";
    }
    if (status === "REJECTED") {
      const reason = current.rejected_reason || "(no reason)";
      log.result = "rejected";
      log.rejected_reason = reason;
      const same = await reportRejectedVersions(admin, reason === "(no reason)" ? "" : reason);
      log.v2_same_reason = same;
      flush();
      console.error("CANARY_REJECTED", reason);
      return "rejected";
    }
    if (Date.now() - started >= WATCH_DEADLINE_MS) {
      log.result = "timeout";
      flush();
      console.error("CANARY_WATCH_TIMEOUT");
      return "timeout";
    }
    await sleep(WATCH_INTERVAL_MS);
  }
}

async function main() {
  const admin = createSupabaseAdminClient();
  if (CATEGORY_SYNC) {
    await runCategorySync(admin);
    if (!ONLY_NEW_VERSION && !WATCH_CANARY && !EXECUTE && !ONLY_DEFERRED && !heldEdits) return;
  }
  if (WATCH_CANARY) {
    const decision = await pollCanary(admin);
    if (decision !== "approved") process.exit(decision === "timeout" ? 2 : 1);
    heldEdits = true;
  }
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
  console.log(
    ONLY_NEW_VERSION ? "Mode: new versions only" : heldEdits ? "Mode: held edits" : EXECUTE || ONLY_DEFERRED ? "Canary: acrobyjoe after_class" : "Canary (not run): acrobyjoe after_class"
  );
  console.log(`Estimated execute duration: ${Math.ceil(totals.estimated_duration_ms / 1000)}s`);
  console.log(`Report: ${OUT_PATH}`);

  if (EXECUTE || ONLY_DEFERRED || ONLY_NEW_VERSION || heldEdits) {
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
