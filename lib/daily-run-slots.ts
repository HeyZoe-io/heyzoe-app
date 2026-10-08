/**
 * Arbox daily run times, Israel wall clock (Asia/Jerusalem), HH:MM.
 * The real start time is the cron-job.org schedule; these must match it.
 *   morning: GET /api/cron/arbox-daily-triggers
 *   evening: ?slot=evening
 *   evening retry: ?slot=evening&pass=retry (after the main run, before the night hold)
 * The 21:00-08:00 night hold is lib/leads/crm-night-hold.ts and does not move.
 */
export const MORNING_SLOT_IL = "09:00";
export const EVENING_SLOT_IL = "20:00";
export const EVENING_RETRY_SLOT_IL = "20:20";
