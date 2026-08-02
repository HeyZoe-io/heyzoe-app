-- Stage C: delayed template_triggers sends (delay_days > 0).
-- Scheduling: cron-job.org → GET /api/cron/scheduled-template-sends (not Vercel crons).
-- Server-side only (service_role); RLS enabled with no client policies.

create table if not exists public.scheduled_template_sends (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null references public.businesses (id) on delete cascade,
  trigger_id uuid not null references public.template_triggers (id) on delete cascade,
  contact_phone text not null,
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

create index if not exists idx_scheduled_template_sends_status_due_at
  on public.scheduled_template_sends (status, due_at);

create index if not exists idx_scheduled_template_sends_business_id
  on public.scheduled_template_sends (business_id);

create index if not exists idx_scheduled_template_sends_trigger_id
  on public.scheduled_template_sends (trigger_id);

comment on table public.scheduled_template_sends is
  'Queued WhatsApp template sends for template_triggers with delay_days > 0. Deduped by dedup_key.';

comment on column public.scheduled_template_sends.dedup_key is
  'Idempotent enqueue key (e.g. businessId:triggerId:saleId for purchase).';

comment on column public.scheduled_template_sends.due_at is
  'Computed send time from trigger delay_days + delay_direction.';

comment on column public.scheduled_template_sends.last_error is
  'Last gate/send error. Not-sendable at due time → status=canceled + no_template_skipped (no late retry). Transient Meta errors → status=failed.';

grant select, insert, update, delete
  on public.scheduled_template_sends
  to service_role;

alter table public.scheduled_template_sends
  enable row level security;
