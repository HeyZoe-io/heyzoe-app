-- lead_status_changed send slot and pending due date.
-- Scheduling stays on the existing arbox-daily-triggers runs (09:00 and 20:00, lib/daily-run-slots.ts).
-- Run in the Supabase SQL editor. Safe to re-run.
-- Until this runs, a missing column means next_run and the previous delay behavior.

alter table public.template_triggers
  add column if not exists send_slot text null;

comment on column public.template_triggers.send_slot is
  'lead_status_changed only: next_run, morning (09:00), or evening (20:00). Null means next_run. Ignored for every other trigger type.';

alter table public.arbox_lead_status_change_sync_log
  add column if not exists due_date date null;

alter table public.arbox_lead_status_change_sync_log
  add column if not exists send_slot text null;

comment on column public.arbox_lead_status_change_sync_log.due_date is
  'Israel date the pending episode may send, detection day plus delay_days.';

comment on column public.arbox_lead_status_change_sync_log.send_slot is
  'Slot captured when the episode was claimed. next_run matches both daily runs.';

create index if not exists idx_arbox_lead_status_change_sync_log_pending_due
  on public.arbox_lead_status_change_sync_log (business_id, status, due_date);
