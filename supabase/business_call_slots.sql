-- Documented schema for call-scheduling (already applied in production).
-- Safe to re-run: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- day_of_week: 0=ראשון … 6=שבת (aligned with HEBREW_DAY_OPTIONS index).
-- time_block: fixed 2h windows 08:00-10:00 … 20:00-22:00.

alter table if exists public.businesses
  add column if not exists sales_flow_call_scheduling_enabled boolean not null default false;

create table if not exists public.business_call_slots (
  id bigserial primary key,
  business_id bigint not null references public.businesses (id) on delete cascade,
  day_of_week smallint not null,
  time_block text not null,
  created_at timestamptz not null default now(),
  constraint business_call_slots_day_of_week_check
    check (day_of_week >= 0 and day_of_week <= 6),
  constraint business_call_slots_time_block_check
    check (
      time_block in (
        '08:00-10:00',
        '10:00-12:00',
        '12:00-14:00',
        '14:00-16:00',
        '16:00-18:00',
        '18:00-20:00',
        '20:00-22:00'
      )
    ),
  constraint business_call_slots_business_day_block_key
    unique (business_id, day_of_week, time_block)
);

create index if not exists idx_business_call_slots_business_id
  on public.business_call_slots (business_id);

alter table if exists public.contacts
  add column if not exists call_schedule_day smallint null;

alter table if exists public.contacts
  add column if not exists call_schedule_time_block text null;

comment on column public.businesses.sales_flow_call_scheduling_enabled is
  'When true, trial CTA starts call day/time picking instead of sending payment link.';

comment on column public.business_call_slots.day_of_week is
  '0=Sunday (ראשון) … 6=Saturday (שבת); same order as HEBREW_DAY_OPTIONS.';
