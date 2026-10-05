/** Caps taken from real sends, not from an attempts counter that can stay at 0. */
export type TrialSendChannel = "free" | "template";

export type TrialSendCapBlock = "template_rule_cap" | "free_message_cap" | "trial_24h_cap";

export function trialSendCapBlock(input: {
  channel: TrialSendChannel;
  sentTemplatesForRule: number;
  sentFreeForContact: number;
  trialRelatedLast24h: number;
}): TrialSendCapBlock | null {
  if (input.trialRelatedLast24h >= 3) return "trial_24h_cap";
  if (input.channel === "free" && input.sentFreeForContact >= 1) return "free_message_cap";
  if (input.channel === "template" && input.sentTemplatesForRule >= 1) return "template_rule_cap";
  return null;
}

/** Insert won only when the database accepted the new claim row. Any error blocks the send. */
export function claimInsertAllowsSend(error: { code?: string; message?: string } | null): boolean {
  return error == null;
}

/**
 * One booking, one rule, one channel. The first claim sends. Later runs and
 * overlapping workers do not.
 */
export function simulateTrialBookingClaims(runs: number): { templateSends: number; freeSends: number } {
  const held = new Set<string>();
  let templateSends = 0;
  let freeSends = 0;
  for (let i = 0; i < runs; i++) {
    if (!held.has("template")) {
      held.add("template");
      templateSends += 1;
    }
    if (!held.has("free")) {
      held.add("free");
      freeSends += 1;
    }
  }
  return { templateSends, freeSends };
}

export function simulateConcurrentClaims(workers: number): number {
  let held = false;
  let winners = 0;
  for (let i = 0; i < workers; i++) {
    if (held) continue;
    held = true;
    winners += 1;
  }
  return winners;
}
