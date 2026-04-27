-- Business inquiries (simple admin inbox)
create table if not exists public.business_inquiries (
  id bigserial primary key,
  business_id bigint null references public.businesses(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now(),
  is_read boolean not null default false
);

create index if not exists idx_business_inquiries_created_at on public.business_inquiries(created_at desc);
create index if not exists idx_business_inquiries_is_read on public.business_inquiries(is_read, created_at desc);
create index if not exists idx_business_inquiries_business_id on public.business_inquiries(business_id);

