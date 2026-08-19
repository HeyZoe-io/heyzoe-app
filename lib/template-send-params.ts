import { firstNameFromFullName } from "@/lib/lead-template";
import type { OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import {
  bodyTextFromTemplateComponents,
  extractBodyVarCount,
  paramSlotsForTriggerType,
  type TemplateParamSlot,
} from "@/lib/template-presets";

export const TEMPLATE_NAME_FALLBACK = "שלום";
export const TEMPLATE_BUSINESS_NAME_FALLBACK = "הסטודיו";
export const TEMPLATE_EXPIRY_FALLBACK = "בקרוב";

export type TemplateSendParamContext = {
  triggerType: string;
  storedComponents?: unknown;
  firstName?: string | null;
  businessName?: string | null;
  expiryDateYmd?: string | null;
};

/** Israel-facing expiry for {{3}} (YYYY-MM-DD → DD.MM.YYYY). */
export function formatTemplateExpiryDate(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || TEMPLATE_EXPIRY_FALLBACK;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Last YYYY-MM-DD segment of membership/sessions expiring dedup keys. */
export function expiryYmdFromScheduledDedupKey(dedupKey: string): string | null {
  const key = String(dedupKey ?? "").trim();
  if (!key.startsWith("membership_expiring:") && !key.startsWith("sessions_expiring:")) {
    return null;
  }
  const parts = key.split(":");
  const last = parts[parts.length - 1] ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : null;
}

/** Prefix of scheduled_template_sends.dedup_key → trigger_type (site_lead → incoming_lead). */
export function triggerTypeFromScheduledDedupKey(dedupKey: string): string | null {
  const prefix = String(dedupKey ?? "").split(":")[0]?.trim() || "";
  if (!prefix) return null;
  if (prefix === "site_lead") return "incoming_lead";
  return prefix;
}

export function resolveTemplateSlotValue(
  slot: TemplateParamSlot,
  ctx: TemplateSendParamContext
): string {
  if (slot === "first_name") {
    const fromFull = firstNameFromFullName(String(ctx.firstName ?? "").trim());
    return fromFull || TEMPLATE_NAME_FALLBACK;
  }
  if (slot === "business_name") {
    const name = String(ctx.businessName ?? "").trim();
    return name || TEMPLATE_BUSINESS_NAME_FALLBACK;
  }
  const formatted = formatTemplateExpiryDate(ctx.expiryDateYmd);
  return formatted || TEMPLATE_EXPIRY_FALLBACK;
}

export function resolveTemplateBodyParamValues(ctx: TemplateSendParamContext): string[] {
  const body = bodyTextFromTemplateComponents(ctx.storedComponents);
  const slots = paramSlotsForTriggerType(ctx.triggerType);
  const varCount = body ? extractBodyVarCount(body) : slots.length;
  if (varCount <= 0) return [];
  const values: string[] = [];
  for (let i = 0; i < varCount; i += 1) {
    const slot = slots[i] ?? (i === 0 ? "first_name" : slots[slots.length - 1] ?? "first_name");
    values.push(resolveTemplateSlotValue(slot, ctx));
  }
  return values;
}

export function buildTemplateSendBodyComponents(
  ctx: TemplateSendParamContext
): OwnerTemplateComponent[] | undefined {
  const values = resolveTemplateBodyParamValues(ctx);
  if (values.length === 0) return undefined;
  return [
    {
      type: "body",
      parameters: values.map((text) => ({ type: "text" as const, text })),
    },
  ];
}

export function templateSendPayload(ctx: TemplateSendParamContext): {
  sendComponents?: OwnerTemplateComponent[];
  bodyParams: string[];
} {
  const bodyParams = resolveTemplateBodyParamValues(ctx);
  return {
    sendComponents: buildTemplateSendBodyComponents(ctx),
    bodyParams,
  };
}
