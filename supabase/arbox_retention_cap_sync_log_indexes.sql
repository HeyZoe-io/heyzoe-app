-- Cross-cron retention cap reads sync logs by business + status=sent + processed_at today.
-- The primary key already starts with business_id, so the lookup is correct without
-- these indexes. Run this in the Supabase SQL editor when a business's log grows.
-- Scheduling stays on cron-job.org. No new table.

create index if not exists idx_arbox_lost_lead_sync_log_biz_status_processed
  on public.arbox_lost_lead_sync_log (business_id, status, processed_at);

create index if not exists idx_arbox_missed_class_sync_log_biz_status_processed
  on public.arbox_missed_class_sync_log (business_id, status, processed_at);

create index if not exists idx_arbox_attendance_gap_sync_log_biz_status_processed
  on public.arbox_attendance_gap_sync_log (business_id, status, processed_at);
