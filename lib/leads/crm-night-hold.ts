/**
 * 21:00–08:00 Asia/Jerusalem. Same window as membership_cancelled / freeze_created.
 * The 08:00 run is the first that sends. A held row is not cancelled.
 * incoming_lead is not included: Zoe's reply to a lead's own message stays instant.
 */
import { isMembershipCancelledQuietHours } from "@/lib/leads/arbox-membership-cancelled";

export function isCrmNightHold(now: Date): boolean {
  return isMembershipCancelledQuietHours(now);
}

export function nightHoldOutcome(now: Date): "hold" | "send" {
  return isCrmNightHold(now) ? "hold" : "send";
}

/** Dedup key is unchanged. A night attempt does not record the key. */
export function deliverHeldEvent(input: {
  now: Date;
  dedupKey: string;
  seen: Set<string>;
}): "held" | "sent" | "already" {
  if (nightHoldOutcome(input.now) === "hold") return "held";
  if (input.seen.has(input.dedupKey)) return "already";
  input.seen.add(input.dedupKey);
  return "sent";
}
