/** A dedup read or claim failed. Callers must not send. */
export function logDedupBlockedSend(input: {
  log: string;
  businessId: number | string | null;
  triggerId?: string | null;
  reason: string;
}): void {
  console.error(input.log, "dedup blocked send", {
    business_id: input.businessId,
    trigger_id: input.triggerId ?? null,
    reason: input.reason,
  });
}
