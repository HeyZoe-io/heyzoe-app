-- Admin (Zoe marketing line) WhatsApp templates + triggers.
-- Run in Supabase SQL editor. Existing Meta templates appear after refresh in /admin/templates.
-- Delayed/scheduled sends are flushed by the existing cron-job.org job:
--   GET /api/cron/scheduled-template-sends  (not a Vercel cron)

create table if not exists public.marketing_whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  waba_template_id text null,
  name text not null,
  language text not null default 'he',
  category text not null default 'MARKETING',
  status text not null default 'PENDING',
  components jsonb not null default '[]'::jsonb,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, language)
);

create index if not exists idx_marketing_whatsapp_templates_disabled
  on public.marketing_whatsapp_templates (disabled)
  where disabled = false;

create index if not exists idx_marketing_whatsapp_templates_waba_id
  on public.marketing_whatsapp_templates (waba_template_id)
  where waba_template_id is not null;

comment on table public.marketing_whatsapp_templates is
  'Cache of Meta message templates on the HeyZoe marketing WABA (admin line).';

create table if not exists public.marketing_template_triggers (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null
    check (trigger_type in ('node_answered', 'flow_completed', 'call_day')),
  flow_node_id uuid null references public.marketing_flow_nodes (id) on delete set null,
  delay_days integer not null default 0 check (delay_days >= 0),
  delay_direction text not null default 'after'
    check (delay_direction in ('after', 'before')),
  template_name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketing_template_triggers_enabled_type
  on public.marketing_template_triggers (trigger_type)
  where enabled = true;

comment on table public.marketing_template_triggers is
  'Admin automation rules: node answer, flow completed, or reminder on scheduled call day.';

comment on column public.marketing_template_triggers.flow_node_id is
  'For node_answered (required) and optional call_day: the flow node UUID, not the builder #N rank.';

create table if not exists public.scheduled_marketing_template_sends (
  id uuid primary key default gen_random_uuid(),
  trigger_id uuid null references public.marketing_template_triggers (id) on delete cascade,
  contact_phone text not null,
  template_name text not null,
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'canceled', 'failed')),
  dedup_key text not null,
  body_params jsonb not null default '[]'::jsonb,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedup_key)
);

create index if not exists idx_scheduled_marketing_template_sends_status_due
  on public.scheduled_marketing_template_sends (status, due_at);

comment on table public.scheduled_marketing_template_sends is
  'Queued marketing-line template sends. Flushed by /api/cron/scheduled-template-sends (cron-job.org).';

grant select, insert, update, delete
  on public.marketing_whatsapp_templates
  to authenticated;

grant select, insert, update, delete
  on public.marketing_whatsapp_templates
  to service_role;

alter table public.marketing_whatsapp_templates
  enable row level security;

grant select, insert, update, delete
  on public.marketing_template_triggers
  to authenticated;

grant select, insert, update, delete
  on public.marketing_template_triggers
  to service_role;

alter table public.marketing_template_triggers
  enable row level security;

grant select, insert, update, delete
  on public.scheduled_marketing_template_sends
  to authenticated;

grant select, insert, update, delete
  on public.scheduled_marketing_template_sends
  to service_role;

alter table public.scheduled_marketing_template_sends
  enable row level security;
