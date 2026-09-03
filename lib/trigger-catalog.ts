/** Single source of truth for template-trigger types, labels, and UI/API rules. */

export type TriggerCategory =
  | "leads"
  | "memberships"
  | "retention"
  | "trials"
  | "birthdays";

export type TriggerDelayMode = "after" | "before" | "either";
export type TriggerRecipient = "customer" | "staff";
export type TriggerUniqueCreateMode = "hide" | "warn";
export type DelayDirection = "after" | "before";

type TriggerCatalogEntryShape = {
  type: string;
  labelHe: string;
  category: TriggerCategory;
  arboxOnly: boolean;
  delay: TriggerDelayMode;
  showProductFilter: boolean;
  uniquePerBusiness: boolean;
  uniqueCreateMode?: TriggerUniqueCreateMode;
  minDelayDays: number;
  recipient: TriggerRecipient;
  presetKey: string;
  uiOrder: number;
  sendHintHe: string;
};

const SEND_HINT_FREQUENT_HE =
  "נשלח עד כ־15 דקות אחרי האירוע, בכל שעות היום";
const SEND_HINT_DAILY_HE = "נשלח פעם ביום בשעת הקרון הקבועה";
const SEND_HINT_WEBHOOK_HE = "נשלח מיד כשמגיע ליד מהאתר או מהקמפיין";

/**
 * Canonical catalog. Array order = historical TRIGGER_TYPES
 * (Arbox types, then non-Arbox). Dropdown order is `uiOrder`.
 */
export const TRIGGER_CATALOG = [
  {
    type: "purchase",
    labelHe: "רכישה",
    category: "memberships",
    arboxOnly: true,
    delay: "after",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "purchase",
    uiOrder: 4,
    sendHintHe: SEND_HINT_FREQUENT_HE,
  },
  {
    type: "credit_refusal",
    labelHe: "סירוב אשראי",
    category: "memberships",
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "credit_refusal",
    uiOrder: 5,
    sendHintHe: SEND_HINT_FREQUENT_HE,
  },
  {
    type: "trial_attended",
    labelHe: "נוכחות בשיעור ניסיון",
    category: "trials",
    arboxOnly: true,
    delay: "after",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "trial_attended",
    uiOrder: 6,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "birthday",
    labelHe: "יום הולדת",
    category: "birthdays",
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "birthday",
    uiOrder: 7,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "membership_expiring",
    labelHe: "פג תוקף מנוי",
    category: "memberships",
    arboxOnly: true,
    delay: "either",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "membership_expiring",
    uiOrder: 8,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "sessions_expiring",
    labelHe: "פג תוקף כרטיסיה",
    category: "memberships",
    arboxOnly: true,
    delay: "either",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "sessions_expiring",
    uiOrder: 9,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "arbox_new_lead",
    labelHe: "ליד חדש מארבוקס",
    category: "leads",
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: true,
    uniqueCreateMode: "warn",
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "arbox_new_lead",
    uiOrder: 2,
    sendHintHe: SEND_HINT_FREQUENT_HE,
  },
  {
    type: "membership_cancelled",
    labelHe: "ביטול מנוי",
    category: "memberships",
    arboxOnly: true,
    delay: "after",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "membership_cancelled",
    uiOrder: 10,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "incoming_lead",
    labelHe: "ליד מאתר/קמפיין",
    category: "leads",
    arboxOnly: false,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: true,
    uniqueCreateMode: "hide",
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "incoming_lead",
    uiOrder: 1,
    sendHintHe: SEND_HINT_WEBHOOK_HE,
  },
  {
    type: "no_response",
    labelHe: "חזרה אחרי שתיקה",
    category: "retention",
    arboxOnly: false,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 2,
    recipient: "customer",
    presetKey: "no_response",
    uiOrder: 3,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
] as const satisfies readonly TriggerCatalogEntryShape[];

export type TriggerCatalogEntry = (typeof TRIGGER_CATALOG)[number];
export type TriggerType = TriggerCatalogEntry["type"];

export const ARBOX_TRIGGER_TYPES = TRIGGER_CATALOG.filter((e) => e.arboxOnly).map(
  (e) => e.type
);
export const NON_ARBOX_TRIGGER_TYPES = TRIGGER_CATALOG.filter((e) => !e.arboxOnly).map(
  (e) => e.type
);
export const TRIGGER_TYPES = TRIGGER_CATALOG.map((e) => e.type);

export const TRIGGER_TYPE_OPTIONS: { value: TriggerType; label: string }[] = [...TRIGGER_CATALOG]
  .sort((a, b) => a.uiOrder - b.uiOrder)
  .map((e) => ({ value: e.type, label: e.labelHe }));

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

export type IncomingLeadTriggerType = (typeof INCOMING_LEAD_TRIGGER_TYPES)[number];

const CATALOG_BY_TYPE = new Map<string, TriggerCatalogEntry>(
  TRIGGER_CATALOG.map((e) => [e.type, e])
);

/** True for canonical incoming_lead and legacy site_lead / campaign_lead. */
export function isIncomingLeadTriggerType(value: string): boolean {
  return (INCOMING_LEAD_TRIGGER_TYPES_RESOLVE as readonly string[]).includes(value);
}

/** Map legacy site_lead / campaign_lead → incoming_lead for API/UI. */
export function canonicalizeTriggerType(value: string): string {
  if ((LEGACY_INCOMING_LEAD_TRIGGER_TYPES as readonly string[]).includes(value)) {
    return "incoming_lead";
  }
  return value;
}

export function triggerCatalogEntry(triggerType: string): TriggerCatalogEntry | undefined {
  return CATALOG_BY_TYPE.get(canonicalizeTriggerType(triggerType));
}

export function isTriggerType(value: string): value is TriggerType {
  return CATALOG_BY_TYPE.has(value);
}

export function isArboxDependentTriggerType(value: TriggerType): boolean {
  return triggerCatalogEntry(value)?.arboxOnly === true;
}

/** Dropdown/create: Arbox-native types (incl. arbox_new_lead) only when CRM=arbox. */
export function isCreatableTriggerType(value: string, hasArbox: boolean): boolean {
  if (!isTriggerType(value)) return false;
  if (!hasArbox && isArboxDependentTriggerType(value)) return false;
  return true;
}

/**
 * Event-based types whose send time is after the event.
 * Birthday stores `after` in the UI but must NOT coerce a stored `before` (legacy quirk).
 */
export function forcesDelayAfter(triggerType: string): boolean {
  const e = triggerCatalogEntry(triggerType);
  if (!e) return false;
  return e.delay === "after" && e.type !== "birthday";
}

/** Expiry reminders may fire before the end date; birthday UI is handled separately. */
export function allowsDelayBefore(triggerType: string): boolean {
  return triggerCatalogEntry(triggerType)?.delay === "either";
}

export function delayDirectionForTrigger(
  triggerType: string,
  stored: string | null | undefined
): DelayDirection {
  if (forcesDelayAfter(triggerType)) return "after";
  const d = String(stored ?? "").trim().toLowerCase();
  return d === "before" ? "before" : "after";
}

export function showsProductFilter(triggerType: string): boolean {
  return triggerCatalogEntry(triggerType)?.showProductFilter === true;
}

export function minDelayDaysForTrigger(triggerType: string): number {
  return triggerCatalogEntry(triggerType)?.minDelayDays ?? 0;
}

export function defaultDelayDays(triggerType: string): number {
  return minDelayDaysForTrigger(triggerType);
}

export function defaultDelayDirection(triggerType: string): DelayDirection {
  return allowsDelayBefore(triggerType) ? "before" : "after";
}

export function uniqueCreateModeFor(
  triggerType: string
): TriggerUniqueCreateMode | undefined {
  const e = triggerCatalogEntry(triggerType);
  if (!e || !("uniqueCreateMode" in e)) return undefined;
  return e.uniqueCreateMode;
}

export function isUniquePerBusinessTriggerType(triggerType: string): boolean {
  return triggerCatalogEntry(triggerType)?.uniquePerBusiness === true;
}

/** incoming_lead (and legacy) / no_response / arbox_new_lead: force after + no product_filter. */
export function forcesAfterNoProductFilter(triggerType: string): boolean {
  const e = triggerCatalogEntry(triggerType);
  if (!e) return false;
  return !e.showProductFilter && (e.uniquePerBusiness || e.minDelayDays > 0);
}

export function triggerTypeLabel(triggerType: string): string {
  const e = triggerCatalogEntry(triggerType);
  return e?.labelHe ?? triggerType;
}

/** Read-only cron send-time hint for the dashboard (not a user setting). */
export function triggerSendScheduleHintHe(triggerType: string): string {
  return triggerCatalogEntry(triggerType)?.sendHintHe ?? "";
}

export function formatDelayLabel(
  type: string,
  days: number,
  direction: DelayDirection
): string {
  if (type === "no_response") {
    return `${Math.max(2, days)} ימי שתיקה`;
  }
  if (isIncomingLeadTriggerType(type) || type === "arbox_new_lead") {
    return days === 0 ? "מיידי" : `${days} ימים אחרי הליד`;
  }
  if (type === "birthday") {
    return days === 0 ? "ביום ההולדת" : `${days} ימים לפני יום ההולדת`;
  }
  if (allowsDelayBefore(type)) {
    if (days === 0) return "ביום פקיעת התוקף";
    const dir = direction === "before" ? "לפני פקיעת התוקף" : "אחרי פקיעת התוקף";
    return `${days} ימים ${dir}`;
  }
  if (days === 0) return "ביום האירוע";
  return `${days} ימים אחרי האירוע`;
}
