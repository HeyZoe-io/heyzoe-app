/** Shared trigger_type catalogs for API + tests (Arbox vs non-Arbox). */

export const ARBOX_TRIGGER_TYPES = [
  "purchase",
  "credit_refusal",
  "trial_attended",
  "birthday",
  "membership_expiring",
  "sessions_expiring",
] as const;

export const NON_ARBOX_TRIGGER_TYPES = ["site_lead", "no_response"] as const;

export const TRIGGER_TYPES = [...ARBOX_TRIGGER_TYPES, ...NON_ARBOX_TRIGGER_TYPES] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

export function isTriggerType(value: string): value is TriggerType {
  return (TRIGGER_TYPES as readonly string[]).includes(value);
}

export function isArboxDependentTriggerType(value: TriggerType): boolean {
  return (ARBOX_TRIGGER_TYPES as readonly string[]).includes(value);
}
