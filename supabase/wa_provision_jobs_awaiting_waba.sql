-- Gate Twilio provisioning until Embedded Signup completes (PARTNER_ADDED webhook).
-- New payment IPN jobs start as 'awaiting_waba'; webhook/embedded-signup release them to 'queued'.
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
    'awaiting_manual_code',
    'done',
    'failed'
  ));
