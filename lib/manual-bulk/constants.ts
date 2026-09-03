/** Graph calls per drain tick of /api/cron/scheduled-template-sends. */
export const MANUAL_BULK_FLUSH_LIMIT = 80;

/**
 * Assumed cron-job.org interval for scheduled-template-sends (minutes).
 * Owner can confirm the live interval; keep 60 until then.
 */
export const MANUAL_BULK_DRAIN_INTERVAL_MINUTES = 60;

export const MANUAL_BULK_AUDIENCE_TYPES = ["membership", "talked_not_registered"] as const;
export type ManualBulkAudienceType = (typeof MANUAL_BULK_AUDIENCE_TYPES)[number];

export const MANUAL_BULK_WEEKS_MIN = 1;
export const MANUAL_BULK_WEEKS_MAX = 12;
export const MANUAL_BULK_WEEKS_DEFAULT = 4;

export const MANUAL_BULK_MESSAGES_PAGE = 1000;
export const MANUAL_BULK_MESSAGES_MAX_PAGES = 50;
export const MANUAL_BULK_CONTACTS_PAGE = 1000;
export const MANUAL_BULK_CONTACTS_MAX_PAGES = 20;
export const MANUAL_BULK_ENQUEUE_CHUNK = 500;

export function isManualBulkAudienceType(raw: unknown): raw is ManualBulkAudienceType {
  return (MANUAL_BULK_AUDIENCE_TYPES as readonly string[]).includes(String(raw ?? ""));
}

export function clampManualBulkWeeks(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return MANUAL_BULK_WEEKS_DEFAULT;
  return Math.min(MANUAL_BULK_WEEKS_MAX, Math.max(MANUAL_BULK_WEEKS_MIN, n));
}

export function estimateManualBulkSendDurationMinutes(withPhoneCount: number): number {
  const n = Math.max(0, Math.trunc(Number(withPhoneCount) || 0));
  if (n === 0) return 0;
  const ticks = Math.ceil(n / MANUAL_BULK_FLUSH_LIMIT);
  return ticks * MANUAL_BULK_DRAIN_INTERVAL_MINUTES;
}

export function inboundCutoffIso(weeks: number, now: Date = new Date()): string {
  const w = clampManualBulkWeeks(weeks);
  return new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000).toISOString();
}

export function buildManualBulkQueuedDedupKey(jobId: string, recipientKey: string): string {
  return `manual_bulk:${String(jobId).trim()}:${String(recipientKey).trim()}`;
}

export function membershipRecipientKey(userId: number): string {
  return `arbox_user:${userId}`;
}

export function talkedRecipientKey(contactId: string | null, phone: string): string {
  const id = String(contactId ?? "").trim();
  if (id) return `contact:${id}`;
  return `phone:${String(phone).trim()}`;
}
