/**
 * A rule may only act on events at or after it became active.
 * Activation is max(created_at, updated_at). There is no separate column:
 * updated_at is that clock.
 * Callers move updated_at when the rule is (re)enabled or its targeting
 * changes (trigger type, item filter, delay, direction, lookback).
 * A product-filter edit does not move the clock. Per booking, use
 * decideFilterScopeAction: stay on the normal schedule, send a new entrant
 * only while its send time is still ahead, seed it once that time has passed,
 * and stop bookings that left the filter.
 * Template binding, template body, and a label-only edit must not move it.
 */

export type ActivationRule = {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export function ruleActivationMs(rule: ActivationRule): number {
  const created = Date.parse(String(rule.created_at ?? ""));
  const updated = Date.parse(String(rule.updated_at ?? ""));
  const createdMs = Number.isFinite(created) ? created : 0;
  const updatedMs = Number.isFinite(updated) ? updated : 0;
  return Math.max(createdMs, updatedMs);
}

/** Date-only report values are the start of that day in Asia/Jerusalem. */
export function parseReportEventInstant(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:[ T]00:00:00(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (dateOnly) {
    const start = new Date(`${dateOnly[1]}T00:00:00+03:00`);
    return Number.isNaN(start.getTime()) ? null : start;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * True when this rule must not send for the event.
 * A missing timestamp is not sendable here; the caller silent-seeds instead.
 */
export function eventBeforeRuleActivation(eventAt: Date | null, rule: ActivationRule): boolean {
  if (!eventAt || !Number.isFinite(eventAt.getTime())) return true;
  return eventAt.getTime() < ruleActivationMs(rule);
}

export function rulesOpenForEvent<T extends ActivationRule>(rules: readonly T[], eventAt: Date | null): T[] {
  if (!eventAt) return [];
  return rules.filter((rule) => !eventBeforeRuleActivation(eventAt, rule));
}

type ActivationReader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          gte: (column: string, value: unknown) => {
            limit: (n: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
          };
        };
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          limit: (n: number) => PromiseLike<{ error: { message?: string } | null }>;
        };
      };
    };
  };
};

function asActivationReader(admin: unknown): ActivationReader {
  return admin as ActivationReader;
}

/** Rules that already wrote a dedup row at or after their activation. null = the read failed. */
export async function ruleIdsActiveSinceActivation(
  admin: unknown,
  table: string,
  businessId: number,
  rules: readonly ActivationRule[],
  timeColumn = "processed_at"
): Promise<Set<string> | null> {
  const db = asActivationReader(admin);
  const active = new Set<string>();
  for (const rule of rules) {
    const id = String(rule.id ?? "").trim();
    if (!id) continue;
    const since = new Date(ruleActivationMs(rule)).toISOString();
    const { data, error } = await db
      .from(table)
      .select("trigger_id")
      .eq("business_id", businessId)
      .eq("trigger_id", id)
      .gte(timeColumn, since)
      .limit(1);
    if (error) return null;
    if (Array.isArray(data) && data.length > 0) active.add(id);
  }
  return active;
}

export type RuleActivationSnapshot = {
  enabled?: unknown;
  trigger_type?: unknown;
  product_filter?: unknown;
  item_type_filter?: unknown;
  delay_days?: unknown;
  delay_direction?: unknown;
  lookback_days?: unknown;
  template_name?: unknown;
  target_status?: unknown;
};

function idListKey(raw: unknown): string {
  if (raw == null) return "";
  const list = Array.isArray(raw) ? raw : [raw];
  const ids = list
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort();
  return ids.join(",");
}

function lookbackKey(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : String(raw).trim();
}

export type FilterScopeAction = "keep" | "send" | "seed" | "stop";

/**
 * One booking when the product filter changes. Shared by every trigger type.
 * Already in scope stays on its normal schedule (no seed).
 * A new entrant is sent only while its normal send time is still ahead
 * (sendAt >= now, including the exact send instant). A missing or earlier
 * send time is seeded so nothing goes out late.
 * A booking that left the filter stops.
 */
export function decideFilterScopeAction(input: {
  previouslyInScope: boolean;
  nowInScope: boolean;
  sendAt: Date | null;
  now: Date;
}): FilterScopeAction {
  if (input.previouslyInScope && input.nowInScope) return "keep";
  if (!input.nowInScope) return "stop";
  const sendMs = input.sendAt?.getTime();
  if (sendMs != null && Number.isFinite(sendMs) && sendMs >= input.now.getTime()) return "send";
  return "seed";
}

/** Daily Arbox run slots, Israel wall clock. */
export const DAILY_RUN_SLOTS = ["09:00", "20:30"] as const;

const ISRAEL_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function israelYmdHm(at: Date): { ymd: string; hm: string } {
  const parts = Object.fromEntries(ISRAEL_PARTS.formatToParts(at).map((p) => [p.type, p.value]));
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}` };
}

/** Latest daily slot today at or before `now`. Null before the first slot. */
export function currentRunSlotStart(now: Date): Date | null {
  const { ymd, hm } = israelYmdHm(now);
  let start: Date | null = null;
  for (const slot of DAILY_RUN_SLOTS) {
    if (slot <= hm) start = israelSlotInstant(ymd, slot);
  }
  return start;
}

/**
 * New rule or disable+enable. A send time that is still ahead goes out once
 * on the normal path. So does one earlier today, at or after the current
 * run's slot: a 09:00 send reached at 09:00:20 is due, not history.
 * A missing send time, an earlier day, or an earlier slot today is history.
 */
export function decideActivationEventAction(input: {
  sendAt: Date | null;
  now: Date;
}): "seed" | "send" {
  const sendMs = input.sendAt?.getTime();
  if (sendMs == null || !Number.isFinite(sendMs)) return "seed";
  if (sendMs >= input.now.getTime()) return "send";
  if (israelYmdHm(input.sendAt!).ymd !== israelYmdHm(input.now).ymd) return "seed";
  const slotStart = currentRunSlotStart(input.now);
  if (!slotStart || sendMs >= slotStart.getTime()) return "send";
  return "seed";
}

/** Israel wall clock. `hm` is HH:MM. */
export function israelSlotInstant(ymd: string, hm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(hm)) return null;
  const dt = new Date(`${ymd}T${hm}:00+03:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function addCalendarDaysYmd(ymd: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * True only when this patch should start the activation clock over.
 * Template name is ignored on purpose: rebinding or rewording a template
 * must keep the existing schedule.
 * product_filter is ignored here too: it uses decideFilterScopeAction per event
 * instead of seeding every existing booking.
 */
export function ruleActivationResets(
  previous: RuleActivationSnapshot,
  patch: RuleActivationSnapshot
): boolean {
  if (patch.enabled === true && previous.enabled !== true) return true;
  if (
    patch.trigger_type !== undefined &&
    String(patch.trigger_type ?? "").trim() !== String(previous.trigger_type ?? "").trim()
  ) {
    return true;
  }
  if (patch.delay_days !== undefined && Number(patch.delay_days) !== Number(previous.delay_days ?? 0)) {
    return true;
  }
  if (
    patch.delay_direction !== undefined &&
    String(patch.delay_direction ?? "").trim() !== String(previous.delay_direction ?? "").trim()
  ) {
    return true;
  }
  if (patch.lookback_days !== undefined && lookbackKey(patch.lookback_days) !== lookbackKey(previous.lookback_days)) {
    return true;
  }
  if (
    patch.item_type_filter !== undefined &&
    idListKey(patch.item_type_filter) !== idListKey(previous.item_type_filter)
  ) {
    return true;
  }
  if (
    patch.target_status !== undefined &&
    String(patch.target_status ?? "").trim() !== String(previous.target_status ?? "").trim()
  ) {
    return true;
  }
  return false;
}

/** True when the patch replaces the product id list. Order does not count. */
export function productFilterChanged(
  previous: RuleActivationSnapshot,
  patch: RuleActivationSnapshot
): boolean {
  if (patch.product_filter === undefined) return false;
  return idListKey(patch.product_filter) !== idListKey(previous.product_filter);
}

/** Move updated_at to now. That is the rule's new activation instant. Do not call this for a template edit. */
export async function stampTemplateRulesActivated(
  admin: unknown,
  input: { businessId: number; ruleId?: string | null; templateName?: string | null }
): Promise<boolean> {
  const businessId = Number(input.businessId);
  if (!Number.isFinite(businessId)) return false;
  const ruleId = String(input.ruleId ?? "").trim();
  const templateName = String(input.templateName ?? "").trim();
  if (!ruleId && !templateName) return false;
  const row = { updated_at: new Date().toISOString() };
  const db = asActivationReader(admin);
  const pending = db.from("template_triggers").update(row).eq("business_id", businessId);
  const { error } = ruleId
    ? await pending.eq("id", ruleId).limit(1)
    : await pending.eq("template_name", templateName).limit(1);
  if (error) {
    console.error("[rule-activation] stamp failed", {
      business_id: businessId,
      trigger_id: ruleId || null,
      reason: error.message,
    });
    return false;
  }
  return true;
}
