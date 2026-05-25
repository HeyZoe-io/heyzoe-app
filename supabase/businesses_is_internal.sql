-- Internal businesses: hidden from normal client dashboard access (middleware + API filters).
alter table public.businesses
  add column if not exists is_internal boolean not null default false;

create index if not exists idx_businesses_is_internal on public.businesses (is_internal) where is_internal = true;

update public.businesses
set is_internal = true
where lower(trim(slug)) = 'hey-zoe';
