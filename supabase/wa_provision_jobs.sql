-- WhatsApp provisioning jobs (async worker via cron)
create table if not exists public.wa_provision_jobs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_id bigint not null references public.businesses(id) on delete cascade,
  business_slug text not null,
  business_name text not null,
  status text not null default 'queued',
  attempts int not null default 0,
  last_error text,
  phone_e164 text,
  meta_phone_number_id text,
  twilio_sid text
);

alter table public.wa_provision_jobs
  drop constraint if exists wa_provision_jobs_status_check;

alter table public.wa_provision_jobs
  add constraint wa_provision_jobs_status_check
  check (status in ('queued','running','awaiting_manual_code','done','failed'));

create index if not exists idx_wa_provision_jobs_status_created on public.wa_provision_jobs(status, created_at);
create index if not exists idx_wa_provision_jobs_business_slug on public.wa_provision_jobs(business_slug);

