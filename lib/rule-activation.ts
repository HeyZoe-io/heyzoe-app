/**
 * A rule may only act on events at or after it became active.
 * Activation is max(created_at, updated_at). Callers move updated_at only when
 * the template name is set, the rule is re-enabled, or its template becomes sendable.
 * There is no separate column: updated_at is that clock.
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

/** Move updated_at to now. That is the rule's new activation instant. */
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
