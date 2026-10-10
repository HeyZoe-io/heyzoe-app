/**
 * Follow-ups delayed by a hold (Shabbat Friday 16:00 – Saturday 19:00, or the 23:00 night hold).
 * Shared by wa-followups, the conversation-path follow-ups and marketing-followups.
 *
 * - A non-final step whose hold lay between its due time and now is never sent late:
 *   it is advanced and recorded as delayed_step_cancelled.
 * - The final step (~23h) is sent once in the first allowed tick.
 * - Any step is closed as outside_24h_window once the lead's last message is 24h old.
 *
 * Every cancellation: one Vercel log line and one audit row in messages
 * (marketing slug, session followup-audit). The daily admin summary counts them.
 */
import { MARKETING_CONVERSATIONS_SLUG } from "@/lib/marketing-whatsapp";
import { nextBlockedWhatsAppSendTimeIsrael, WA_ISRAEL_QUIET_END_MINUTES } from "@/lib/israel-time";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const FOLLOWUP_LEAD_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FOLLOWUP_CANCELLED_MODEL = "followup_cancelled";
export const FOLLOWUP_AUDIT_SESSION = "followup-audit";

export type FollowupCancelReason = "delayed_step_cancelled" | "outside_24h_window";
export type FollowupPath = "wa_followups" | "conversation" | "marketing";
export type FollowupStepDecision = { action: "send" } | { action: "cancel"; reason: FollowupCancelReason };

/** True when a blocked instant (night or Shabbat) lies between `dueAt` and `now`. */
export function followupStepWasHeld(
  dueAt: Date,
  now: Date,
  quietEndMinutes: number = WA_ISRAEL_QUIET_END_MINUTES
): boolean {
  if (!Number.isFinite(dueAt.getTime()) || now.getTime() <= dueAt.getTime()) return false;
  return nextBlockedWhatsAppSendTimeIsrael(dueAt, quietEndMinutes).getTime() <= now.getTime();
}

export function isOutsideLeadWindow(lastUserAt: Date | null, now: Date): boolean {
  const at = lastUserAt?.getTime() ?? NaN;
  return !Number.isFinite(at) || now.getTime() - at >= FOLLOWUP_LEAD_WINDOW_MS;
}

/** Call only in an allowed send tick, for a step that is already due. */
export function decideFollowupStep(input: {
  finalStep: boolean;
  dueAt: Date;
  now: Date;
  lastUserAt: Date | null;
  quietEndMinutes?: number;
}): FollowupStepDecision {
  if (isOutsideLeadWindow(input.lastUserAt, input.now)) return { action: "cancel", reason: "outside_24h_window" };
  if (!input.finalStep && followupStepWasHeld(input.dueAt, input.now, input.quietEndMinutes)) {
    return { action: "cancel", reason: "delayed_step_cancelled" };
  }
  return { action: "send" };
}

/** The box after a cancelled one keeps the original schedule, not the cancellation moment. */
export function rebasedNextFollowupDueAt(cancelledDueAt: Date, nextDelayMinutes: number): Date {
  return new Date(cancelledDueAt.getTime() + Math.max(0, nextDelayMinutes) * 60_000);
}

export function followupCancelModelUsed(
  reason: FollowupCancelReason,
  businessId: number | null,
  path: FollowupPath,
  step: number
): string {
  return `${FOLLOWUP_CANCELLED_MODEL}:${reason}:${businessId ?? 0}:${path}:${step}`;
}

export function parseFollowupCancelModelUsed(
  modelUsed: string
): { reason: FollowupCancelReason; businessId: number; path: string; step: number } | null {
  const [model, reason, business, path, step] = String(modelUsed ?? "").split(":");
  if (model !== FOLLOWUP_CANCELLED_MODEL) return null;
  if (reason !== "delayed_step_cancelled" && reason !== "outside_24h_window") return null;
  return { reason, businessId: Number(business) || 0, path: path ?? "", step: Number(step) || 0 };
}

export function maskFollowupPhone(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length < 4 ? "***" : `***${d.slice(-4)}`;
}

export type FollowupCancellation = {
  path: FollowupPath;
  businessId: number | null;
  phone: string;
  step: number;
  reason: FollowupCancelReason;
  dueAtIso: string | null;
};

/** Vercel log + audit row. Dry run: log line only. */
export async function recordFollowupCancellation(
  admin: Admin,
  input: FollowupCancellation & { dryRun?: boolean }
): Promise<void> {
  const masked = maskFollowupPhone(input.phone);
  console.info("[followup-hold] cancelled", {
    path: input.path,
    business_id: input.businessId,
    phone: masked,
    step: input.step,
    reason: input.reason,
    due_at: input.dueAtIso,
    dry_run: Boolean(input.dryRun),
  });
  if (input.dryRun) return;
  const { error } = await admin.from("messages").insert({
    business_slug: MARKETING_CONVERSATIONS_SLUG,
    role: "assistant",
    content: `פולואפ בוטל: ${input.path} שלב ${input.step} · ${input.reason} · ${masked} · יעד ${input.dueAtIso ?? "-"}`,
    model_used: followupCancelModelUsed(input.reason, input.businessId, input.path, input.step),
    session_id: FOLLOWUP_AUDIT_SESSION,
  });
  if (error) console.error("[followup-hold] audit insert failed:", error.message);
}
