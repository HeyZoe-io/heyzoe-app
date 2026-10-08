-- Plan before send (Layer 1).
-- PLAN (08:00 / 19:00 IL, cron-job.org ?phase=plan) writes every send of the daily run to
-- scheduled_template_sends as status 'planned' (or held / blocked / skipped) with the rendered
-- body. DISPATCH (the existing 09:00 / 20:00 jobs) sends only 'planned' rows.
-- Idempotent: safe to run more than once. Run in the Supabase SQL editor before deploying.

-- 1. Plan fields on the Stage C queue. All nullable: existing rows and writers are unchanged.
alter table public.scheduled_template_sends
  add column if not exists plan_day date,
  add column if not exists plan_slot text,
  add column if not exists phone_number_id text,
  add column if not exists language_code text,
  add column if not exists components jsonb,
  add column if not exists recipient_kind text,
  add column if not exists rendered_body text,
  add column if not exists event_key text,
  add column if not exists event_at timestamptz,
  add column if not exists event_meta jsonb,
  add column if not exists hold_reason text,
  add column if not exists log_message jsonb,
  add column if not exists released_at timestamptz,
  add column if not exists released_by text;

-- A planned send that is not a template_triggers rule (rare) has no trigger.
alter table public.scheduled_template_sends
  alter column trigger_id drop not null;

alter table public.scheduled_template_sends
  drop constraint if exists scheduled_template_sends_status_check;

alter table public.scheduled_template_sends
  add constraint scheduled_template_sends_status_check
  check (status in (
    'pending', 'sending', 'sent', 'canceled', 'failed', 'unknown', 'claimed',
    'planned', 'held', 'blocked', 'skipped'
  ));

alter table public.scheduled_template_sends
  drop constraint if exists scheduled_template_sends_plan_slot_check;

alter table public.scheduled_template_sends
  add constraint scheduled_template_sends_plan_slot_check
  check (plan_slot is null or plan_slot in ('morning', 'evening', 'event', 'queue'));

comment on column public.scheduled_template_sends.plan_day is
  'Israel calendar day of the PLAN that wrote or checked the row. Null: not a planned row.';
comment on column public.scheduled_template_sends.hold_reason is
  'Why the row is held / blocked / skipped (empty_variable, relative_words, volume_anomaly, waba_blocked, opted_out, staff, leave_request_14d, duplicate, circuit_breaker).';
comment on column public.scheduled_template_sends.components is
  'Graph template components captured at PLAN. DISPATCH sends exactly these.';

-- DISPATCH: the planned rows of one day and slot.
create index if not exists idx_scheduled_template_sends_plan
  on public.scheduled_template_sends (plan_day, plan_slot, status);

-- Admin page and end-of-day expiry: held rows only.
create index if not exists idx_scheduled_template_sends_held
  on public.scheduled_template_sends (plan_day)
  where status = 'held';

-- Certain-duplicate check: same business + phone + template + event.
create index if not exists idx_scheduled_template_sends_event
  on public.scheduled_template_sends (business_id, contact_phone, template_name, event_key)
  where event_key is not null;

-- 2. One row per business per PLAN. DISPATCH sends planned rows and runs the legacy
-- worker only for businesses without an ok plan, so a missing PLAN job means today's behavior.
create table if not exists public.send_plan_runs (
  plan_day date not null,
  slot text not null check (slot in ('morning', 'evening')),
  business_id bigint not null references public.businesses (id) on delete cascade,
  status text not null check (status in ('ok', 'incomplete')),
  reason text null,
  counts jsonb null,
  planned_at timestamptz not null default now(),
  dispatched_at timestamptz null,
  primary key (plan_day, slot, business_id)
);

comment on table public.send_plan_runs is
  'PLAN outcome per business per slot. DISPATCH reads it; ok = every step of the run finished.';

grant select, insert, update, delete on public.send_plan_runs to service_role;
alter table public.send_plan_runs enable row level security;

-- 3. Event-driven circuit breaker: a business + trigger paused after > 3x its normal hourly volume.
create table if not exists public.send_trigger_pauses (
  business_id bigint not null references public.businesses (id) on delete cascade,
  trigger_key text not null,
  paused_at timestamptz not null default now(),
  paused_until timestamptz not null,
  reason text null,
  sent_last_hour integer not null default 0,
  hourly_baseline numeric not null default 0,
  resumed_at timestamptz null,
  resumed_by text null,
  primary key (business_id, trigger_key)
);

comment on table public.send_trigger_pauses is
  'Circuit breaker for event-driven template sends. Active while paused_until > now() and resumed_at is null.';

grant select, insert, update, delete on public.send_trigger_pauses to service_role;
alter table public.send_trigger_pauses enable row level security;

-- 4. Indexes the checks read (10x scale: per-business range scans, no table scans).
create index if not exists wa_template_send_refs_business_created_idx
  on public.wa_template_send_refs (business_id, created_at);

do $$
begin
  if to_regclass('public.wa_message_statuses') is not null then
    execute 'create index if not exists wa_message_statuses_business_status_at_idx
      on public.wa_message_statuses (business_id, status, status_at)';
  end if;
end $$;

-- Verify
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'scheduled_template_sends'
      and column_name in ('plan_day', 'plan_slot', 'components', 'rendered_body', 'event_key', 'hold_reason', 'log_message')) = 7
    as queue_columns_ok,
  to_regclass('public.send_plan_runs') is not null as plan_runs_ok,
  to_regclass('public.send_trigger_pauses') is not null as pauses_ok,
  to_regclass('public.idx_scheduled_template_sends_plan') is not null as plan_index_ok,
  (select pg_get_constraintdef(oid) like '%planned%' from pg_constraint
    where conname = 'scheduled_template_sends_status_check') as status_check_ok;
