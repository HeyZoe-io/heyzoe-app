-- Store business owner contact email on business row
alter table public.businesses
  add column if not exists email text;

create index if not exists idx_businesses_email on public.businesses(email);

