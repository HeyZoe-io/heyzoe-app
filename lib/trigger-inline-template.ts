/**
 * Pure helpers for inline template+trigger creation (Option A) in the trigger card.
 * Runtime gated/PENDING behavior is unchanged — these only drive UI defaults and status display.
 */
import {
  TEMPLATE_PRESETS,
  uniqueTemplateName,
} from "@/lib/template-presets";
import type { TriggerType } from "@/lib/trigger-catalog";
import {
  EMPTY_TEMPLATE_BUTTONS,
  type TemplateDraftValue,
} from "@/app/[slug]/templates/TemplateDraftFields";

export type TriggerTemplateMode = "create_new" | "use_existing";

/** Prefer create-new (unified flow); use-existing when returning with a known template name. */
export function defaultTriggerTemplateMode(input: {
  preferExistingName?: string | null;
  hasApprovedTemplate?: boolean;
}): TriggerTemplateMode {
  const prefer = String(input.preferExistingName ?? "").trim();
  if (prefer) return "use_existing";
  // If the studio already has an approved template, keep "use existing" one click away
  // but still default to create-new so first-time setup stays one flow.
  void input.hasApprovedTemplate;
  return "create_new";
}

/** Full Meta template draft from TEMPLATE_PRESETS — same shape as the standalone creator. */
export function buildInlineTemplateDraft(
  triggerType: TriggerType,
  existingTemplateNames: readonly string[]
): TemplateDraftValue | null {
  const preset = TEMPLATE_PRESETS[triggerType];
  if (!preset) return null;
  return {
    name: uniqueTemplateName(
      preset.name,
      existingTemplateNames.map((n) => String(n ?? ""))
    ),
    category: preset.category,
    body: preset.body,
    language: "he",
    header: "",
    footer: "",
    buttons: preset.button_text
      ? [{ kind: "QUICK_REPLY", text: String(preset.button_text).trim(), url: "" }]
      : [...EMPTY_TEMPLATE_BUTTONS],
  };
}

export function templateStatusForTriggerName(
  templates: readonly { name: string; status: string; disabled?: boolean }[],
  templateName: string | null | undefined
): string | null {
  const name = String(templateName ?? "").trim();
  if (!name) return null;
  const row = templates.find((t) => String(t.name ?? "").trim() === name);
  if (!row || row.disabled === true) return null;
  return String(row.status ?? "").trim().toUpperCase() || null;
}

/** Pill on the trigger card — reflects Meta status only; no new runtime gate. */
export function shouldShowTriggerPendingPill(templateStatus: string | null): boolean {
  return templateStatus === "PENDING";
}

export function isApprovedTemplateRow(row: {
  status: string;
  disabled?: boolean;
}): boolean {
  if (row.disabled === true) return false;
  return String(row.status ?? "").toUpperCase() === "APPROVED";
}
