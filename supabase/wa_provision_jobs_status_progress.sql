-- Expand wa_provision_jobs status values to support multi-step cron progression
alter table public.wa_provision_jobs
  drop constraint if exists wa_provision_jobs_status_check;

alter table public.wa_provision_jobs
  add constraint wa_provision_jobs_status_check
  check (status in ('queued','running','waiting_recording','transcribing','awaiting_manual_code','done','failed'));

