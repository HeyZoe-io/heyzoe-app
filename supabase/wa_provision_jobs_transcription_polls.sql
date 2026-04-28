-- Track transcription polling attempts for WA provisioning
alter table public.wa_provision_jobs
  add column if not exists transcription_polls int not null default 0;

create index if not exists idx_wa_provision_jobs_transcription_polls on public.wa_provision_jobs(transcription_polls);

