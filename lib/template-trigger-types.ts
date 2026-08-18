/** Shared trigger_type catalogs for API + tests (Arbox vs non-Arbox). */

export const ARBOX_TRIGGER_TYPES = [
  "purchase",
  "credit_refusal",
  "trial_attended",
  "birthday",
  "membership_expiring",
  "sessions_expiring",
  "arbox_new_lead",
] as const;

export const NON_ARBOX_TRIGGER_TYPES = ["incoming_lead", "no_response"] as const;

/** Canonical type for /api/leads/incoming webhook automation. */
export const INCOMING_LEAD_TRIGGER_TYPES = ["incoming_lead"] as const;

/**
 * Legacy DB values (pre-merge site_lead / campaign_lead) — still resolved and
 * counted for uniqueness until migration updates rows.
 */
export const LEGACY_INCOMING_LEAD_TRIGGER_TYPES = ["site_lead", "campaign_lead"] as const;

/** All DB trigger_type values that mean "incoming lead" for load/uniqueness. */
export const INCOMING_LEAD_TRIGGER_TYPES_RESOLVE = [
  ...INCOMING_LEAD_TRIGGER_TYPES,
  ...LEGACY_INCOMING_LEAD_TRIGGER_TYPES,
] as const;

export const TRIGGER_TYPES = [...ARBOX_TRIGGER_TYPES, ...NON_ARBOX_TRIGGER_TYPES] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

export type IncomingLeadTriggerType = (typeof INCOMING_LEAD_TRIGGER_TYPES)[number];

export function isTriggerType(value: string): value is TriggerType {
  return (TRIGGER_TYPES as readonly string[]).includes(value);
}

export function isArboxDependentTriggerType(value: TriggerType): boolean {
  return (ARBOX_TRIGGER_TYPES as readonly string[]).includes(value);
}

/** Dropdown/create: Arbox-native types (incl. arbox_new_lead) only when CRM=arbox. */
export function isCreatableTriggerType(value: string, hasArbox: boolean): boolean {
  if (!isTriggerType(value)) return false;
  if (!hasArbox && isArboxDependentTriggerType(value)) return false;
  return true;
}

/** True for canonical incoming_lead and legacy site_lead / campaign_lead. */
export function isIncomingLeadTriggerType(value: string): boolean {
  return (INCOMING_LEAD_TRIGGER_TYPES_RESOLVE as readonly string[]).includes(value);
}

/** Map legacy site_lead / campaign_lead → incoming_lead for API/UI. */
export function canonicalizeTriggerType(value: string): string {
  if (
    (LEGACY_INCOMING_LEAD_TRIGGER_TYPES as readonly string[]).includes(value)
  ) {
    return "incoming_lead";
  }
  return value;
}

const TRIGGER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** template_triggers.id is uuid — do not coerce with Number() (NaN). */
export function parseTriggerId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!TRIGGER_UUID_RE.test(s)) return null;
  return s;
}
