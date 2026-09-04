-- Manual MARKETING bulk-send (M1). Owner-initiated; not a trigger.
-- Drain: existing cron-job.org → GET /api/cron/scheduled-template-sends (not a Vercel cron).
-- Safe to re-run.

-- 1) Job snapshot (preview counts + what the owner confirmed)
create table if not exists public.manual_bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null references public.businesses (id) on delete cascade,
  created_by uuid null,
  audience_type text not null
    check (audience_type in ('membership', 'talked_not_registered')),
  audience_params jsonb not null default '{}'::jsonb,
  template_name text not null,
  with_phone_count integer not null default 0,
  without_phone_count integer not null default 0,
  queued_count integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'done', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_manual_bulk_jobs_business_created
  on public.manual_bulk_jobs (business_id, created_at desc);

comment on table public.manual_bulk_jobs is
  'Owner-confirmed bulk MARKETING send. Audience filters in audience_params; drain via scheduled-template-sends cron.';

-- 2) Drain queue (no trigger_id — M1 is not a template_triggers row)
create table if not exists public.manual_bulk_queued_sends (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.manual_bulk_jobs (id) on delete cascade,
  business_id bigint not null references public.businesses (id) on delete cascade,
  contact_phone text not null,
  recipient_key text not null,
  template_name text not null,
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'canceled', 'failed')),
  dedup_key text not null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedup_key)
);

create index if not exists idx_manual_bulk_queued_sends_status_due
  on public.manual_bulk_queued_sends (status, due_at);

create index if not exists idx_manual_bulk_queued_sends_job_id
  on public.manual_bulk_queued_sends (job_id);

comment on table public.manual_bulk_queued_sends is
  'Queued studio-WABA template sends for a manual bulk job. Flushed by /api/cron/scheduled-template-sends.';

comment on column public.manual_bulk_queued_sends.recipient_key is
  'Dedup identity: Arbox user_id for membership audience; contacts.id for talked_not_registered.';

comment on column public.manual_bulk_queued_sends.dedup_key is
  'Per-job enqueue key: manual_bulk:{jobId}:{recipient_key}. Cross-job skip uses manual_bulk_send_log.';

-- 3) Cross-run dedup
create table if not exists public.manual_bulk_send_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  recipient_key text not null,
  template_name text not null,
  job_id uuid null references public.manual_bulk_jobs (id) on delete set null,
  sent_at timestamptz not null default now(),
  primary key (business_id, recipient_key, template_name)
);

comment on table public.manual_bulk_send_log is
  'Same business + recipient + MARKETING template is sent at most once. Re-running the filter does not re-message.';

-- Audience (b) list-building: inbound user rows in a date window (not last_contact_at).
create index if not exists idx_messages_slug_role_user_created
  on public.messages (business_slug, created_at desc)
  where role = 'user';

-- Requested alongside the log (other last_contact_at filters / crons).
create index if not exists idx_contacts_business_last_contact
  on public.contacts (business_id, last_contact_at)
  where last_contact_at is not null;

grant select, insert, update, delete
  on public.manual_bulk_jobs,
     public.manual_bulk_queued_sends,
     public.manual_bulk_send_log
  to service_role;

alter table public.manual_bulk_jobs enable row level security;
alter table public.manual_bulk_queued_sends enable row level security;
alter table public.manual_bulk_send_log enable row level security;
