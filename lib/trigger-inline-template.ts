/**
 * Pure helpers for inline template+trigger creation (Option A) in the trigger card.
 * Runtime gated/PENDING behavior is unchanged — these only drive UI defaults and status display.
 */
import {
  TEMPLATE_PRESETS,
  uniqueTemplateName,
  type TemplatePresetCategory,
} from "@/lib/template-presets";
import type { TriggerType } from "@/lib/trigger-catalog";

export type TriggerTemplateMode = "create_new" | "use_existing";

export type InlineTemplateDraft = {
  name: string;
  category: TemplatePresetCategory;
  body: string;
  buttonText: string;
  language: string;
};

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

export function buildInlineTemplateDraft(
  triggerType: TriggerType,
  existingTemplateNames: readonly string[]
): InlineTemplateDraft | null {
  const preset = TEMPLATE_PRESETS[triggerType];
  if (!preset) return null;
  return {
    name: uniqueTemplateName(
      preset.name,
      existingTemplateNames.map((n) => String(n ?? ""))
    ),
    category: preset.category,
    body: preset.body,
    buttonText: String(preset.button_text ?? "").trim(),
    language: "he",
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
