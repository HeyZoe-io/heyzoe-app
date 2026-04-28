-- Business subscription status (for dashboards/admin)
alter table public.businesses
  add column if not exists status text;

-- backfill best-effort
update public.businesses
set status = 'active'
where status is null and is_active = true;

update public.businesses
set status = 'inactive'
where status is null and (is_active = false or is_active is null);

create index if not exists idx_businesses_status on public.businesses(status);

