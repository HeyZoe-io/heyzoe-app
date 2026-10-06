import { firstNameFromFullName } from "@/lib/lead-template";
import type { OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";
import {
  bodyTextFromTemplateComponents,
  extractBodyVarCount,
  normalizeTemplatePlaceholderText,
  paramSlotsForTriggerType,
  type TemplateParamSlot,
} from "@/lib/template-presets";

export const TEMPLATE_NAME_FALLBACK = "שלום";
export const TEMPLATE_BUSINESS_NAME_FALLBACK = "הסטודיו";
export const TEMPLATE_EXPIRY_FALLBACK = "בקרוב";
export const TEMPLATE_MEMBERSHIP_TYPE_FALLBACK = "המנוי";
export const TEMPLATE_CLASS_TIME_FALLBACK = "בקרוב";

export type TemplateSendParamContext = {
  triggerType: string;
  storedComponents?: unknown;
  firstName?: string | null;
  businessName?: string | null;
  expiryDateYmd?: string | null;
  startDateYmd?: string | null;
  membershipTypeName?: string | null;
  className?: string | null;
  classTime?: string | null;
  /** Trainer heads-up {{3}}: full client name, not a first-name slice. */
  clientFullName?: string | null;
  /** Trainer heads-up {{4}}: Arbox client-card general notes, already flattened. */
  clientGeneralNotes?: string | null;
  workoutN?: number | string | null;
};

export const TEMPLATE_GENERAL_NOTES_FALLBACK = "אין הערות";

/** Freeze confirmation dates (YYYY-MM-DD → DD/MM/YYYY). */
export function formatFreezeCreatedDate(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim());
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Israel-facing expiry for {{3}} (YYYY-MM-DD → DD.MM.YYYY). */
export function formatTemplateExpiryDate(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || TEMPLATE_EXPIRY_FALLBACK;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Last YYYY-MM-DD segment of membership/sessions expiring / cancelled / freeze keys. */
export function expiryYmdFromScheduledDedupKey(dedupKey: string): string | null {
  const key = String(dedupKey ?? "").trim().split("#")[0] ?? "";
  if (
    !key.startsWith("membership_expiring:") &&
    !key.startsWith("sessions_expiring:") &&
    !key.startsWith("membership_cancelled:") &&
    !key.startsWith("freeze_created:") &&
    !key.startsWith("freeze_ending_unbooked:") &&
    !key.startsWith("freeze_ending_booked:")
  ) {
    return null;
  }
  const parts = key.split(":");
  const last = parts[parts.length - 1] ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : null;
}

/** freeze_created delayed send: start date is the penultimate YYYY-MM-DD segment. */
export function startDateYmdFromScheduledDedupKey(dedupKey: string): string | null {
  const key = String(dedupKey ?? "").trim().split("#")[0] ?? "";
  if (!key.startsWith("freeze_created:")) return null;
  const parts = key.split(":");
  if (parts.length < 2) return null;
  const start = parts[parts.length - 2] ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null;
}

/** membership_cancelled delayed send: type name encoded after `#`. */
export function membershipTypeNameFromScheduledDedupKey(dedupKey: string): string | null {
  const raw = String(dedupKey ?? "");
  if (!raw.startsWith("membership_cancelled:")) return null;
  const hash = raw.indexOf("#");
  if (hash < 0) return null;
  try {
    const decoded = decodeURIComponent(raw.slice(hash + 1).trim());
    return decoded || null;
  } catch {
    return null;
  }
}

/** missed_class / missed_trial / post-trial / freeze ending booked: class after `#`. */
export function classNameFromScheduledDedupKey(dedupKey: string): string | null {
  const raw = String(dedupKey ?? "");
  if (
    !raw.startsWith("missed_class:") &&
    !raw.startsWith("missed_trial:") &&
    !raw.startsWith("registered_after_trial:") &&
    !raw.startsWith("not_registered_after_trial:") &&
    !raw.startsWith("freeze_ending_booked:") &&
    !raw.startsWith("trial_reminder:") &&
    !raw.startsWith("trainer_trial_heads_up:") &&
    !raw.startsWith("class_cancelled_staff:")
  ) {
    return null;
  }
  const hash = raw.indexOf("#");
  if (hash < 0) return null;
  try {
    if (raw.startsWith("trainer_trial_heads_up:") || raw.startsWith("class_cancelled_staff:")) {
      const parts = raw.slice(hash + 1).split("#");
      const classEnc = raw.startsWith("trainer_trial_heads_up:") ? (parts[1] ?? "") : (parts[0] ?? "");
      const decoded = decodeURIComponent(classEnc.trim());
      return decoded || null;
    }
    const decoded = decodeURIComponent(raw.slice(hash + 1).trim());
    return decoded || null;
  } catch {
    return null;
  }
}

/** Staff B2 dedup: user id sits before the class date. */
export function userIdFromTrainerTrialHeadsUpDedupKey(dedupKey: string): number | null {
  const raw = String(dedupKey ?? "");
  if (!raw.startsWith("trainer_trial_heads_up:")) return null;
  const beforeHash = raw.split("#")[0] ?? "";
  const userId = Number((beforeHash.split(":")[4] ?? "").trim());
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return Math.trunc(userId);
}

/** Staff B2: client name (full name on new keys) is the first hash segment. */
export function clientFirstNameFromStaffDedupKey(dedupKey: string): string | null {
  const raw = String(dedupKey ?? "");
  if (!raw.startsWith("trainer_trial_heads_up:")) return null;
  const hash = raw.indexOf("#");
  if (hash < 0) return null;
  try {
    const clientEnc = (raw.slice(hash + 1).split("#")[0] ?? "").trim();
    const decoded = decodeURIComponent(clientEnc);
    return decoded || null;
  } catch {
    return null;
  }
}

/** Staff B5: class date YMD is the second hash segment. */
export function classDateYmdFromStaffDedupKey(dedupKey: string): string | null {
  const raw = String(dedupKey ?? "");
  if (!raw.startsWith("class_cancelled_staff:")) return null;
  const hash = raw.indexOf("#");
  if (hash < 0) return null;
  const ymd = (raw.slice(hash + 1).split("#")[1] ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** trial_reminder delayed send: class date is the YYYY-MM-DD segment before the time. */
export function classDateYmdFromTrialReminderDedupKey(dedupKey: string): string | null {
  const raw = String(dedupKey ?? "");
  if (!raw.startsWith("trial_reminder:")) return null;
  const beforeHash = raw.split("#")[0] ?? "";
  const parts = beforeHash.split(":");
  if (parts.length < 6) return null;
  const ymd = (parts[4] ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** trial_reminder delayed send: class_time is the last segment before `#`. */
export function classTimeFromScheduledDedupKey(dedupKey: string): string | null {
  const raw = String(dedupKey ?? "");
  if (raw.startsWith("class_cancelled_staff:")) {
    const hash = raw.indexOf("#");
    if (hash < 0) return null;
    try {
      const timeEnc = (raw.slice(hash + 1).split("#")[2] ?? "").trim();
      const decoded = decodeURIComponent(timeEnc);
      return decoded || null;
    } catch {
      return null;
    }
  }
  if (!raw.startsWith("trial_reminder:") && !raw.startsWith("trainer_trial_heads_up:")) return null;
  const beforeHash = raw.split("#")[0] ?? "";
  const parts = beforeHash.split(":");
  if (parts.length < 6) return null;
  try {
    const decoded = decodeURIComponent((parts[parts.length - 1] ?? "").trim());
    return decoded || null;
  } catch {
    return null;
  }
}

/** Prefix of scheduled_template_sends.dedup_key → trigger_type (site_lead → incoming_lead). */
export function triggerTypeFromScheduledDedupKey(dedupKey: string): string | null {
  const prefix = String(dedupKey ?? "").split(":")[0]?.trim() || "";
  if (!prefix) return null;
  if (prefix === "site_lead") return "incoming_lead";
  return prefix;
}

function slotAt(slots: TemplateParamSlot[], index: number): TemplateParamSlot {
  return slots[index] ?? (index === 0 ? "first_name" : slots[slots.length - 1] ?? "first_name");
}

/** True when the stored template body includes this positional slot. */
export function templateBodyUsesSlot(
  triggerType: string,
  storedComponents: unknown,
  slot: TemplateParamSlot
): boolean {
  const body = bodyTextFromTemplateComponents(storedComponents);
  const slots = paramSlotsForTriggerType(triggerType);
  const varCount = body ? extractBodyVarCount(body) : slots.length;
  for (let i = 0; i < varCount; i += 1) {
    if (slotAt(slots, i) === slot) return true;
  }
  return false;
}

/** True when a body parameter is filled from the personal first-name slot. */
export function templateBodyUsesFirstNameSlot(
  triggerType: string,
  storedComponents: unknown
): boolean {
  const body = bodyTextFromTemplateComponents(storedComponents);
  const slots = paramSlotsForTriggerType(triggerType);
  const varCount = body ? extractBodyVarCount(body) : slots.length;
  for (let i = 0; i < varCount; i += 1) {
    if (slotAt(slots, i) === "first_name") return true;
  }
  return false;
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
  if (slot === "membership_type_name") {
    const name = String(ctx.membershipTypeName ?? "").trim();
    return name || TEMPLATE_MEMBERSHIP_TYPE_FALLBACK;
  }
  if (slot === "class_name") {
    const name = String(ctx.className ?? "").trim();
    return name || "השיעור";
  }
  if (slot === "class_time") {
    const time = String(ctx.classTime ?? "").trim();
    return time || TEMPLATE_CLASS_TIME_FALLBACK;
  }
  if (slot === "client_full_name") {
    const explicit = String(ctx.clientFullName ?? "").trim();
    if (explicit) return explicit;
    const raw = String(ctx.firstName ?? "").trim();
    return raw || TEMPLATE_NAME_FALLBACK;
  }
  if (slot === "client_general_notes") {
    const notes = String(ctx.clientGeneralNotes ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/ {2,}/g, " ")
      .trim();
    if (!notes) return TEMPLATE_GENERAL_NOTES_FALLBACK;
    if (notes.length <= 400) return notes;
    return `${notes.slice(0, 399).trimEnd()}…`;
  }
  if (slot === "class_date") {
    const formatted = formatTemplateExpiryDate(ctx.expiryDateYmd);
    return formatted || TEMPLATE_EXPIRY_FALLBACK;
  }
  if (slot === "workout_n") {
    const n = Math.trunc(Number(ctx.workoutN));
    if (Number.isFinite(n) && n > 0) return String(n);
    return "3";
  }
  if (slot === "start_date") {
    const formatted =
      ctx.triggerType === "freeze_created"
        ? formatFreezeCreatedDate(ctx.startDateYmd)
        : formatTemplateExpiryDate(ctx.startDateYmd);
    return formatted || TEMPLATE_EXPIRY_FALLBACK;
  }
  if (ctx.triggerType === "freeze_created") {
    const formatted = formatFreezeCreatedDate(ctx.expiryDateYmd);
    return formatted || TEMPLATE_EXPIRY_FALLBACK;
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
    const slot = slotAt(slots, i);
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

/**
 * freeze_created body variables: none, {{1}} first name, or {{1}} name +
 * {{2}} start + {{3}} end as DD/MM/YYYY. Any other shape is a mismatch.
 */
export function freezeCreatedTemplateParamValues(input: {
  storedComponents: unknown;
  firstName: string | null;
  startYmd: string | null;
  endYmd: string | null;
}): { ok: true; values: string[] } | { ok: false; varCount: number } {
  const body = bodyTextFromTemplateComponents(input.storedComponents) ?? "";
  const found = new Set<number>();
  for (const match of body.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) found.add(n);
  }
  const indexes = [...found].sort((a, b) => a - b);
  const contiguous = indexes.every((n, i) => n === i + 1);
  const count = indexes.length;
  if (!contiguous || (count !== 0 && count !== 1 && count !== 3)) {
    return { ok: false, varCount: count };
  }
  if (count === 0) return { ok: true, values: [] };
  const first = firstNameFromFullName(String(input.firstName ?? "").trim()) || TEMPLATE_NAME_FALLBACK;
  if (count === 1) return { ok: true, values: [first] };
  const start = formatFreezeCreatedDate(input.startYmd);
  const end = formatFreezeCreatedDate(input.endYmd);
  if (!start || !end) return { ok: false, varCount: count };
  return { ok: true, values: [first, start, end] };
}

const TRIAL_REMINDER_HEBREW_DAYS = [
  "יום ראשון",
  "יום שני",
  "יום שלישי",
  "יום רביעי",
  "יום חמישי",
  "יום שישי",
  "יום שבת",
] as const;

/** Class calendar day in Israel, from the booking date. "יום שלישי 7.10". */
export function formatTrialReminderClassDay(ymd: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  const name = TRIAL_REMINDER_HEBREW_DAYS[dt.getUTCDay()];
  return `${name} ${day}.${month}`;
}

/** Wall-clock class start as HH:MM. "9:00" and "18:00:00" both become zero-padded HH:MM. */
export function formatTrialReminderClassTime(raw: unknown): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function trialReminderBodyPlaceholderIndexes(components: unknown): number[] {
  const body = bodyTextFromTemplateComponents(components) ?? "";
  const found = new Set<number>();
  for (const match of normalizeTemplatePlaceholderText(body).matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Body params for one trial_reminder send, counted from the approved components.
 * 3 → [first name, class name, time], same strings as today.
 * 4 → [first name, class name, "יום שלישי 7.10", HH:MM].
 * Any other count is a skip: do not send a mismatched array to Meta.
 */
export function trialReminderTemplateParamValues(input: {
  storedComponents: unknown;
  firstName: string | null;
  className?: string | null;
  classTime?: string | null;
  classDateYmd?: string | null;
}): { ok: true; values: string[] } | { ok: false; reason: string; varCount: number } {
  const indexes = trialReminderBodyPlaceholderIndexes(input.storedComponents);
  const contiguous = indexes.every((n, i) => n === i + 1);
  const count = indexes.length;
  if (!contiguous) {
    return { ok: false, reason: "trial_reminder_param_gap", varCount: count };
  }
  if (count !== 3 && count !== 4) {
    return { ok: false, reason: "trial_reminder_param_count", varCount: count };
  }
  const first = firstNameFromFullName(String(input.firstName ?? "").trim()) || TEMPLATE_NAME_FALLBACK;
  const className = String(input.className ?? "").trim() || "השיעור";
  if (count === 3) {
    const classTime = String(input.classTime ?? "").trim() || TEMPLATE_CLASS_TIME_FALLBACK;
    return { ok: true, values: [first, className, classTime] };
  }
  const day = formatTrialReminderClassDay(input.classDateYmd);
  const time = formatTrialReminderClassTime(input.classTime);
  if (!day || !time) {
    return { ok: false, reason: "trial_reminder_param_missing_class", varCount: count };
  }
  return { ok: true, values: [first, className, day, time] };
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
