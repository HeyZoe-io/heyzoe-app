-- Cloud API activation step after verify_code (POST /{phone_number_id}/register).
-- Cron handles status=waiting_register for jobs that completed verify_code before this step existed.
alter table public.wa_provision_jobs
  drop constraint if exists wa_provision_jobs_status_check;

alter table public.wa_provision_jobs
  add constraint wa_provision_jobs_status_check
  check (status in (
    'awaiting_waba',
    'queued',
    'running',
    'waiting_recording',
    'transcribing',
    'waiting_register',
    'awaiting_manual_code',
    'done',
    'failed'
  ));
