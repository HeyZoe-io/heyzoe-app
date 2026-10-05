/** Rows with no live rule stay on this id. It never equals a real template_triggers id. */
export const SYNC_LOG_SENTINEL_TRIGGER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Migration backfill: one handled event is copied onto every live rule of that
 * type. A second rule then sees the event as already sent. No live rule keeps
 * the sentinel so a later rule does not match it.
 */
export function backfillTriggerIdsForLiveRules(liveRuleIds: readonly string[]): string[] {
  const live = [
    ...new Set(
      liveRuleIds
        .map((id) => String(id ?? "").trim())
        .filter((id) => id.length > 0 && id !== SYNC_LOG_SENTINEL_TRIGGER_ID)
    ),
  ];
  return live.length > 0 ? live : [SYNC_LOG_SENTINEL_TRIGGER_ID];
}

export function rulesNotYetHandled<T extends { id: string }>(
  rules: readonly T[],
  handledTriggerIds: ReadonlySet<string>
): T[] {
  return rules.filter((rule) => Boolean(rule.id) && !handledTriggerIds.has(rule.id));
}

/** Delay-less types are due together. A positive delay is due on its own day. */
export function ruleIsDue(input: {
  delayDays: number;
  eventOffsetDays: number;
  delayLess: boolean;
}): boolean {
  if (input.delayLess) return true;
  return input.eventOffsetDays === Math.max(0, Math.trunc(input.delayDays));
}
