/**
 * Plan-before-send checks. Pure: every input is passed in, nothing reads the database.
 * One planned item gets one outcome, strongest first:
 *   blocked (certain duplicate, final) > skipped (recipient, final) > held (needs Lior) > planned.
 */
import { addCalendarDaysYmd } from "@/lib/rule-activation";
import { formatDateYmdIsrael } from "@/lib/leads/arbox-trial-attended";
import { triggerSkipsStaff } from "@/lib/leads/arbox-staff";
import { emptyTemplateVariable } from "@/lib/notifications/template-empty-variable";
import {
  classDateYmdFromStaffDedupKey,
  classDateYmdFromTrainerHeadsUpDedupKey,
  classDateYmdFromTrialReminderDedupKey,
  classNameFromScheduledDedupKey,
  classTimeFromScheduledDedupKey,
  expiryYmdFromScheduledDedupKey,
  userIdFromTrainerTrialHeadsUpDedupKey,
} from "@/lib/template-send-params";

export type PlanSlot = "morning" | "evening";
export type PlanItemStatus = "planned" | "held" | "blocked" | "skipped";

export const HOLD_REASONS = {
  emptyVariable: "empty_variable",
  relativeWords: "relative_words",
  volumeAnomaly: "volume_anomaly",
  wabaBlocked: "waba_blocked",
  circuitBreaker: "circuit_breaker",
} as const;

export const SKIP_REASONS = {
  optedOut: "opted_out",
  staff: "staff",
  leaveRequest: "leave_request_14d",
} as const;

export const BLOCK_REASON_DUPLICATE = "duplicate";

export { SEND_CHECK_SKIPPED_ERROR } from "@/lib/send-plan/errors";

/** Israel wall clock of each slot: PLAN runs an hour before DISPATCH. */
export const PLAN_SLOT_HM: Record<PlanSlot, { plan: string; dispatch: string }> = {
  morning: { plan: "08:00", dispatch: "09:00" },
  evening: { plan: "19:00", dispatch: "20:00" },
};

/** Triggers whose contact gets nothing for 14 days after a leave request (lib/leads/leave-request.ts). */
export const LEAVE_REQUEST_TRIGGERS: readonly string[] = [
  "missed_class",
  "missed_trial",
  "attendance_gap",
  "lost_lead",
  "no_response",
  "membership_expiring",
];

/** Volume anomaly: more than 2x the 14-day daily average, and never below this many. */
export const VOLUME_MULTIPLIER = 2;
export const VOLUME_MIN_THRESHOLD = 10;
/** Circuit breaker: more than 3x the normal volume of that hour, and never below this many. */
export const BREAKER_MULTIPLIER = 3;
export const BREAKER_MIN_THRESHOLD = 10;

/** Meta codes that stop a whole business from sending (lib/wa-blocking-error-alert.ts). */
export const WABA_BLOCKING_CODES: readonly number[] = [131042, 131031, 368, 131045, 133010];

/** Israel wall clock instant for a day + HH:MM, correct on both sides of a DST change. */
export function israelWallInstant(ymd: string, hm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(hm)) return null;
  for (const offset of ["+03:00", "+02:00"]) {
    const dt = new Date(`${ymd}T${hm}:00${offset}`);
    if (Number.isNaN(dt.getTime())) continue;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    if (`${get("year")}-${get("month")}-${get("day")}` === ymd && `${hour}:${get("minute")}` === hm) return dt;
  }
  return null;
}

export function dispatchInstant(planDay: string, slot: PlanSlot): Date | null {
  return israelWallInstant(planDay, PLAN_SLOT_HM[slot].dispatch);
}

/** What a trigger's per-event dedup key says about the event. Unknown keys give {}. */
export type PlanEventMeta = {
  ymd?: string;
  time?: string;
  userId?: number;
  className?: string;
};

export function eventMetaFromDedupKey(dedupKey: string | null | undefined): PlanEventMeta {
  const key = String(dedupKey ?? "").trim();
  if (!key) return {};
  const kind = key.split(":")[0] ?? "";
  const out: PlanEventMeta = {};
  const ymd =
    classDateYmdFromTrialReminderDedupKey(key) ??
    classDateYmdFromTrainerHeadsUpDedupKey(key) ??
    classDateYmdFromStaffDedupKey(key) ??
    expiryYmdFromScheduledDedupKey(key) ??
    classDateFromGenericKey(kind, key);
  if (ymd) out.ymd = ymd;
  const time = classTimeFromScheduledDedupKey(key);
  if (time && /^\d{1,2}:\d{2}/.test(time)) out.time = time.slice(0, 5).padStart(5, "0");
  const className = classNameFromScheduledDedupKey(key);
  if (className) out.className = className;
  const userId =
    kind === "trainer_trial_heads_up"
      ? userIdFromTrainerTrialHeadsUpDedupKey(key)
      : ["trial_reminder", "missed_class", "missed_trial", "trial_attended"].includes(kind)
        ? Number(key.split("#")[0]!.split(":")[3])
        : null;
  if (userId != null && Number.isFinite(userId) && userId > 0) out.userId = Math.trunc(userId);
  return out;
}

/** kind:business:trigger:user:YYYY-MM-DD… keys (missed class, trial attended, post-trial). */
function classDateFromGenericKey(kind: string, key: string): string | null {
  if (
    ![
      "missed_class",
      "missed_trial",
      "trial_attended",
      "registered_after_trial",
      "not_registered_after_trial",
    ].includes(kind)
  ) {
    return null;
  }
  const ymd = (key.split("#")[0]!.split(":")[4] ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** Class start for class-bound events, null when the key has no date + time. */
export function eventStartInstant(meta: PlanEventMeta): Date | null {
  if (!meta.ymd || !meta.time) return null;
  return israelWallInstant(meta.ymd, meta.time);
}

const HE = "\u05D0-\u05EA";
/** A whole Hebrew word, with an optional one-letter prefix (ו/ב/ל/מ/ש/ה/כ). */
function hebrewWord(word: string, prefixes = "ובלמשכ"): RegExp {
  return new RegExp(`(?:^|[^${HE}])[${prefixes}]?${word}(?![${HE}])`);
}

const WORDS = {
  tomorrow: hebrewWord("מחר"),
  today: hebrewWord("היום"),
  yesterday: hebrewWord("אתמול"),
  goodEvening: /ערב\s+טוב/,
  goodMorning: /בוקר\s+טוב/,
};

/**
 * Relative day / time words that do not match the send moment.
 * Day words are checked only when the event day is known (from the dedup key).
 * Greetings are checked against the hour the message goes out.
 */
export function relativeWordMismatch(input: {
  body: string;
  eventYmd?: string | null;
  sendAt: Date;
}): string | null {
  const body = String(input.body ?? "");
  if (!body.trim()) return null;
  const sendYmd = formatDateYmdIsrael(input.sendAt);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(
      input.sendAt
    )
  ) % 24;
  if (WORDS.goodEvening.test(body) && hour < 16) return "ערב טוב בשליחת בוקר";
  if (WORDS.goodMorning.test(body) && hour >= 12) return "בוקר טוב בשליחת ערב";
  const event = String(input.eventYmd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event)) return null;
  if (WORDS.tomorrow.test(body) && event !== addCalendarDaysYmd(sendYmd, 1)) return `«מחר» והאירוע ב-${event}`;
  if (WORDS.today.test(body) && event !== sendYmd) return `«היום» והאירוע ב-${event}`;
  if (WORDS.yesterday.test(body) && event !== addCalendarDaysYmd(sendYmd, -1)) return `«אתמול» והאירוע ב-${event}`;
  return null;
}

/** Group limit: 2x the 14-day daily average, at least VOLUME_MIN_THRESHOLD. */
export function volumeLimit(dailyAverage: number): number {
  const avg = Number.isFinite(dailyAverage) && dailyAverage > 0 ? dailyAverage : 0;
  return Math.max(VOLUME_MIN_THRESHOLD, Math.ceil(VOLUME_MULTIPLIER * avg));
}

export function exceedsVolume(count: number, dailyAverage: number): boolean {
  return count > volumeLimit(dailyAverage);
}

/** Breaker limit: 3x the normal volume of that hour, at least BREAKER_MIN_THRESHOLD. */
export function breakerLimit(hourlyAverage: number): number {
  const avg = Number.isFinite(hourlyAverage) && hourlyAverage > 0 ? hourlyAverage : 0;
  return Math.max(BREAKER_MIN_THRESHOLD, Math.ceil(BREAKER_MULTIPLIER * avg));
}

export function tripsBreaker(sentLastHour: number, hourlyAverage: number): boolean {
  return sentLastHour + 1 > breakerLimit(hourlyAverage);
}

export type ItemCheckInput = {
  triggerType: string | null;
  recipientKind: "customer" | "staff";
  components?: ReadonlyArray<{ type?: string; parameters?: Array<{ type?: string; text?: unknown }> }> | null;
  renderedBody: string;
  eventYmd?: string | null;
  sendAt: Date;
  duplicate: boolean;
  contact: { optedOut: boolean; isStaff: boolean; leaveRequest: boolean } | null;
  /** Opt-out suppression for this template category (lib/wa-marketing-opt-out.ts). */
  optOutSuppress: boolean;
  wabaBlocked: boolean;
};

export type ItemCheckResult = { status: PlanItemStatus; reason: string | null; detail?: string };

/** Per-item checks. Volume is a group check (groupVolumeHolds). */
export function checkPlanItem(input: ItemCheckInput): ItemCheckResult {
  if (input.duplicate) return { status: "blocked", reason: BLOCK_REASON_DUPLICATE };
  const type = String(input.triggerType ?? "");
  if (input.recipientKind !== "staff") {
    if (input.optOutSuppress) return { status: "skipped", reason: SKIP_REASONS.optedOut };
    if (input.contact?.isStaff && type && triggerSkipsStaff(type)) {
      return { status: "skipped", reason: SKIP_REASONS.staff };
    }
    if (input.contact?.leaveRequest && LEAVE_REQUEST_TRIGGERS.includes(type)) {
      return { status: "skipped", reason: SKIP_REASONS.leaveRequest };
    }
  }
  const empty = emptyTemplateVariable(input.components ?? []);
  if (empty) return { status: "held", reason: HOLD_REASONS.emptyVariable, detail: empty };
  const words = relativeWordMismatch({ body: input.renderedBody, eventYmd: input.eventYmd, sendAt: input.sendAt });
  if (words) return { status: "held", reason: HOLD_REASONS.relativeWords, detail: words };
  if (input.wabaBlocked) return { status: "held", reason: HOLD_REASONS.wabaBlocked };
  return { status: "planned", reason: null };
}

export type VolumeGroupItem = { id: string; triggerKey: string; status: PlanItemStatus };

/**
 * Items to hold for volume: every planned item of a trigger over its limit, or of the
 * whole business when the business total is over its own limit.
 */
export function groupVolumeHolds(input: {
  items: readonly VolumeGroupItem[];
  triggerDailyAverage: ReadonlyMap<string, number>;
  businessDailyAverage: number;
}): { ids: Set<string>; groups: Array<{ group: string; count: number; limit: number }> } {
  const live = input.items.filter((item) => item.status === "planned" || item.status === "held");
  const ids = new Set<string>();
  const groups: Array<{ group: string; count: number; limit: number }> = [];
  const total = live.length;
  if (exceedsVolume(total, input.businessDailyAverage)) {
    groups.push({ group: "business", count: total, limit: volumeLimit(input.businessDailyAverage) });
    for (const item of live) if (item.status === "planned") ids.add(item.id);
    return { ids, groups };
  }
  const byTrigger = new Map<string, VolumeGroupItem[]>();
  for (const item of live) {
    const list = byTrigger.get(item.triggerKey) ?? [];
    list.push(item);
    byTrigger.set(item.triggerKey, list);
  }
  for (const [trigger, list] of byTrigger) {
    const avg = input.triggerDailyAverage.get(trigger) ?? 0;
    if (!exceedsVolume(list.length, avg)) continue;
    groups.push({ group: trigger, count: list.length, limit: volumeLimit(avg) });
    for (const item of list) if (item.status === "planned") ids.add(item.id);
  }
  return { ids, groups };
}

/** 14-day daily average per trigger and for the business, from send timestamps. */
export function dailyAverages(
  sends: ReadonlyArray<{ trigger_id: string | null; created_at: string }>,
  days = 14
): { byTrigger: Map<string, number>; business: number } {
  const counts = new Map<string, number>();
  for (const row of sends) {
    const key = String(row.trigger_id ?? "") || "none";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const byTrigger = new Map<string, number>();
  for (const [key, count] of counts) byTrigger.set(key, count / days);
  return { byTrigger, business: sends.length / days };
}

/** Normal volume of one Israel hour: sends in that hour over the last 14 days, per day. */
export function hourlyAverage(sendTimes: readonly string[], at: Date, days = 14): number {
  const hourOf = (d: Date) =>
    Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(d)) %
    24;
  const target = hourOf(at);
  let n = 0;
  for (const raw of sendTimes) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime()) && hourOf(d) === target) n += 1;
  }
  return n / days;
}

/** Event key for the duplicate check (lib/notifications/template-send-claim.ts, same grain). */
export function planEventKey(input: {
  templateClaimEventKey: string | null;
  params: readonly string[];
}): string {
  if (input.templateClaimEventKey) return input.templateClaimEventKey;
  return `params:${input.params.map((p) => p.trim()).join("|")}`.slice(0, 400);
}

/** The planned row's own unique key in scheduled_template_sends.dedup_key. */
export function planRowDedupKey(input: {
  planDay: string;
  slot: PlanSlot | "event";
  businessId: number;
  triggerId: string | null;
  phone: string;
  templateName: string;
  eventKey: string;
}): string {
  return [
    "plan",
    input.planDay,
    input.slot,
    input.businessId,
    input.triggerId ?? "-",
    input.phone,
    input.templateName,
    input.eventKey,
  ]
    .join(":")
    .slice(0, 900);
}

/** Today in Israel, the day a PLAN or DISPATCH belongs to. */
export function planDayOf(now: Date): string {
  return formatDateYmdIsrael(now);
}
