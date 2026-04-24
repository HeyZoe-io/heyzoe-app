alter table if exists public.businesses
  add column if not exists is_active boolean not null default false;

create index if not exists idx_businesses_is_active on public.businesses(is_active);

