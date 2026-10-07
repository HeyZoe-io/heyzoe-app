/**
 * Retention targets for the existing cron-job.org job
 * GET /api/cron/arbox-trial-sync-cleanup. No new schedule.
 *
 * A row is deleted only when its timestamp is older than the table's retention
 * AND it is not a soft-seed / window-marker sentinel. Sentinels are the rows
 * that keep "this rule already ran" from looking empty (log count 0 reseeds
 * and sends nothing).
 */

export const ARBOX_SYNC_LOG_RETENTION_DAYS = 90;
/** Birthday dedupe is per celebration year. 400 days outlives one quiet year. */
export const ARBOX_BIRTHDAY_SYNC_LOG_RETENTION_DAYS = 400;

export const ARBOX_SYNC_LOG_DELETE_BATCH = 500;
/** Caps one cron run so a backlog cannot hold the function open. The next day continues. */
export const ARBOX_SYNC_LOG_DELETE_MAX_BATCHES = 4;

export type RetentionKeep = {
  column: string;
  not: string | number;
};

export type SyncLogRetentionTarget = {
  table: string;
  retentionDays: number;
  timeColumn: "processed_at";
  keep: RetentionKeep[];
};

/**
 * Every listed lookback is the longest time a non-sentinel row is still read.
 * 90 days is longer than each of those windows.
 */
export const ARBOX_SYNC_LOG_RETENTION_TARGETS: SyncLogRetentionTarget[] = [
  { table: "arbox_trial_sync_log", retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS, timeColumn: "processed_at", keep: [] },
  {
    table: "arbox_post_trial_followup_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [{ column: "user_id", not: 0 }],
  },
  {
    table: "arbox_attendance_gap_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [{ column: "user_id", not: 0 }],
  },
  { table: "arbox_missed_class_sync_log", retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS, timeColumn: "processed_at", keep: [] },
  {
    table: "arbox_trial_reminder_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [{ column: "user_id", not: 0 }],
  },
  {
    table: "arbox_freeze_created_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [{ column: "membership_hold_id", not: 0 }],
  },
  {
    table: "arbox_freeze_ending_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [{ column: "membership_hold_id", not: 0 }],
  },
  {
    table: "arbox_birthday_sync_log",
    retentionDays: ARBOX_BIRTHDAY_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [],
  },
  { table: "arbox_expiring_sync_log", retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS, timeColumn: "processed_at", keep: [] },
  {
    table: "arbox_sessions_expiring_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [],
  },
  {
    table: "arbox_credit_refusal_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [],
  },
  { table: "arbox_new_lead_sync_log", retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS, timeColumn: "processed_at", keep: [] },
  {
    table: "arbox_lost_lead_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [{ column: "lead_id", not: 0 }],
  },
  {
    table: "arbox_cancellation_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [],
  },
  {
    table: "arbox_lead_status_change_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [{ column: "status", not: "pending" }],
  },
  {
    table: "arbox_trial_attended_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [],
  },
  {
    table: "arbox_days_in_club_sync_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [{ column: "user_id", not: 0 }],
  },
  {
    table: "arbox_trial_booking_confirm_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [],
  },
  {
    table: "arbox_class_cancelled_customer_notify_log",
    retentionDays: ARBOX_SYNC_LOG_RETENTION_DAYS,
    timeColumn: "processed_at",
    keep: [],
  },
];

export function retentionCutoffIso(retentionDays: number, now: Date = new Date()): string {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

export function isMissingSyncLogTable(message: string): boolean {
  return /does not exist|schema cache|PGRST204|could not find the table/i.test(message);
}
