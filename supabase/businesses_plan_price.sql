-- Optional per-business plan price (used for admin MRR calculations)
alter table public.businesses
  add column if not exists plan_price numeric;

-- Backfill missing prices from plan (safe defaults; can be overridden per-business).
update public.businesses
set plan_price =
  case
    when plan = 'premium' then 499
    else 349
  end
where plan_price is null;

create index if not exists idx_businesses_plan_price on public.businesses(plan_price);

