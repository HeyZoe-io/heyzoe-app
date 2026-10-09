/**
 * Shabbat send policy — Friday 16:00 to Saturday 19:00 Asia/Jerusalem.
 * Global for every business. `override` is the hook for a later per-business table.
 * Night hold (21:00–08:00 CRM, 23:00–06:30 queue) stays in those callers.
 */
import {
  getIsraelWeekday,
  isInsideIsraelWeekendSendBlock,
} from "@/lib/israel-time";
import { canonicalizeTriggerType } from "@/lib/trigger-catalog";

export type ShabbatPolicyKind = "send" | "hold";

export type ShabbatPolicyOverride = {
  sendTypes?: readonly string[];
  holdTypes?: readonly string[];
};

export type ShabbatTriggerInput = {
  triggerType: string;
  delayDays?: number | null;
  /** Reserved — unused until a per-business override exists. */
  businessId?: number;
  override?: ShabbatPolicyOverride | null;
};

const CLASS_RELATED_SEND = new Set([
  "class_cancelled_customer",
  "class_cancelled_staff",
  "trial_reminder",
  "trainer_trial_heads_up",
]);

const ACTION_CONFIRM_SEND = new Set([
  "trial_booked",
  "purchase",
  "first_paid_purchase",
  "membership_cancelled",
  "freeze_created",
]);

const NEW_LEAD_SEND = new Set(["incoming_lead", "site_lead", "campaign_lead", "arbox_new_lead"]);

const HOLD_TYPES = new Set([
  "missed_class",
  "missed_trial",
  "attendance_gap",
  "lost_lead",
  "no_response",
  "birthday",
  "birthday_former",
  "nth_workout",
  "days_in_club",
  "milestones",
  "sessions_expiring",
  "membership_expiring",
  "freeze_ending",
  "freeze_ending_unbooked",
  "freeze_ending_booked",
  "not_registered_after_trial",
  "credit_refusal",
  "lead_status_changed",
  "manual_membership",
  "manual_talked_not_registered",
  "manual_lost_leads",
]);

export function shabbatPolicyKind(input: ShabbatTriggerInput): ShabbatPolicyKind {
  const type = canonicalizeTriggerType(String(input.triggerType ?? "").trim());
  const override = input.override;
  if (override?.sendTypes?.some((value) => canonicalizeTriggerType(value) === type)) return "send";
  if (override?.holdTypes?.some((value) => canonicalizeTriggerType(value) === type)) return "hold";

  if (CLASS_RELATED_SEND.has(type) || ACTION_CONFIRM_SEND.has(type) || NEW_LEAD_SEND.has(type)) {
    return "send";
  }
  if (type === "registered_after_trial") {
    const delay = Math.max(0, Math.trunc(Number(input.delayDays ?? 0) || 0));
    return delay === 0 ? "send" : "hold";
  }
  if (HOLD_TYPES.has(type)) return "hold";
  return "hold";
}

export function decideShabbatTriggerSend(
  now: Date,
  input: ShabbatTriggerInput
): { action: "send" | "hold"; reason?: "shabbat_hold" } {
  if (!isInsideIsraelWeekendSendBlock(now)) return { action: "send" };
  if (shabbatPolicyKind(input) === "send") return { action: "send" };
  return { action: "hold", reason: "shabbat_hold" };
}

/** Saturday morning inside the window: do not run HOLD daily steps (no send, no history seed). */
export function shouldSkipDailyHoldSteps(now: Date, slot: "morning" | "evening"): boolean {
  return slot === "morning" && isInsideIsraelWeekendSendBlock(now);
}

/** Friday 20:30 evening job is still inside the window — skip evening HOLD steps. */
export function shouldSkipEveningHoldSteps(now: Date): boolean {
  return isInsideIsraelWeekendSendBlock(now);
}

/**
 * Saturday evening job (after 19:00) re-runs Saturday-morning HOLD steps.
 * `now` is still Saturday so 09:00-due rows stay due, not history.
 */
export function isSaturdayEveningHoldCatchUp(now: Date, slot: "morning" | "evening"): boolean {
  return slot === "evening" && getIsraelWeekday(now) === 6;
}
