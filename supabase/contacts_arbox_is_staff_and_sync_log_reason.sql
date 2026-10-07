-- Manual step: run in the Supabase SQL editor.
-- The app runs safely before this: staff flags are skipped, and sync-log
-- writes retry without the reason column. After it runs, the morning job
-- refreshes contacts.arbox_is_staff and the daily summary can count skip reasons.

alter table if exists public.contacts
  add column if not exists arbox_is_staff boolean not null default false;

alter table if exists public.contacts
  add column if not exists arbox_staff_synced_at timestamptz null;

comment on column public.contacts.arbox_is_staff is
  'True when this contact phone was on the latest successful GET /v3/users/allStaffMembers. A failed fetch does not clear it.';

create index if not exists idx_contacts_arbox_is_staff_true
  on public.contacts (business_id)
  where arbox_is_staff = true;

alter table if exists public.arbox_trial_booking_confirm_log add column if not exists reason text null;
alter table if exists public.arbox_trial_reminder_sync_log add column if not exists reason text null;
alter table if exists public.arbox_missed_class_sync_log add column if not exists reason text null;
alter table if exists public.arbox_lost_lead_sync_log add column if not exists reason text null;
alter table if exists public.arbox_lead_status_change_sync_log add column if not exists reason text null;
alter table if exists public.arbox_attendance_gap_sync_log add column if not exists reason text null;
alter table if exists public.arbox_freeze_created_sync_log add column if not exists reason text null;
alter table if exists public.arbox_freeze_ending_sync_log add column if not exists reason text null;
alter table if exists public.arbox_post_trial_followup_sync_log add column if not exists reason text null;
alter table if exists public.arbox_cancellation_sync_log add column if not exists reason text null;
alter table if exists public.arbox_nth_workout_sync_log add column if not exists reason text null;
alter table if exists public.arbox_days_in_club_sync_log add column if not exists reason text null;
alter table if exists public.arbox_class_cancelled_customer_notify_log add column if not exists reason text null;
alter table if exists public.arbox_birthday_sync_log add column if not exists reason text null;
alter table if exists public.arbox_expiring_sync_log add column if not exists reason text null;
alter table if exists public.arbox_sessions_expiring_sync_log add column if not exists reason text null;
