/** Single source of truth for template-trigger types, labels, and UI/API rules. */

export type TriggerActivation = "automatic" | "manual";
export type TriggerAudience = "leads" | "members" | "staff";
export type TriggerDelayMode = "after" | "before" | "either" | "none";
export type TriggerRecipient = "customer" | "staff";
export type TriggerUniqueCreateMode = "hide" | "warn";
export type DelayDirection = "after" | "before";

/** Maps catalog manual types → M1 audience_type (backend). */
export type ManualBulkAudienceType = "membership" | "talked_not_registered";

type TriggerCatalogEntryShape = {
  type: string;
  labelHe: string;
  activation: TriggerActivation;
  audience: TriggerAudience;
  /** Live feature vs planned «בקרוב» card (no toggle / no send). */
  implemented: boolean;
  arboxOnly: boolean;
  delay: TriggerDelayMode;
  showProductFilter: boolean;
  uniquePerBusiness: boolean;
  uniqueCreateMode?: TriggerUniqueCreateMode;
  minDelayDays: number;
  recipient: TriggerRecipient;
  /** Preset key for live automatic types; empty for manual / planned. */
  presetKey: string;
  uiOrder: number;
  sendHintHe: string;
  /** Only for activation=manual + implemented — maps to M1 audience_type. */
  manualAudienceType?: ManualBulkAudienceType;
};

const SEND_HINT_FREQUENT_HE =
  "נשלח עד כ־15 דקות אחרי האירוע, בכל שעות היום";
const SEND_HINT_DAILY_HE = "נשלח פעם ביום בשעת הקרון הקבועה";
const SEND_HINT_WEBHOOK_HE = "נשלח מיד כשמגיע ליד מהאתר או מהקמפיין";
const SEND_HINT_MANUAL_HE = "שליחה ידנית — תצוגה מקדימה, אישור, ותזמון לתור";
const SEND_HINT_PLANNED_HE = "בקרוב";

/**
 * Canonical catalog (live + planned + manual).
 * Array order for live automatic types matches historical TRIGGER_TYPES
 * (Arbox types, then non-Arbox), then birthday_former, then planned/manual.
 * Dropdown order is `uiOrder` among creatable types.
 */
export const TRIGGER_CATALOG = [
  // —— Live automatic (persisted trigger_type) ——
  {
    type: "purchase",
    labelHe: "רכישה",
    activation: "automatic",
    audience: "members",
    implemented: true,
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
    activation: "automatic",
    audience: "members",
    implemented: true,
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
    activation: "automatic",
    audience: "leads",
    implemented: true,
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
    labelHe: "יום הולדת (מנויים)",
    activation: "automatic",
    audience: "members",
    implemented: true,
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
    activation: "automatic",
    audience: "members",
    implemented: true,
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
    activation: "automatic",
    audience: "members",
    implemented: true,
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
    activation: "automatic",
    audience: "leads",
    implemented: true,
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
    activation: "automatic",
    audience: "members",
    implemented: true,
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
    activation: "automatic",
    audience: "leads",
    implemented: true,
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
    activation: "automatic",
    audience: "leads",
    implemented: true,
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
  {
    type: "birthday_former",
    labelHe: "יום הולדת (לקוחות לשעבר)",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "birthday_former",
    uiOrder: 11,
    sendHintHe: SEND_HINT_DAILY_HE,
  },

  // —— Planned automatic × members ——
  {
    type: "hold",
    labelHe: "הקפאת מנוי",
    activation: "automatic",
    audience: "members",
    implemented: false,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 20,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "freeze_ending",
    labelHe: "סיום הקפאה",
    activation: "automatic",
    audience: "members",
    implemented: false,
    arboxOnly: true,
    delay: "before",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 21,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "attendance_gap",
    labelHe: "פער נוכחות",
    activation: "automatic",
    audience: "members",
    implemented: false,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 22,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "no_show_regular",
    labelHe: "אי־הגעה לשיעור",
    activation: "automatic",
    audience: "members",
    implemented: false,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 23,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "attendance_trend",
    labelHe: "מגמת נוכחות",
    activation: "automatic",
    audience: "members",
    implemented: false,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 24,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "milestones",
    labelHe: "אבני דרך",
    activation: "automatic",
    audience: "members",
    implemented: false,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 25,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "class_reminder_regular",
    labelHe: "תזכורת לשיעור",
    activation: "automatic",
    audience: "members",
    implemented: false,
    arboxOnly: true,
    delay: "before",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 26,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },

  // —— Planned automatic × leads ——
  {
    type: "lost_lead",
    labelHe: "ליד אבוד",
    activation: "automatic",
    audience: "leads",
    implemented: false,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 30,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "trial_reminder",
    labelHe: "תזכורת לשיעור ניסיון",
    activation: "automatic",
    audience: "leads",
    implemented: false,
    arboxOnly: true,
    delay: "before",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 31,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "trial_no_show",
    labelHe: "אי־הגעה לשיעור ניסיון",
    activation: "automatic",
    audience: "leads",
    implemented: false,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 32,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
  {
    type: "post_trial_followup",
    labelHe: "מעקב אחרי ניסיון",
    activation: "automatic",
    audience: "leads",
    implemented: false,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 33,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },

  // —— Manual (M1) — not persisted on template_triggers ——
  {
    type: "manual_membership",
    labelHe: "שליחה לפי סוג מנוי",
    activation: "manual",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "none",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 40,
    sendHintHe: SEND_HINT_MANUAL_HE,
    manualAudienceType: "membership",
  },
  {
    type: "manual_talked_not_registered",
    labelHe: "דיברו עם זואי ולא נרשמו",
    activation: "manual",
    audience: "leads",
    implemented: true,
    arboxOnly: false,
    delay: "none",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 41,
    sendHintHe: SEND_HINT_MANUAL_HE,
    manualAudienceType: "talked_not_registered",
  },
  {
    type: "manual_lost_leads",
    labelHe: "קמפיין לידים אבודים",
    activation: "manual",
    audience: "leads",
    implemented: false,
    arboxOnly: true,
    delay: "none",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "",
    uiOrder: 42,
    sendHintHe: SEND_HINT_PLANNED_HE,
  },
] as const satisfies readonly TriggerCatalogEntryShape[];

export type TriggerCatalogEntry = (typeof TRIGGER_CATALOG)[number];
export type CatalogTriggerType = TriggerCatalogEntry["type"];

/** DB / API / presets — automatic + implemented only. */
export type TriggerType = Extract<
  TriggerCatalogEntry,
  { activation: "automatic"; implemented: true }
>["type"];

export const ARBOX_TRIGGER_TYPES = TRIGGER_CATALOG.filter(
  (e) => e.arboxOnly && e.activation === "automatic" && e.implemented
).map((e) => e.type) as TriggerType[];

export const NON_ARBOX_TRIGGER_TYPES = TRIGGER_CATALOG.filter(
  (e) => !e.arboxOnly && e.activation === "automatic" && e.implemented
).map((e) => e.type) as TriggerType[];

export const TRIGGER_TYPES = TRIGGER_CATALOG.filter(
  (e) => e.activation === "automatic" && e.implemented
).map((e) => e.type) as TriggerType[];

export const TRIGGER_TYPE_OPTIONS: { value: TriggerType; label: string }[] = [
  ...TRIGGER_CATALOG.filter((e) => e.activation === "automatic" && e.implemented),
]
  .sort((a, b) => a.uiOrder - b.uiOrder)
  .map((e) => ({ value: e.type as TriggerType, label: e.labelHe }));

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

const PERSISTED_TYPES = new Set<string>(TRIGGER_TYPES);

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

/** True for any catalog id (including manual / planned). */
export function isCatalogTriggerType(value: string): boolean {
  return CATALOG_BY_TYPE.has(canonicalizeTriggerType(value));
}

/**
 * Persisted automatic trigger_type only (template_triggers / presets).
 * Rejects manual_* and planned types.
 */
export function isTriggerType(value: string): value is TriggerType {
  return PERSISTED_TYPES.has(value);
}

export function isPersistedTriggerType(value: string): value is TriggerType {
  return isTriggerType(value);
}

export function isArboxDependentTriggerType(value: TriggerType | string): boolean {
  return triggerCatalogEntry(value)?.arboxOnly === true;
}

/** Dropdown/create: automatic + implemented; Arbox-native only when CRM=arbox. */
export function isCreatableTriggerType(value: string, hasArbox: boolean): boolean {
  if (!isTriggerType(value)) return false;
  const e = triggerCatalogEntry(value);
  if (!e || e.activation !== "automatic" || !e.implemented) return false;
  if (!hasArbox && e.arboxOnly) return false;
  return true;
}

export function catalogEntriesFor(input: {
  activation: TriggerActivation;
  audience: TriggerAudience;
}): TriggerCatalogEntry[] {
  return TRIGGER_CATALOG.filter(
    (e) => e.activation === input.activation && e.audience === input.audience
  ).sort((a, b) => a.uiOrder - b.uiOrder);
}

export function isBirthdayFamilyTriggerType(value: string): boolean {
  const t = canonicalizeTriggerType(value);
  return t === "birthday" || t === "birthday_former";
}

/**
 * Event-based types whose send time is after the event.
 * Birthday stores `after` in the UI but must NOT coerce a stored `before` (legacy quirk).
 */
export function forcesDelayAfter(triggerType: string): boolean {
  const e = triggerCatalogEntry(triggerType);
  if (!e || e.delay !== "after") return false;
  if (isBirthdayFamilyTriggerType(e.type)) return false;
  return true;
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
  if (isBirthdayFamilyTriggerType(type)) {
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

export const AUDIENCE_LABELS_HE: Record<TriggerAudience, string> = {
  leads: "לידים",
  members: "לקוחות",
  staff: "צוות",
};

export const ACTIVATION_LABELS_HE: Record<TriggerActivation, string> = {
  automatic: "אוטומטי",
  manual: "ידני",
};
