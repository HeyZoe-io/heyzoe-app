/** 48 שעות — איפוס מחזור פולואפ מכירה אחרי חזרת ליד */
export const WA_FOLLOWUP_CYCLE_RESET_MS = 48 * 60 * 60 * 1000;

export type WaFollowupPriorContact = {
  wa_followup_stage?: number | null;
  last_contact_at?: string | null;
};

/** האם לאפס wa_followup_* לפני upsert של הודעת user חדשה */
export function shouldResetWaFollowupCycleOnInbound(prior: WaFollowupPriorContact | null | undefined): boolean {
  const stage = Number(prior?.wa_followup_stage ?? 0);
  if (!Number.isFinite(stage) || stage <= 0) return false;

  const lastAtRaw = prior?.last_contact_at;
  if (!lastAtRaw) return false;

  const lastAt = new Date(String(lastAtRaw)).getTime();
  if (!Number.isFinite(lastAt)) return false;

  return Date.now() - lastAt >= WA_FOLLOWUP_CYCLE_RESET_MS;
}

export const WA_FOLLOWUP_CYCLE_RESET_PATCH: Record<string, unknown> = {
  wa_followup_stage: 0,
  wa_followup_1_sent_at: null,
  wa_followup_2_sent_at: null,
  wa_followup_3_sent_at: null,
};
