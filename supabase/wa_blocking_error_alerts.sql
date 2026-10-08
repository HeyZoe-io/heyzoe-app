-- Immediate Zoe Admin alert when Meta reports an error that blocks a whole business
-- (payment, account locked / restricted, number disconnected, template paused / disabled).
-- One row per (business, error code). claim_wa_blocking_error_alert is a single statement,
-- so two webhook instances can never both win the same 6h window.
-- Idempotent: safe to run more than once. The code works before this runs
-- (it falls back to a messages lookup + in-memory throttle).

create table if not exists public.wa_blocking_error_alerts (
  business_id bigint not null,
  error_code integer not null,
  last_alert_at timestamptz not null default now(),
  alert_count integer not null default 1,
  primary key (business_id, error_code)
);

comment on table public.wa_blocking_error_alerts is
  'Throttle for Zoe Admin blocking-error alerts: at most one per business per error code per window.';

alter table public.wa_blocking_error_alerts enable row level security;

create or replace function public.claim_wa_blocking_error_alert(
  p_business_id bigint,
  p_error_code integer,
  p_window_minutes integer default 360
) returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    insert into public.wa_blocking_error_alerts as a (business_id, error_code, last_alert_at, alert_count)
    values (p_business_id, p_error_code, now(), 1)
    on conflict (business_id, error_code) do update
      set last_alert_at = now(), alert_count = a.alert_count + 1
      where a.last_alert_at < now() - make_interval(mins => p_window_minutes)
    returning 1
  )
  select exists (select 1 from claimed);
$$;

-- Send failed after the claim: allow another try in p_retry_minutes instead of the full window.
create or replace function public.release_wa_blocking_error_alert(
  p_business_id bigint,
  p_error_code integer,
  p_window_minutes integer default 360,
  p_retry_minutes integer default 10
) returns void
language sql
security definer
set search_path = public
as $$
  update public.wa_blocking_error_alerts
     set last_alert_at = now() - make_interval(mins => greatest(p_window_minutes - p_retry_minutes, 0))
   where business_id = p_business_id and error_code = p_error_code;
$$;

revoke all on function public.claim_wa_blocking_error_alert(bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.release_wa_blocking_error_alert(bigint, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_wa_blocking_error_alert(bigint, integer, integer) to service_role;
grant execute on function public.release_wa_blocking_error_alert(bigint, integer, integer, integer) to service_role;

-- Verify
select to_regclass('public.wa_blocking_error_alerts') as table_ok,
       to_regprocedure('public.claim_wa_blocking_error_alert(bigint,integer,integer)') as claim_ok;
