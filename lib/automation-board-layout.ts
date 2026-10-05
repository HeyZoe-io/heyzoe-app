import { TEMPLATE_PRESETS } from "@/lib/template-presets";
import { isIncomingLeadTriggerType, triggerCatalogEntry } from "@/lib/trigger-catalog";

export type AutomationTemplateRef = {
  name: string;
  category?: string | null;
};

export type AutomationTriggerRef = {
  trigger_type: string;
  template_name?: string | null;
};

/** Legacy site_lead / campaign_lead share the incoming-lead type. */
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

/** Linked trigger type, else preset name, else Meta category. */
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

/**
 * Keep the original sequence, and pull later items of the same key up
 * so they sit directly under the first one.
 */
export function stackSameType<T>(items: readonly T[], keyFn: (item: T) => string): T[] {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = keyFn(item);
    const list = buckets.get(key);
    if (list) list.push(item);
    else {
      buckets.set(key, [item]);
      order.push(key);
    }
  }
  return order.flatMap((key) => buckets.get(key) ?? []);
}
