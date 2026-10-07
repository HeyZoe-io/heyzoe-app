/** Single source of truth for template-trigger types, labels, and UI/API rules. */

export type TriggerActivation = "automatic" | "manual";
export type TriggerAudience = "leads" | "members" | "staff";
export type TriggerDelayMode = "after" | "before" | "either" | "none" | "gap_days";
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
  /** Upper bound. Absent means the editor does not cap the number. */
  maxDelayDays?: number;
  recipient: TriggerRecipient;
  /** Preset key for live automatic types; empty for manual / planned. */
  presetKey: string;
  uiOrder: number;
  sendHintHe: string;
  /**
   * Empty means no slot selector and the historical send time.
   * Only lead_status_changed sets this.
   */
  allowedSendSlots?: readonly ("next_run" | "morning" | "evening")[];
  /** Only for activation=manual + implemented — maps to M1 audience_type. */
  manualAudienceType?: ManualBulkAudienceType;
};

const SEND_HINT_FREQUENT_HE =
  "נשלח עד כ־15 דקות אחרי האירוע, בכל שעות היום";
const SEND_HINT_DAILY_HE = "נשלח פעם ביום בשעה 09:00 (שעון ישראל)";
const SEND_HINT_POST_TRIAL_NOT_REGISTERED_HE =
  "נשלח ב־09:00 (שעון ישראל). אם פוספס בבוקר — גם ב־20:30 באותו יום";
const SEND_HINT_LOST_LEAD_HE =
  "דיליי 0 נשלח עד כ-15 דקות אחרי שהליד מסומן אבוד בארבוקס. בין 21:00 ל-08:00 ההודעה ממתינה ל-08:00. דיליי של יום ומעלה נשלח ב-09:00 ביום היעד (שעון ישראל).";
const SEND_HINT_LEAD_STATUS_HE =
  "נבדק ב-09:00 וב-20:30 (שעון ישראל). אפשר לבחור בריצה הקרובה, רק ב-09:00, או רק ב-20:30. דיליי של יום ומעלה יוצא ביום היעד, בחלון שנבחר, ורק אם הליד עדיין בסטטוס.";
const SEND_HINT_TRIAL_CLASS_HE =
  "יוצא ב־09:00 (שעון ישראל). בכלל «בוקר השיעור», שיעור שמתחיל לפני 10:00 נשלח ב־20:30 בערב שלפני.";
const SEND_HINT_NO_RESPONSE_HE = "נשלח פעם ביום בשעה 11:00 (שעון ישראל)";
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
    delay: "none",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "purchase",
    uiOrder: 4.5,
    sendHintHe: SEND_HINT_FREQUENT_HE,
  },
  {
    type: "first_paid_purchase",
    labelHe: "הצטרפות ראשונה (מנוי/כרטיסייה)",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "none",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "first_paid_purchase",
    uiOrder: 4,
    sendHintHe: "נשלח פעם אחת, ברכישה הראשונה של מנוי או כרטיסייה (לא ניסיון)",
  },
  {
    type: "credit_refusal",
    labelHe: "סירוב אשראי",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "none",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "credit_refusal",
    uiOrder: 5,
    sendHintHe: SEND_HINT_FREQUENT_HE,
  },
  {
    type: "registered_after_trial",
    labelHe: "נרשם אחרי ניסיון",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "registered_after_trial",
    uiOrder: 6,
    sendHintHe:
      "השהייה 0 נשלחת תוך כ־15 דקות. השהייה של יום ומעלה נשלחת ב־09:00 (שעון ישראל)",
  },
  {
    type: "not_registered_after_trial",
    labelHe: "לא נרשם אחרי ניסיון",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 1,
    recipient: "customer",
    presetKey: "not_registered_after_trial",
    uiOrder: 7,
    sendHintHe: SEND_HINT_POST_TRIAL_NOT_REGISTERED_HE,
  },
  {
    type: "birthday",
    labelHe: "יום הולדת (מנויים)",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "either",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "birthday",
    uiOrder: 8,
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
    uiOrder: 9,
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
    uiOrder: 10,
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
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "arbox_new_lead",
    uiOrder: 3,
    sendHintHe: SEND_HINT_FREQUENT_HE,
  },
  {
    type: "membership_cancelled",
    labelHe: "ביטול מנוי",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "none",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "membership_cancelled",
    uiOrder: 10,
    sendHintHe: "נשלח עד כ־15 דקות אחרי הביטול, בין 08:00 ל־21:00 (שעון ישראל)",
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
    uniquePerBusiness: false,
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
    sendHintHe: SEND_HINT_NO_RESPONSE_HE,
  },
  {
    type: "birthday_former",
    labelHe: "יום הולדת (לקוחות לשעבר)",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "either",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "birthday_former",
    uiOrder: 11,
    sendHintHe: SEND_HINT_DAILY_HE,
  },

  {
    type: "freeze_created",
    labelHe: "הקפאת מנוי",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "none",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "freeze_created",
    uiOrder: 15,
    sendHintHe: "נשלח עד כ־15 דקות אחרי רישום ההקפאה, בין 08:00 ל־21:00 (שעון ישראל)",
  },
  {
    type: "freeze_ending_unbooked",
    labelHe: "סיום הקפאה (בלי הזמנה)",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "before",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "freeze_ending_unbooked",
    uiOrder: 16,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "freeze_ending_booked",
    labelHe: "סיום הקפאה (עם הזמנה)",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "before",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "freeze_ending_booked",
    uiOrder: 17,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "attendance_gap",
    labelHe: "פער נוכחות ללא רישום עתידי",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "gap_days",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 1,
    maxDelayDays: 28,
    recipient: "customer",
    presetKey: "attendance_gap",
    uiOrder: 13,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "missed_class",
    labelHe: "אי־הגעה לשיעור",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "missed_class",
    uiOrder: 12,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "milestones",
    labelHe: "ימים במועדון",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 1,
    recipient: "customer",
    presetKey: "milestones",
    uiOrder: 14,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "nth_workout",
    labelHe: "אימון מספר N (לקוח חדש)",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "either",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 1,
    recipient: "customer",
    presetKey: "nth_workout",
    uiOrder: 18,
    sendHintHe: SEND_HINT_DAILY_HE,
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
    labelHe: "win-back לליד אבוד (ארבוקס)",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "lost_lead",
    uiOrder: 30,
    sendHintHe: SEND_HINT_LOST_LEAD_HE,
  },
  {
    type: "lead_status_changed",
    labelHe: "ליד ללא מענה (ארבוקס)",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "lead_status_changed",
    uiOrder: 31,
    sendHintHe: SEND_HINT_LEAD_STATUS_HE,
    allowedSendSlots: ["next_run", "morning", "evening"],
  },
  {
    type: "trial_reminder",
    labelHe: "תזכורת לשיעור ניסיון",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "before",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    maxDelayDays: 13,
    recipient: "customer",
    presetKey: "trial_reminder",
    uiOrder: 2,
    sendHintHe: SEND_HINT_TRIAL_CLASS_HE,
  },
  {
    type: "trial_booked",
    labelHe: "נרשם לאימון ניסיון",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "none",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "trial_booked",
    uiOrder: 2.5,
    sendHintHe: SEND_HINT_FREQUENT_HE,
  },
  {
    type: "missed_trial",
    labelHe: "אי־הגעה לשיעור ניסיון",
    activation: "automatic",
    audience: "leads",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "missed_trial",
    uiOrder: 13,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "trainer_trial_heads_up",
    labelHe: "התראה למאמן — שיעור ניסיון",
    activation: "automatic",
    audience: "staff",
    implemented: true,
    arboxOnly: true,
    delay: "before",
    showProductFilter: true,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "staff",
    presetKey: "trainer_trial_heads_up",
    uiOrder: 1,
    sendHintHe: SEND_HINT_TRIAL_CLASS_HE,
  },
  {
    type: "class_cancelled_staff",
    labelHe: "ביטול שיעור (למאמן)",
    activation: "automatic",
    audience: "staff",
    implemented: true,
    arboxOnly: true,
    delay: "after",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "staff",
    presetKey: "class_cancelled_staff",
    uiOrder: 2,
    sendHintHe: SEND_HINT_DAILY_HE,
  },
  {
    type: "class_cancelled_customer",
    labelHe: "שיעור בוטל - הודעה לנרשמים",
    activation: "automatic",
    audience: "members",
    implemented: true,
    arboxOnly: true,
    delay: "none",
    showProductFilter: false,
    uniquePerBusiness: false,
    minDelayDays: 0,
    recipient: "customer",
    presetKey: "class_cancelled_customer",
    uiOrder: 16,
    sendHintHe:
      "נשלח עד כשעה אחרי הביטול. לא נשלח בלילה (23:00–06:30) או מסוף שישי 16:00 עד שבת 19:00",
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

export const LEAD_STATUS_SEND_SLOTS = ["next_run", "morning", "evening"] as const;
export type LeadStatusSendSlot = (typeof LEAD_STATUS_SEND_SLOTS)[number];

const SEND_SLOT_LABELS_HE: Record<LeadStatusSendSlot, string> = {
  next_run: "בריצה הקרובה (09:00 או 20:30)",
  morning: "רק ב-09:00",
  evening: "רק ב-20:30",
};

/** No slots means the trigger has no selector and keeps its historical send time. */
export function allowedSendSlots(type: string): readonly LeadStatusSendSlot[] {
  const canonical = canonicalizeTriggerType(type);
  const entry = TRIGGER_CATALOG.find((row) => row.type === canonical) as
    | { allowedSendSlots?: readonly LeadStatusSendSlot[] }
    | undefined;
  return entry?.allowedSendSlots ?? [];
}

export function sendSlotLabelHe(slot: string | null | undefined): string {
  if (slot === "morning" || slot === "evening" || slot === "next_run") return SEND_SLOT_LABELS_HE[slot];
  return SEND_SLOT_LABELS_HE.next_run;
}

/**
 * Null and omitted values mean next_run. A concrete slot on a type with no
 * selector is rejected. Changing the slot does not reset rule activation.
 */
export function parseSendSlotForTrigger(
  type: string,
  raw: unknown
): { ok: true; slot: LeadStatusSendSlot | null } | { ok: false; error: "send_slot_not_allowed" | "invalid_send_slot" } {
  if (raw == null || String(raw).trim() === "" || String(raw).trim() === "next_run") {
    return { ok: true, slot: null };
  }
  const value = String(raw).trim();
  const allowed = allowedSendSlots(type);
  if (!allowed.length) return { ok: false, error: "send_slot_not_allowed" };
  if (value !== "morning" && value !== "evening") return { ok: false, error: "invalid_send_slot" };
  return { ok: true, slot: value };
}

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

export function isStaffRecipientTriggerType(value: string): boolean {
  return triggerCatalogEntry(value)?.recipient === "staff";
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

/**
 * Create-dropdown options for one activation×audience cell.
 * Reads the catalog only — planned / manual / other-cell types never appear.
 * Prefer {@link creatableCatalogEntriesForCell} for the card UI (respects uniqueness).
 */
export function creatableTriggerOptionsForCell(input: {
  activation: TriggerActivation;
  audience: TriggerAudience;
  hasArbox: boolean;
}): { value: TriggerType; label: string }[] {
  return catalogEntriesFor({
    activation: input.activation,
    audience: input.audience,
  })
    .filter((e) => isCreatableTriggerType(e.type, input.hasArbox))
    .map((e) => ({ value: e.type as TriggerType, label: e.labelHe }));
}

/**
 * Implemented creatable catalog entries for a cell that should show a «צור טריגר» card.
 * Every type stays in the list so a business can add another rule of the same type.
 */
export function creatableCatalogEntriesForCell(input: {
  activation: TriggerActivation;
  audience: TriggerAudience;
  hasArbox: boolean;
  existingTriggerTypes: readonly string[];
}): TriggerCatalogEntry[] {
  const existingCanonical = new Set(
    input.existingTriggerTypes.map((t) => canonicalizeTriggerType(String(t ?? "").trim()))
  );
  const hasIncomingLead = input.existingTriggerTypes.some((t) =>
    isIncomingLeadTriggerType(String(t ?? ""))
  );

  return catalogEntriesFor({
    activation: input.activation,
    audience: input.audience,
  }).filter((e) => {
    if (!isCreatableTriggerType(e.type, input.hasArbox)) return false;
    if (!e.uniquePerBusiness) return true;
    if (e.type === "incoming_lead") return !hasIncomingLead;
    return !existingCanonical.has(e.type);
  });
}

/** Planned («בקרוב») entries for a cell — not implemented. */
export function plannedCatalogEntriesForCell(input: {
  activation: TriggerActivation;
  audience: TriggerAudience;
}): TriggerCatalogEntry[] {
  return catalogEntriesFor({
    activation: input.activation,
    audience: input.audience,
  }).filter((e) => !e.implemented);
}

export function isBirthdayFamilyTriggerType(value: string): boolean {
  const t = canonicalizeTriggerType(value);
  return t === "birthday" || t === "birthday_former";
}

/** C5/C6 — delay_days is days after trial class_date before conversion decision. */
export function isPostTrialFollowupTriggerType(value: string): boolean {
  const t = canonicalizeTriggerType(value);
  return t === "registered_after_trial" || t === "not_registered_after_trial";
}

/** attendance_gap — delay_days is absence-tier days, not event+N. */
export function isAttendanceGapTriggerType(value: string): boolean {
  return canonicalizeTriggerType(value) === "attendance_gap";
}

/** C7 nth_workout — delay_days is N (workout count); lookback_days is the new-customer window. */
export function isNthWorkoutTriggerType(value: string): boolean {
  return canonicalizeTriggerType(value) === "nth_workout";
}

/** C14/C15 — delay_days is days before end_suspend. */
export function isFreezeEndingTriggerType(value: string): boolean {
  const t = canonicalizeTriggerType(value);
  return t === "freeze_ending_unbooked" || t === "freeze_ending_booked";
}

/**
 * Event-based types whose send time is after the event.
 * Birthday must NOT coerce a stored `before` (matcher honors before/after).
 * Immediate (`delay: none`) confirmations are not "after" — they force delay_days=0 in UI/API.
 */
export function forcesDelayAfter(triggerType: string): boolean {
  const e = triggerCatalogEntry(triggerType);
  if (!e || e.delay !== "after") return false;
  if (isBirthdayFamilyTriggerType(e.type)) return false;
  return true;
}

/** Purchase / credit_refusal / freeze_created (+ manual): no before/after picker. */
export function isImmediateDelayTrigger(triggerType: string): boolean {
  return triggerCatalogEntry(triggerType)?.delay === "none";
}

/** Expiry / freeze-ending / birthday / class-before may fire before the calendar day. */
export function allowsDelayBefore(triggerType: string): boolean {
  const e = triggerCatalogEntry(triggerType);
  if (!e) return false;
  if (e.delay === "either" || e.delay === "before") return true;
  return isBirthdayFamilyTriggerType(e.type);
}

/** Catalog delay is before-only — «after» is not a real choice. */
export function forcesDelayBefore(triggerType: string): boolean {
  return triggerCatalogEntry(triggerType)?.delay === "before";
}

/** Membership / session pack end date. Other triggers must not use expiry wording. */
export function isExpiryFamilyTriggerType(value: string): boolean {
  const t = canonicalizeTriggerType(value);
  return t === "membership_expiring" || t === "sessions_expiring";
}

/** Reminder relative to a class, not a membership end date. */
export function isClassBeforeTriggerType(value: string): boolean {
  const t = canonicalizeTriggerType(value);
  return (
    t === "trial_reminder" ||
    t === "trainer_trial_heads_up" ||
    t === "class_reminder_regular"
  );
}

export type DelayDirectionOption = { value: DelayDirection; labelHe: string };

/**
 * Direction picker copy. Expiry wording only for membership/session expiry.
 * Class and freeze triggers are before-only.
 */
export function delayDirectionOptions(triggerType: string): DelayDirectionOption[] {
  if (!allowsDelayBefore(triggerType) || isImmediateDelayTrigger(triggerType)) return [];
  if (isNthWorkoutTriggerType(triggerType)) {
    return [
      { value: "after", labelHe: "אחרי האימון" },
      { value: "before", labelHe: "לפני האימון" },
    ];
  }
  if (isBirthdayFamilyTriggerType(triggerType)) {
    return [
      { value: "before", labelHe: "לפני יום ההולדת" },
      { value: "after", labelHe: "אחרי יום ההולדת" },
    ];
  }
  if (isClassBeforeTriggerType(triggerType)) {
    return [{ value: "before", labelHe: "לפני האימון" }];
  }
  if (isFreezeEndingTriggerType(triggerType)) {
    return [{ value: "before", labelHe: "לפני סיום ההקפאה" }];
  }
  if (isExpiryFamilyTriggerType(triggerType)) {
    return [
      { value: "before", labelHe: "לפני פקיעת התוקף" },
      { value: "after", labelHe: "אחרי פקיעת התוקף" },
    ];
  }
  const mode = triggerCatalogEntry(triggerType)?.delay;
  if (mode === "before") return [{ value: "before", labelHe: "לפני האירוע" }];
  if (mode === "either") {
    return [
      { value: "before", labelHe: "לפני האירוע" },
      { value: "after", labelHe: "אחרי האירוע" },
    ];
  }
  return [];
}

/** salesReport item_type values used by purchase item_type_filter. */
export const PURCHASE_ITEM_TYPE_VALUES = ["plan", "session", "service", "trial"] as const;
export type PurchaseItemType = (typeof PURCHASE_ITEM_TYPE_VALUES)[number];

export const PURCHASE_ITEM_TYPE_LABELS_HE: Record<PurchaseItemType, string> = {
  plan: "מנוי",
  session: "כרטיסייה",
  service: "שירות",
  trial: "אימון ניסיון",
};

export function isPurchaseItemType(value: string): value is PurchaseItemType {
  return (PURCHASE_ITEM_TYPE_VALUES as readonly string[]).includes(value);
}

/** Purchase only — class filter (plan/session/service/trial) alongside product_filter ids. */
export function showsItemTypeFilter(triggerType: string): boolean {
  return triggerCatalogEntry(triggerType)?.type === "purchase";
}

export function delayDirectionForTrigger(
  triggerType: string,
  stored: string | null | undefined
): DelayDirection {
  if (forcesDelayAfter(triggerType) || isImmediateDelayTrigger(triggerType)) return "after";
  const d = String(stored ?? "").trim().toLowerCase();
  return d === "before" ? "before" : "after";
}

export function showsProductFilter(triggerType: string): boolean {
  return triggerCatalogEntry(triggerType)?.showProductFilter === true;
}

export function minDelayDaysForTrigger(triggerType: string): number {
  return triggerCatalogEntry(triggerType)?.minDelayDays ?? 0;
}

/** null when this trigger has no upper bound. Callers must reject, not clamp. */
export function maxDelayDaysForTrigger(triggerType: string): number | null {
  const entry = triggerCatalogEntry(triggerType);
  if (!entry || !("maxDelayDays" in entry)) return null;
  const max = entry.maxDelayDays;
  return typeof max === "number" ? max : null;
}

export function defaultDelayDays(triggerType: string): number {
  if (isPostTrialFollowupTriggerType(triggerType)) return 3;
  if (isFreezeEndingTriggerType(triggerType)) return 3;
  if (triggerType === "trial_reminder" || triggerType === "trainer_trial_heads_up") return 1;
  if (triggerType === "lost_lead") return 1;
  if (triggerType === "lead_status_changed") return 0;
  if (triggerType === "milestones") return 90;
  if (isNthWorkoutTriggerType(triggerType)) return 3;
  return minDelayDaysForTrigger(triggerType);
}

export function defaultDelayDirection(triggerType: string): DelayDirection {
  // Birthday defaults to on-day (after + 0); expiry defaults to before.
  // Nth workout stays after completed attendance unless the owner picks before.
  if (isBirthdayFamilyTriggerType(triggerType)) return "after";
  if (isImmediateDelayTrigger(triggerType)) return "after";
  if (isNthWorkoutTriggerType(triggerType)) return "after";
  return allowsDelayBefore(triggerType) ? "before" : "after";
}

export function uniqueCreateModeFor(
  triggerType: string
): TriggerUniqueCreateMode | undefined {
  void triggerType;
  return undefined;
}

export function isUniquePerBusinessTriggerType(triggerType: string): boolean {
  void triggerType;
  return false;
}

/**
 * incoming_lead / no_response / arbox_new_lead and the former single-rule types
 * that have no product filter: force after + hide the product picker.
 * uniquePerBusiness is no longer the signal — several rules of one type are allowed.
 */
const FORCE_AFTER_NO_PRODUCT_FILTER = new Set([
  "first_paid_purchase",
  "arbox_new_lead",
  "incoming_lead",
  "trial_booked",
  "class_cancelled_staff",
  "class_cancelled_customer",
  "lost_lead",
  "lead_status_changed",
]);

export function forcesAfterNoProductFilter(triggerType: string): boolean {
  const e = triggerCatalogEntry(triggerType);
  if (!e || e.showProductFilter) return false;
  return FORCE_AFTER_NO_PRODUCT_FILTER.has(e.type) || e.minDelayDays > 0;
}

export function triggerTypeLabel(triggerType: string): string {
  const e = triggerCatalogEntry(triggerType);
  return e?.labelHe ?? triggerType;
}

export const LEAD_STATUS_CHANGED_EXISTS_ERROR = "lead_status_changed_exists";
export const LEAD_STATUS_CHANGED_EXISTS_MESSAGE = "כבר קיים טריגר ליד ללא מענה פעיל";

/**
 * One enabled lead_status_changed rule per business. Disabled rows may remain.
 * The row being updated is excluded by id, so re-saving it is not a conflict.
 */
export function enabledLeadStatusRuleConflict(input: {
  existing: readonly { id?: string; trigger_type?: string; enabled?: boolean }[];
  id?: string | null;
  triggerType: string;
  enabled: boolean;
}): boolean {
  if (input.triggerType !== "lead_status_changed" || !input.enabled) return false;
  const self = input.id != null ? String(input.id) : "";
  return input.existing.some(
    (row) =>
      row.trigger_type === "lead_status_changed" &&
      row.enabled === true &&
      String(row.id ?? "") !== self
  );
}

/** Read-only cron send-time hint for the dashboard (not a user setting). */
export function triggerSendScheduleHintHe(triggerType: string): string {
  return triggerCatalogEntry(triggerType)?.sendHintHe ?? "";
}

/** C7 new-customer window: 1–30 days. NULL in DB means 30. */
export const NTH_WORKOUT_LOOKBACK_MAX = 30;
export const NTH_WORKOUT_LOOKBACK_DEFAULT = 30;

export function showsLookbackDays(triggerType: string): boolean {
  return isNthWorkoutTriggerType(triggerType);
}

/** Parse owner lookback. null = use default at runtime. "invalid" for API 400. */
export function parseLookbackDays(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > NTH_WORKOUT_LOOKBACK_MAX) {
    return "invalid";
  }
  return n;
}

export function defaultLookbackDays(): number {
  return NTH_WORKOUT_LOOKBACK_DEFAULT;
}

export function formatLookbackLabel(days: number): string {
  return `${Math.min(NTH_WORKOUT_LOOKBACK_MAX, Math.max(1, days))} ימים כלקוח חדש`;
}

export function formatDelayLabel(
  type: string,
  days: number,
  direction: DelayDirection
): string {
  if (isImmediateDelayTrigger(type)) {
    return "נשלח מיד";
  }
  if (isAttendanceGapTriggerType(type)) {
    return `${Math.max(1, days)} ימי היעדרות`;
  }
  if (isFreezeEndingTriggerType(type)) {
    return days === 0 ? "ביום סיום ההקפאה" : `${days} ימים לפני סיום ההקפאה`;
  }
  if (isPostTrialFollowupTriggerType(type)) {
    if (days === 0) {
      return canonicalizeTriggerType(type) === "registered_after_trial"
        ? "באותו הרגע"
        : "ביום הניסיון";
    }
    return `${Math.max(minDelayDaysForTrigger(type), days)} ימים אחרי הניסיון`;
  }
  if (type === "no_response") {
    return `${Math.max(2, days)} ימי שתיקה`;
  }
  if (type === "lost_lead") {
    return days === 0 ? "מיידי" : `${days} ימים אחרי אובדן הליד`;
  }
  if (type === "lead_status_changed") {
    return days === 0 ? "בריצה הקרובה (09:00 או 20:30)" : `${days} ימים אחרי השינוי`;
  }
  if (type === "milestones") {
    return `${Math.max(1, days)} ימים מההצטרפות`;
  }
  if (isNthWorkoutTriggerType(type)) {
    const n = Math.max(1, days);
    return direction === "before" ? `לפני אימון מספר ${n}` : `אחרי אימון מספר ${n}`;
  }
  if (type === "membership_cancelled") {
    return days === 0 ? "ביום הביטול" : `${days} ימים אחרי הביטול`;
  }
  if (isClassBeforeTriggerType(type)) {
    return days === 0 ? "בוקר האימון" : `${days} ימים לפני האימון`;
  }
  if (type === "class_cancelled_staff") {
    return days === 0 ? "ביום הביטול" : `${days} ימים אחרי הביטול`;
  }
  if (isIncomingLeadTriggerType(type) || type === "arbox_new_lead") {
    return days === 0 ? "מיידי" : `${days} ימים אחרי הליד`;
  }
  if (isBirthdayFamilyTriggerType(type)) {
    if (days === 0) return "ביום ההולדת";
    const dir = direction === "before" ? "לפני יום ההולדת" : "אחרי יום ההולדת";
    return `${days} ימים ${dir}`;
  }
  if (isExpiryFamilyTriggerType(type)) {
    if (days === 0) return "ביום פקיעת התוקף";
    const dir = direction === "before" ? "לפני פקיעת התוקף" : "אחרי פקיעת התוקף";
    return `${days} ימים ${dir}`;
  }
  if (allowsDelayBefore(type)) {
    if (days === 0) return "ביום האירוע";
    const dir = direction === "before" ? "לפני האירוע" : "אחרי האירוע";
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
