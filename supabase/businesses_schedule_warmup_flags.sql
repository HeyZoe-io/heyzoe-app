-- Sales flow flags: schedule direct registration + warmup session availability
alter table if exists public.businesses
  add column if not exists schedule_direct_registration boolean not null default true;

alter table if exists public.businesses
  add column if not exists warmup_session_enabled boolean not null default true;
