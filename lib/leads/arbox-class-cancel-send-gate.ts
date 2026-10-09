/**
 * Shared pre-send gates for class_cancelled_customer, trainer, and class_cancelled_staff.
 * Re-verify + 30-minute grace. Night hold stays a wait, not a close.
 */
export const CLASS_CANCEL_GRACE_MS = 30 * 60 * 1000;

export type ClassCancelLiveStatus = "still_cancelled" | "restored" | "unknown";

export type ClassCancelPreSendDecision =
  | { action: "send" }
  | { action: "wait"; reason: "grace" | "night_hold" | "verify_unknown" }
  | { action: "close"; reason: "restored_before_send" };

export function classCancelGraceElapsed(
  cancelledAt: Date,
  now: Date,
  graceMs: number = CLASS_CANCEL_GRACE_MS
): boolean {
  return now.getTime() - cancelledAt.getTime() >= graceMs;
}

/**
 * Fresh Arbox view for one schedule id.
 * Active again under the same id wins even if the cancel report still lists it.
 * Missing from the cancel report after a successful read means restored.
 */
export function decideClassCancelLiveStatus(input: {
  scheduleId: string;
  cancelledIds: ReadonlySet<string>;
  activeScheduleIds: ReadonlySet<string>;
  verifyOk: boolean;
}): ClassCancelLiveStatus {
  if (!input.verifyOk) return "unknown";
  if (input.activeScheduleIds.has(input.scheduleId)) return "restored";
  if (input.cancelledIds.has(input.scheduleId)) return "still_cancelled";
  return "restored";
}

export function decideClassCancelPreSend(input: {
  now: Date;
  cancelledAt: Date | null;
  inSendWindow: boolean;
  live: ClassCancelLiveStatus;
}): ClassCancelPreSendDecision {
  if (input.live === "restored") return { action: "close", reason: "restored_before_send" };
  if (!input.inSendWindow) return { action: "wait", reason: "night_hold" };
  if (!input.cancelledAt || Number.isNaN(input.cancelledAt.getTime())) {
    return { action: "wait", reason: "verify_unknown" };
  }
  if (!classCancelGraceElapsed(input.cancelledAt, input.now)) {
    return { action: "wait", reason: "grace" };
  }
  if (input.live === "unknown") return { action: "wait", reason: "verify_unknown" };
  return { action: "send" };
}

export function classCancelLiveStatusBySchedule(input: {
  scheduleIds: Iterable<string>;
  cancelledIds: ReadonlySet<string>;
  activeScheduleIds: ReadonlySet<string>;
  verifyOk: boolean;
}): Map<string, ClassCancelLiveStatus> {
  const map = new Map<string, ClassCancelLiveStatus>();
  for (const scheduleId of input.scheduleIds) {
    map.set(
      scheduleId,
      decideClassCancelLiveStatus({
        scheduleId,
        cancelledIds: input.cancelledIds,
        activeScheduleIds: input.activeScheduleIds,
        verifyOk: input.verifyOk,
      })
    );
  }
  return map;
}
