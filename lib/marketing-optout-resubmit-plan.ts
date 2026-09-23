/**
 * Classifies existing MARKETING templates for an opt-out button resubmit.
 * Pure: no Meta or DB calls. The script applies this per WABA.
 */
import {
  isMarketingOptOutButtonText,
  withMarketingOptOutButton,
} from "@/lib/meta-marketing-opt-out-button";

export const OPTOUT_RESUBMIT_THROTTLE_MS = 2000;

/** Owner account alerts. Never edited and never copied to _v2. */
export const ACCOUNT_ALERT_TEMPLATE_NAMES = new Set(["quota_warning_80", "quota_limit_reached"]);

export type OptOutPlanClass =
  | "EDIT_IN_PLACE"
  | "NEW_VERSION"
  | "DEFERRED"
  | "MANUAL"
  | "EXCLUDED_ACCOUNT_ALERT"
  | "SKIP_HAS_BUTTON"
  | "SKIP_HAS_VERSION";

export type OptOutPlanTemplate = {
  name: string;
  language: string;
  status: string;
  category: string;
  components?: unknown[];
};

export type OptOutPlanItem = {
  name: string;
  language: string;
  status: string;
  in_use: boolean;
  class: OptOutPlanClass;
  reason?: string;
  planned_name?: string;
};

const DEFERRED_STATUSES = new Set(["PENDING", "IN_APPEAL"]);
const EDIT_IN_PLACE_STATUSES = new Set(["APPROVED", "REJECTED", "PAUSED"]);

function buttonTexts(components: unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const component of components ?? []) {
    if (!component || typeof component !== "object") continue;
    const type = String((component as { type?: unknown }).type ?? "").toUpperCase();
    if (type !== "BUTTONS") continue;
    const buttons = (component as { buttons?: unknown[] }).buttons;
    if (!Array.isArray(buttons)) continue;
    for (const button of buttons) {
      if (!button || typeof button !== "object") continue;
      out.push(String((button as { text?: unknown }).text ?? ""));
    }
  }
  return out;
}

export function templateHasOptOutButton(template: OptOutPlanTemplate): boolean {
  return buttonTexts(template.components).some((text) => isMarketingOptOutButtonText(text));
}

export function nextVersionTemplateName(name: string, taken: Set<string>): string {
  let n = 2;
  while (taken.has(`${name}_v${n}`)) n += 1;
  return `${name}_v${n}`;
}

function versionWithButton(
  template: OptOutPlanTemplate,
  all: OptOutPlanTemplate[]
): string | null {
  const prefix = `${template.name}_v`;
  const language = template.language.trim().toLowerCase();
  for (const other of all) {
    if (other.language.trim().toLowerCase() !== language) continue;
    if (!other.name.startsWith(prefix)) continue;
    const suffix = other.name.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    if (templateHasOptOutButton(other)) return other.name;
  }
  return null;
}

export function classifyMarketingOptOutTemplate(input: {
  template: OptOutPlanTemplate;
  inUse: boolean;
  takenNames: Set<string>;
  allOnWaba: OptOutPlanTemplate[];
}): OptOutPlanItem {
  const status = input.template.status.trim().toUpperCase();
  const base = {
    name: input.template.name,
    language: input.template.language,
    status,
    in_use: input.inUse,
  };

  if (ACCOUNT_ALERT_TEMPLATE_NAMES.has(input.template.name)) {
    return { ...base, class: "EXCLUDED_ACCOUNT_ALERT", reason: "owner_account_alert" };
  }

  if (templateHasOptOutButton(input.template)) {
    return { ...base, class: "SKIP_HAS_BUTTON" };
  }

  const existingVersion = versionWithButton(input.template, input.allOnWaba);
  if (existingVersion) {
    return { ...base, class: "SKIP_HAS_VERSION", planned_name: existingVersion };
  }

  if (!Array.isArray(input.template.components)) {
    return { ...base, class: "MANUAL", reason: "missing_components" };
  }

  const next = withMarketingOptOutButton(input.template.components, input.template.language);
  const added = templateHasOptOutButton({ ...input.template, components: next });
  if (!added || JSON.stringify(next) === JSON.stringify(input.template.components)) {
    return { ...base, class: "MANUAL", reason: "button_not_added" };
  }

  if (DEFERRED_STATUSES.has(status)) {
    return { ...base, class: "DEFERRED" };
  }

  if (status === "APPROVED" && input.inUse) {
    const planned = nextVersionTemplateName(input.template.name, input.takenNames);
    return { ...base, class: "NEW_VERSION", planned_name: planned };
  }

  if (EDIT_IN_PLACE_STATUSES.has(status)) {
    return { ...base, class: "EDIT_IN_PLACE" };
  }

  return { ...base, class: "MANUAL", reason: `status_${status || "unknown"}` };
}

export function countPlan(items: OptOutPlanItem[]): Record<OptOutPlanClass, number> {
  const counts: Record<OptOutPlanClass, number> = {
    EDIT_IN_PLACE: 0,
    NEW_VERSION: 0,
    DEFERRED: 0,
    MANUAL: 0,
    EXCLUDED_ACCOUNT_ALERT: 0,
    SKIP_HAS_BUTTON: 0,
    SKIP_HAS_VERSION: 0,
  };
  for (const item of items) counts[item.class] += 1;
  return counts;
}

export function plannedWriteCalls(items: OptOutPlanItem[]): number {
  return items.filter((item) => item.class === "EDIT_IN_PLACE" || item.class === "NEW_VERSION").length;
}

/** Parallel across WABAs, sequential inside one. Duration is the slowest WABA. */
export function estimatedDurationMs(writeCallsPerWaba: number[]): number {
  const slowest = writeCallsPerWaba.reduce((max, n) => Math.max(max, n), 0);
  return slowest * OPTOUT_RESUBMIT_THROTTLE_MS;
}
