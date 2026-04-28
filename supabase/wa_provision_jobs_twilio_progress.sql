-- Add optional progress columns for Twilio verification flow
alter table public.wa_provision_jobs
  add column if not exists recording_sid text;

alter table public.wa_provision_jobs
  add column if not exists transcription_started_at timestamptz;

create index if not exists idx_wa_provision_jobs_recording_sid on public.wa_provision_jobs(recording_sid);

