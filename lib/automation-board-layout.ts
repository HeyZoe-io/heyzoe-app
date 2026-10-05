import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import {
  isIncomingLeadTriggerType,
  triggerCatalogEntry,
  triggerTypeLabel,
} from "@/lib/trigger-catalog";

export type AutomationTemplateRef = {
  name: string;
  category?: string | null;
};

export type AutomationTriggerRef = {
  trigger_type: string;
  template_name?: string | null;
  created_at?: string;
};

export type AutomationBoardPiece<TTemplate, TTrigger> =
  | { kind: "template"; template: TTemplate }
  | { kind: "trigger"; trigger: TTrigger };

/** Legacy site_lead / campaign_lead share the incoming-lead catalog slot. */
export function canonicalAutomationType(triggerType: string): string {
  return isIncomingLeadTriggerType(triggerType) ? "incoming_lead" : triggerType;
}

function presetTypeForTemplateName(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  let best: { type: string; len: number } | null = null;
  for (const [type, preset] of Object.entries(TEMPLATE_PRESETS)) {
    const base = preset.name.trim().toLowerCase();
    if (!base || !normalized.startsWith(base)) continue;
    const suffix = normalized.slice(base.length);
    if (suffix !== "" && !/^\d+$/.test(suffix)) continue;
    if (!best || base.length > best.len) best = { type, len: base.length };
  }
  return best?.type ?? null;
}

/** Group key: linked trigger type, else preset name, else Meta category. */
export function templateAutomationGroupKey(
  template: AutomationTemplateRef,
  triggers: readonly AutomationTriggerRef[]
): string {
  const name = template.name.trim();
  const linked = triggers.filter((row) => String(row.template_name ?? "").trim() === name);
  if (linked.length > 0) {
    linked.sort((a, b) => {
      const orderA = triggerCatalogEntry(canonicalAutomationType(a.trigger_type))?.uiOrder ?? 999;
      const orderB = triggerCatalogEntry(canonicalAutomationType(b.trigger_type))?.uiOrder ?? 999;
      return orderA - orderB;
    });
    return `type:${canonicalAutomationType(linked[0]!.trigger_type)}`;
  }
  const preset = presetTypeForTemplateName(name);
  if (preset) return `type:${preset}`;
  const category = String(template.category ?? "").trim().toUpperCase() || "OTHER";
  return `category:${category}`;
}

function templateGroupSortValue(key: string): number {
  if (key.startsWith("type:")) {
    return triggerCatalogEntry(key.slice(5))?.uiOrder ?? 800;
  }
  if (key === "category:UTILITY") return 1000;
  if (key === "category:MARKETING") return 1001;
  return 1100;
}

export function templateAutomationGroupLabel(key: string): string {
  if (key.startsWith("type:")) return triggerTypeLabel(key.slice(5));
  if (key === "category:UTILITY") return "Utility";
  if (key === "category:MARKETING") return "Marketing";
  return "אחר";
}

export function groupTemplatesForBoard<T extends AutomationTemplateRef>(
  templates: readonly T[],
  triggers: readonly AutomationTriggerRef[]
): { key: string; label: string; items: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const template of templates) {
    const key = templateAutomationGroupKey(template, triggers);
    const list = buckets.get(key);
    if (list) list.push(template);
    else buckets.set(key, [template]);
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      const orderA = templateGroupSortValue(a[0]);
      const orderB = templateGroupSortValue(b[0]);
      if (orderA !== orderB) return orderA - orderB;
      return a[0].localeCompare(b[0]);
    })
    .map(([key, items]) => ({
      key,
      label: templateAutomationGroupLabel(key),
      items,
    }));
}

export function groupTriggersByType<T extends AutomationTriggerRef>(
  triggers: readonly T[]
): { type: string; triggers: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const trigger of triggers) {
    const type = canonicalAutomationType(trigger.trigger_type);
    const list = buckets.get(type);
    if (list) list.push(trigger);
    else buckets.set(type, [trigger]);
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      const orderA = triggerCatalogEntry(a[0])?.uiOrder ?? 999;
      const orderB = triggerCatalogEntry(b[0])?.uiOrder ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a[0].localeCompare(b[0]);
    })
    .map(([type, items]) => ({
      type,
      triggers: [...items].sort((a, b) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
      ),
    }));
}

/**
 * Same-type triggers and the templates they send sit next to each other.
 * A shared template is placed once, beside the earliest trigger that uses it.
 */
export function interleaveTriggersAndTemplates<
  TTemplate extends { name: string },
  TTrigger extends { template_name?: string | null },
>(
  triggers: readonly TTrigger[],
  templates: readonly TTemplate[]
): AutomationBoardPiece<TTemplate, TTrigger>[] {
  const byName = new Map(templates.map((template) => [template.name, template]));
  const used = new Set<string>();
  const items: AutomationBoardPiece<TTemplate, TTrigger>[] = [];
  for (const trigger of triggers) {
    items.push({ kind: "trigger", trigger });
    const name = String(trigger.template_name ?? "").trim();
    const template = name ? byName.get(name) : undefined;
    if (template && !used.has(template.name)) {
      items.push({ kind: "template", template });
      used.add(template.name);
    }
  }
  for (const template of templates) {
    if (!used.has(template.name)) items.push({ kind: "template", template });
  }
  return items;
}
